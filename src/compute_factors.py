"""Compute the six card-safety factors and a 0-100 composite from the sample data.

Usage:
    python src/compute_factors.py [--asof 2026-10-26]

Reads data/cards.csv, data/raw/pricecharting_*.txt, data/raw/tcgcsv_prices.csv,
data/raw/pokemontcg_snapshot.csv and data/raw/psa_pop.csv, writes output/factors.csv and output/factors.json, and records the day's scores in
output/score_history.csv (one row per card per as-of date). --asof defaults to the date of the
newest PriceCharting pull. Standard library only.
"""
import argparse
import csv
import glob
import json
import math
import os
import re
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Weights for the composite. Concentration is low because we only have a venue proxy for it.
WEIGHTS = {
    "liquidity": 0.30,
    "volatility": 0.25,
    "spread": 0.15,
    "trend": 0.15,
    "authenticity": 0.10,
    "concentration": 0.05,
}

# Listed prices older than this (by the source's own updated date, not our fetch date) are not used.
# pokemontcg.io's TCGplayer block stopped refreshing on 2026-10-15 and its Cardmarket block on
# 2026-07-01, so listed TCGplayer prices come from tcgcsv.com first.
MAX_PRICE_AGE_DAYS = {"tcgplayer": 3, "cardmarket": 7}

PER_30D = {"day": 30.0, "week": 30.0 / 7, "month": 1.0, "year": 30.0 / 365}


def clip(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def volume_per_30d(text):
    """'3 sales per week' -> ~12.9 sales per 30 days."""
    m = re.match(r"\s*([\d.]+)\s+sales?\s+per\s+(day|week|month|year)", text)
    return float(m.group(1)) * PER_30D[m.group(2)] if m else 0.0


def pricecharting_files(asof=None):
    paths = sorted(glob.glob(os.path.join(ROOT, "data", "raw", "pricecharting_*.txt")))
    return [p for p in paths if asof is None or os.path.basename(p)[14:24] <= asof.isoformat()]


def load_pricecharting(asof):
    cards = defaultdict(lambda: {"grades": {}, "sales": []})
    # Each file already holds the latest sales window, so use each card's newest pull: files are
    # read oldest first and a card's block in a newer file replaces the older one.
    for path in pricecharting_files(asof):
        key = None
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("== "):
                    key = line[3:].strip()
                    cards[key] = {"grades": {}, "sales": []}
                    continue
                parts = line.split("|")
                if parts[0] == "GRADE":
                    cards[key]["grades"][parts[1]] = {"price": float(parts[2]), "per_30d": volume_per_30d(parts[3])}
                elif parts[0] == "SALE":
                    cards[key]["sales"].append(
                        {"date": date.fromisoformat(parts[1]), "price": float(parts[2]), "venue": parts[3]}
                    )
    return cards


def load_snapshot(asof):
    path = os.path.join(ROOT, "data", "raw", "pokemontcg_snapshot.csv")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        rows = [r for r in csv.DictReader(f) if r["snapshot_date"] <= asof.isoformat()]
    # Newest snapshot per card.
    return {r["ptcg_id"]: r for r in sorted(rows, key=lambda r: r["snapshot_date"])}


def load_tcgcsv(asof):
    """Newest tcgcsv.com TCGplayer price row per card (the pinned tcgplayer_id product)."""
    path = os.path.join(ROOT, "data", "raw", "tcgcsv_prices.csv")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        rows = [r for r in csv.DictReader(f) if r["snapshot_date"] <= asof.isoformat()]
    out = {}
    for r in sorted(rows, key=lambda r: r["snapshot_date"]):
        out.setdefault(r["card_key"], {})[r["product_id"]] = r
    return out


def load_psa_pop(asof):
    """Newest PSA population row per card, from fetch_psa.py daily."""
    path = os.path.join(ROOT, "data", "raw", "psa_pop.csv")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        rows = [r for r in csv.DictReader(f) if r["date"] <= asof.isoformat() and r.get("total")]
    return {r["card_key"]: r for r in sorted(rows, key=lambda r: r["date"])}


def age_days(updated, asof):
    """Days between a source's own updated date and asof; None when unknown."""
    try:
        return (asof - date.fromisoformat((updated or "")[:10])).days
    except ValueError:
        return None


def listed_prices(card, tcgcsv, snap, asof):
    """TCGplayer listed low/mid/market from the freshest source, plus notes on any stale ones."""
    stale = []
    snap_fresh = False
    if snap:
        age = age_days(snap.get("tcg_updated"), asof)
        snap_fresh = age is not None and age <= MAX_PRICE_AGE_DAYS["tcgplayer"]
        if not snap_fresh:
            stale.append(f"pokemontcg.io TCGplayer ({snap.get('tcg_updated') or 'unknown'})")
    rows = tcgcsv.get(card["card_key"], {})
    r = rows.get(card.get("tcgplayer_id", "")) or next(iter(rows.values()), None)
    if r:
        # Rows fetched before price_date was recorded: assume the price is from the fetch day.
        updated = r.get("price_date") or r["snapshot_date"]
        age = age_days(updated, asof)
        if age is not None and age <= MAX_PRICE_AGE_DAYS["tcgplayer"] and r.get("mid"):
            return {"source": "tcgcsv", "updated": updated, "low": r["low"], "mid": r["mid"], "market": r["market"]}, stale
        stale.append(f"tcgcsv TCGplayer ({updated})")
    if snap_fresh:
        return {"source": "pokemontcg.io", "updated": snap["tcg_updated"], "low": snap["tcg_low"],
                "mid": snap["tcg_mid"], "market": snap["tcg_market"]}, stale
    return None, stale


def weekly_medians(sales, start, end):
    buckets = defaultdict(list)
    for s in sales:
        if start <= s["date"] <= end:
            buckets[(end - s["date"]).days // 7].append(s["price"])
    # oldest week first
    return [statistics.median(buckets[w]) for w in sorted(buckets, reverse=True)]


def max_drawdown(series):
    peak, worst = -math.inf, 0.0
    for p in series:
        peak = max(peak, p)
        worst = max(worst, (peak - p) / peak)
    return worst


def quantile(xs, q):
    xs = sorted(xs)
    i = (len(xs) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def drop_outliers(sales, lo=0.5, hi=2.0):
    """Drop sales far from the median: damaged copies, lots, mislabeled listings."""
    if len(sales) < 5:
        return sales, 0
    med = statistics.median(s["price"] for s in sales)
    kept = [s for s in sales if lo * med <= s["price"] <= hi * med]
    return kept, len(sales) - len(kept)


def compute(card, pc, snap, asof, tcgcsv=None, pop=None):
    out = {"card_key": card["card_key"], "name": card["name"], "set": card["set"], "era": card["era"]}
    grades = pc["grades"]
    sales, n_out = drop_outliers(pc["sales"])
    out["sales_sampled"], out["sales_outliers_dropped"] = len(pc["sales"]), n_out
    d30, d90, d120 = asof - timedelta(days=30), asof - timedelta(days=90), asof - timedelta(days=120)

    # --- Liquidity: modeled sales per 30 days across every grade, plus raw sales we actually saw.
    total_30d = sum(g["per_30d"] for g in grades.values())
    raw_30d = grades.get("Ungraded", {}).get("per_30d", 0.0)
    observed_30d = sum(1 for s in sales if s["date"] >= d30)
    out.update(liq_sales_30d_all_grades=round(total_30d, 1), liq_sales_30d_ungraded=round(raw_30d, 1),
               liq_observed_sales_30d=observed_30d)
    s_liq = clip(100 * math.log10(1 + total_30d) / math.log10(301))

    # --- Volatility: TCGplayer sales are all Near Mint, so they give a cleaner price path than
    # eBay raw sales, which mix every condition. Fall back to all sales when TCGplayer is thin.
    tcg = [s for s in sales if s["venue"] == "TCGplayer"]
    window_start = d90 if sum(1 for s in tcg if s["date"] >= d90) >= 8 else asof - timedelta(days=180)
    series = weekly_medians(tcg if len(tcg) >= 8 else sales, window_start, asof)
    rets = [math.log(b / a) for a, b in zip(series, series[1:])]
    sigma = statistics.pstdev(rets) if len(rets) >= 2 else None
    mdd = max_drawdown(series) if len(series) >= 2 else None
    out.update(vol_window_days=(asof - window_start).days, vol_weeks=len(series),
               vol_weekly_logret_std=round(sigma, 4) if sigma is not None else None,
               vol_max_drawdown=round(mdd, 4) if mdd is not None else None)
    parts = []
    if sigma is not None:
        parts.append(clip(100 * (1 - sigma / 0.25)))
    if mdd is not None:
        parts.append(clip(100 * (1 - mdd / 0.5)))
    s_vol = statistics.mean(parts) if parts else None

    # --- Spread: dispersion of recent sold prices, and listed (TCGplayer mid/low) vs sold.
    recent = [s["price"] for s in sales if s["date"] >= d30]
    med30 = statistics.median(recent) if recent else None
    iqr_pct = (quantile(recent, 0.75) - quantile(recent, 0.25)) / med30 if len(recent) >= 4 else None
    hl_pct = (max(recent) - min(recent)) / med30 if len(recent) >= 2 else None
    out.update(spr_median_sold_30d=round(med30, 2) if med30 else None,
               spr_iqr_pct=round(iqr_pct, 4) if iqr_pct is not None else None,
               spr_high_low_pct=round(hl_pct, 4) if hl_pct is not None else None)
    listed, stale = listed_prices(card, tcgcsv or {}, snap, asof)
    if listed:
        tcg_low, tcg_mid, tcg_mkt = (float(listed[k]) if listed[k] else None for k in ("low", "mid", "market"))
        out.update(spr_tcg_low=tcg_low, spr_tcg_mid=tcg_mid, spr_tcg_market=tcg_mkt,
                   spr_listed_source=listed["source"], spr_listed_updated=listed["updated"],
                   spr_listed_mid_vs_sold=round(tcg_mid / med30 - 1, 4) if med30 and tcg_mid else None)
    s_spr = clip(100 * (1 - iqr_pct / 0.6)) if iqr_pct is not None else None

    # --- Authenticity: no population data without a PSA account, so we use how much of the
    # market trades graded (verifiable, slabbed) and how steep the raw-to-PSA 10 premium is.
    graded_30d = total_30d - raw_30d
    graded_share = graded_30d / total_30d if total_30d else 0.0
    raw_price = grades.get("Ungraded", {}).get("price")
    psa10 = grades.get("PSA 10", {}).get("price")
    out.update(auth_graded_share=round(graded_share, 4),
               auth_psa10_over_raw=round(psa10 / raw_price, 2) if raw_price and psa10 else None,
               auth_psa_pop_total=None, auth_psa10_share=None, auth_psa_pop_date=None)
    s_auth = clip(100 * graded_share / 0.9)
    if pop:
        # A deep PSA population means plenty of verified slabs to compare and resell against.
        total = float(pop["total"])
        out.update(auth_psa_pop_total=int(total), auth_psa_pop_date=pop["date"],
                   auth_psa10_share=round(float(pop["psa10"]) / total, 4) if pop.get("psa10") and total else None)
        s_auth = statistics.mean([s_auth, clip(100 * math.log10(1 + total) / math.log10(1 + 5000))])

    # --- Concentration: buyer identities are not public anywhere. Proxy: how evenly the
    # observed sales spread across venues (1 - HHI, scaled so three even venues = 100).
    venues = Counter(s["venue"] for s in sales if s["date"] >= d90)
    n = sum(venues.values())
    hhi = sum((c / n) ** 2 for c in venues.values()) if n else 1.0
    out.update(conc_venues=len(venues), conc_venue_hhi=round(hhi, 4),
               conc_note="venue diversity proxy; distinct-buyer data not public")
    s_conc = clip(100 * (1 - hhi) / (1 - 1 / 3))

    # --- Trend: last-30-day NM median vs the 30-120 day NM median. Falls are penalized harder.
    base = tcg if len(tcg) >= 8 else sales
    now = [s["price"] for s in base if s["date"] >= d30]
    before = [s["price"] for s in base if d120 <= s["date"] < d30]
    mom = statistics.median(now) / statistics.median(before) - 1 if now and before else None
    out.update(trend_momentum_30d_vs_prior=round(mom, 4) if mom is not None else None)
    cm_age = age_days(snap.get("cm_updated"), asof) if snap else None
    if snap and float(snap.get("cm_avg30") or 0) and float(snap.get("cm_trend") or 0):
        if cm_age is not None and cm_age <= MAX_PRICE_AGE_DAYS["cardmarket"]:
            out["trend_cardmarket_trend_vs_avg30"] = round(float(snap["cm_trend"]) / float(snap["cm_avg30"]) - 1, 4)
        else:
            stale.append(f"pokemontcg.io Cardmarket ({snap.get('cm_updated') or 'unknown'})")
    out["stale_price_sources"] = "; ".join(stale)
    out["trend_reprint_flag"] = ""  # manual input: set when a reprint or promo is announced
    if mom is None:
        s_trend = None
    else:
        lm = math.log(1 + mom)
        s_trend = clip(100 * (1 - abs(lm) / 0.3)) if lm < 0 else clip(100 * (1 - lm / 0.5))

    scores = {"liquidity": s_liq, "volatility": s_vol, "spread": s_spr,
              "authenticity": s_auth, "concentration": s_conc, "trend": s_trend}
    have = {k: v for k, v in scores.items() if v is not None}
    wsum = sum(WEIGHTS[k] for k in have)
    composite = sum(WEIGHTS[k] * v for k, v in have.items()) / wsum if wsum else None
    for k, v in scores.items():
        out[f"score_{k}"] = round(v, 1) if v is not None else None
    out["safety_score"] = round(composite, 1) if composite is not None else None
    out["tier"] = None if composite is None else ("A" if composite >= 75 else "B" if composite >= 60 else "C" if composite >= 45 else "D")
    return out


HISTORY_FIELDS = ["date", "card_key", "composite", "tier", "liquidity", "volatility", "spread",
                  "authenticity", "concentration", "trend"]


def write_history(asof, rows):
    """Append this as-of date's scores; a re-run on the same date replaces that date's rows."""
    path = os.path.join(ROOT, "output", "score_history.csv")
    kept = []
    if os.path.exists(path):
        with open(path) as f:
            kept = [r for r in csv.DictReader(f) if r["date"] != asof]
    new = [{"date": asof, "card_key": r["card_key"], "composite": r["safety_score"], "tier": r["tier"],
            **{k: r[f"score_{k}"] for k in HISTORY_FIELDS[4:]}} for r in rows]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
        w.writeheader()
        w.writerows(sorted(kept + new, key=lambda r: (r["date"], r["card_key"])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", default=None)
    args = ap.parse_args()
    if args.asof is None:
        args.asof = os.path.basename(pricecharting_files()[-1])[14:24]
    asof = date.fromisoformat(args.asof)

    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    pc, snaps, tcgcsv, pops = load_pricecharting(asof), load_snapshot(asof), load_tcgcsv(asof), load_psa_pop(asof)

    rows = [compute(c, pc[c["card_key"]], snaps.get(c["ptcg_id"]), asof, tcgcsv, pops.get(c["card_key"]))
            for c in cards if c["card_key"] in pc]
    rows.sort(key=lambda r: -(r["safety_score"] or 0))

    os.makedirs(os.path.join(ROOT, "output"), exist_ok=True)
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with open(os.path.join(ROOT, "output", "factors.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(ROOT, "output", "factors.json"), "w") as f:
        json.dump({"asof": args.asof, "weights": WEIGHTS, "cards": rows}, f, indent=2)
    write_history(args.asof, rows)

    print(f"{'card':28} {'score':>6} tier  liq   vol   spr   auth  conc  trend")
    for r in rows:
        print(f"{r['card_key']:28} {r['safety_score']:>6} {r['tier']:>4}  " + "  ".join(
            f"{r['score_' + k]:>4}" if r['score_' + k] is not None else "  - "
            for k in ("liquidity", "volatility", "spread", "authenticity", "concentration", "trend")))
    stale = sorted({s for r in rows for s in r["stale_price_sources"].split("; ") if s})
    if stale:
        print(f"stale prices skipped (source last updated more than {MAX_PRICE_AGE_DAYS} days before {args.asof}):")
        for s in stale:
            print("  " + s)


if __name__ == "__main__":
    main()
