"""Per-(card, grader, grade) market features from the unified real sales table (stdlib only).

  python -m scoring.pipeline.features_real
Writes scoring/data/cleaned/real/series_features.csv and grade_ladder.csv.

Every statistic is computed inside a single series = (card_key, grade_company, grade).
A PSA 10 and a PSA 9 of the same card are different series with their own volume, price,
volatility and disagreement; nothing is pooled or imputed across grades here.
Missing means unknown (blank), never zero.
"""
import csv, datetime as dt, math, statistics as st, collections
from .collect.common import ROOT

D = ROOT / "data" / "cleaned" / "real"
HV = 50   # a wallet with >= this many trades in the window is flagged high-volume (maybe a bot/market maker)


def q(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = math.floor(k); c = math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def main():
    rows = list(csv.DictReader(open(D / "sales_unified.csv")))
    for r in rows:
        r["ts"] = dt.datetime.fromisoformat(r["sale_ts"]); r["p"] = float(r["price_usd"]); r["g"] = float(r["grade"])
    rows = [r for r in rows if r["p"] > 0]
    asof = max(r["ts"] for r in rows)
    trades = collections.Counter()
    for r in rows:
        trades[r["buyer_hash"]] += 1; trades[r["seller_hash"]] += 1
    hv = {w for w, n in trades.items() if n >= HV}
    series = collections.defaultdict(list)
    for r in rows:
        series[(r["card_key"], r["grade_company"], r["g"])].append(r)

    out = []
    for (ck, gc, g), rs in series.items():
        rs.sort(key=lambda r: r["ts"])
        P = [r["p"] for r in rs]
        age = lambda r: (asof - r["ts"]).total_seconds() / 86400
        w = lambda d: [r["p"] for r in rs if age(r) <= d]
        n7, n30, n90 = len(w(7)), len(w(30)), len(w(90))
        lp = [math.log(p) for p in P]
        # realized volatility from consecutive-sale log returns, scaled by sqrt(days between sales)
        rets, vol_norm = [], []
        for a, b in zip(rs, rs[1:]):
            dd = max((b["ts"] - a["ts"]).total_seconds() / 86400, 1 / 24)
            lr = math.log(b["p"] / a["p"]); rets.append(lr); vol_norm.append(lr / math.sqrt(dd))
        # repeat sales of the SAME token: cleanest signal of price change (same physical card)
        by_tok = collections.defaultdict(list)
        for r in rs: by_tok[r["token_ref"]].append(r)
        rep = [math.log(b["p"] / a["p"]) for t in by_tok.values() for a, b in zip(t, t[1:])]
        venues = collections.defaultdict(list)
        for r in rs: venues[r["venue"].split("/")[0]].append(r["p"])
        vmed = {v: st.median(x) for v, x in venues.items()}
        cross = (abs(math.log(max(vmed.values()) / min(vmed.values()))) if len(vmed) > 1 else None)
        buyers = collections.Counter(r["buyer_hash"] for r in rs); sellers = collections.Counter(r["seller_hash"] for r in rs)
        self_trade = sum(r["buyer_hash"] == r["seller_hash"] for r in rs)
        pair = collections.Counter((r["buyer_hash"], r["seller_hash"]) for r in rs)
        repeat_pair = sum(n for n in pair.values() if n >= 2)
        hv_share = sum((r["buyer_hash"] in hv or r["seller_hash"] in hv) for r in rs) / len(rs)
        med = st.median(P)
        mad = st.median([abs(p - med) for p in P])
        last = rs[-1]
        gaps = [(b["ts"] - a["ts"]).total_seconds() / 86400 for a, b in zip(rs, rs[1:])]
        out.append(dict(
            card_key=ck, card_name=rs[0]["card_name"], set_name=rs[0]["set_name"], year=rs[0]["year"],
            card_number=rs[0]["card_number"], language=rs[0]["language"], category=rs[0]["category"],
            grade_company=gc, grade=g, n_sales=len(rs), n_tokens=len(by_tok), n_sales_7d=n7, n_sales_30d=n30, n_sales_90d=n90,
            first_sale=rs[0]["sale_ts"], last_sale=last["sale_ts"], days_since_last_sale=round(age(last), 2),
            median_gap_days=round(st.median(gaps), 2) if gaps else "",
            last_price=last["p"], median_price=round(med, 2), mean_price=round(st.mean(P), 2),
            median_30d=round(st.median(w(30)), 2) if n30 else "", median_7d=round(st.median(w(7)), 2) if n7 else "",
            p10=round(q(P, .1), 2), p90=round(q(P, .9), 2), min_price=min(P), max_price=max(P),
            log_price_std=round(st.pstdev(lp), 4) if len(P) > 1 else "",
            mad_over_median=round(mad / med, 4) if len(P) > 2 else "",
            iqr_over_median=round((q(P, .75) - q(P, .25)) / med, 4) if len(P) > 3 else "",
            realized_vol_per_sale=round(st.pstdev(rets), 4) if len(rets) > 1 else "",
            realized_vol_per_sqrt_day=round(st.pstdev(vol_norm), 4) if len(vol_norm) > 1 else "",
            repeat_sale_n=len(rep), repeat_sale_mean_logret=round(st.mean(rep), 4) if rep else "",
            repeat_sale_abs_logret=round(st.mean(abs(x) for x in rep), 4) if rep else "",
            last_vs_median_logratio=round(math.log(last["p"] / med), 4),
            n_venues=len(venues), cross_venue_logdiff=round(cross, 4) if cross is not None else "",
            distinct_buyers=len(buyers), distinct_sellers=len(sellers),
            top_buyer_share=round(max(buyers.values()) / len(rs), 3), top_seller_share=round(max(sellers.values()) / len(rs), 3),
            self_trades=self_trade, repeat_pair_trades=repeat_pair, high_volume_wallet_share=round(hv_share, 3),
            as_of=asof.isoformat()))
    cols = list(out[0].keys())
    with open(D / "series_features.csv", "w", newline="") as f:
        wr = csv.DictWriter(f, cols); wr.writeheader(); wr.writerows(sorted(out, key=lambda r: -r["n_sales"]))

    # grade ladder: same card, different grades side by side (shows each grade has its own price/volume)
    lad = collections.defaultdict(dict)
    for r in out: lad[r["card_key"]][(r["grade_company"], r["grade"])] = r
    with open(D / "grade_ladder.csv", "w", newline="") as f:
        wr = csv.writer(f); wr.writerow(["card_key", "grade_company", "grade", "median_price", "n_sales", "ratio_to_next_lower_grade"])
        for ck, gs in lad.items():
            if len(gs) < 2: continue
            keys = sorted(gs, key=lambda k: (k[0], k[1]))
            for i, k in enumerate(keys):
                prev = gs[keys[i - 1]] if i and keys[i - 1][0] == k[0] else None
                wr.writerow([ck, k[0], k[1], gs[k]["median_price"], gs[k]["n_sales"],
                             round(gs[k]["median_price"] / prev["median_price"], 3) if prev else ""])
    print(f"{len(rows)} sales, {len(out)} series; as_of {asof}; ladder cards {sum(len(g)>1 for g in lad.values())}")


if __name__ == "__main__":
    main()
