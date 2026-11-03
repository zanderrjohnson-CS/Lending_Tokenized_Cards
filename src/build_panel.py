"""Turn the tcgcsv daily backfill into a training panel: features at an as-of date and the
"stand-in default" label, the worst price drop over the next 90 days.

One row = one card printing (TCGplayer product + sub type such as Holofoil / Reverse Holofoil)
on one as-of date. Only cards worth at least MIN_PRICE on the as-of date are kept, since cheap
cards would never be loan collateral.

Usage: python src/build_panel.py WORK_DIR
Reads WORK_DIR/prices/*.pkl.gz and WORK_DIR/products.pkl.gz, writes WORK_DIR/panel.pkl.gz and
WORK_DIR/wide_market.pkl.gz (the daily price matrix, reused for scoring today's cards).
"""
import glob
import os
import sys

import numpy as np
import pandas as pd

MIN_PRICE = 20.0      # collateral floor, USD
HORIZON = 90          # loan term in days for the label
LOOKBACK = 180        # history needed before an as-of date
STEP = 14             # days between as-of dates (labels overlap anyway, so denser adds little)


def rarity_group(r):
    r = (r or "").lower()
    if "special illustration" in r or "hyper" in r or "secret" in r:
        return "secret_sir_hyper"
    if "illustration" in r:
        return "illustration"
    if "ultra" in r or "double" in r or "ace" in r:
        return "ultra"
    if "holo" in r or "rare" in r or "promo" in r:
        return "rare_holo"
    return "common_other"


SP_HALF_LIFE = 14     # days: a price from 2 weeks ago counts half as much as today's
SP_WINDOW = 180       # days of history used for the suggested price


def suggested_price(mkt_f, changed, idx_level, i, sids):
    """Suggested price on day i: recency-weighted median of the prices on days the card actually
    traded (market price moved) in the last SP_WINDOW days, each first rolled forward to today by
    the market-wide index (a $5 sale when the whole market was 20% lower counts as ~$6 today).
    Today's market price is always included. Returns (price, n_obs, last_trade_price, last_trade_day)."""
    lo = max(0, i - SP_WINDOW + 1)
    P = mkt_f.iloc[lo:i + 1][sids].to_numpy(dtype="float64")
    C = changed.iloc[lo:i + 1][sids].to_numpy(copy=True)
    C[-1, :] = True
    adj = (idx_level[i] / idx_level[lo:i + 1])[:, None]
    age = (i - np.arange(lo, i + 1))[:, None]
    w = np.where(C & np.isfinite(P), 0.5 ** (age / SP_HALF_LIFE), 0.0)
    v = np.where(np.isfinite(P), P * adj, np.inf)
    order = np.argsort(v, axis=0)
    vs = np.take_along_axis(v, order, axis=0)
    ws = np.take_along_axis(w, order, axis=0)
    cw = np.cumsum(ws, axis=0)
    tot = cw[-1]
    k = (cw >= 0.5 * tot[None, :]).argmax(axis=0)
    sp = vs[k, np.arange(vs.shape[1])]
    sp = np.where(tot > 0, sp, np.nan)
    n = (C[:-1] & np.isfinite(P[:-1])).sum(axis=0)
    traded = C[:-1] & np.isfinite(P[:-1])
    last_idx = np.where(traded.any(axis=0), traded.shape[0] - 1 - np.argmax(traded[::-1], axis=0), -1)
    last_px = np.where(last_idx >= 0, P[np.clip(last_idx, 0, None), np.arange(P.shape[1])], np.nan)
    last_day = np.where(last_idx >= 0, lo + last_idx, -1)
    return sp, n, last_px, last_day


def load_wide(work):
    files = sorted(glob.glob(os.path.join(work, "prices", "*.pkl.gz")))
    parts = []
    for f in files:
        df = pd.read_pickle(f)
        parts.append(df[["date", "product_id", "sub_type", "low", "mid", "high", "market"]])
    df = pd.concat(parts, ignore_index=True)
    df["sid"] = df["product_id"].astype(str) + "|" + df["sub_type"].fillna("")
    out = {}
    for col in ["market", "low", "mid", "high"]:
        out[col] = df.pivot_table(index="date", columns="sid", values=col, aggfunc="last").astype("float32")
    idx = pd.date_range(out["market"].index.min(), out["market"].index.max(), freq="D")
    for col in out:
        out[col] = out[col].reindex(idx)
    return out


def main():
    work = sys.argv[1]
    W = load_wide(work)
    mkt = W["market"]
    print("price matrix:", mkt.shape)
    # Present-in-feed flag before filling gaps, and forward-fill short gaps (missing archive days).
    present = mkt.notna()
    mkt_f = mkt.ffill(limit=7)
    # 7-day rolling median: TCGplayer "market price" jumps on single odd sales; lenders would mark
    # collateral on a smoothed value, so labels and most features use it.
    sm = mkt_f.rolling(7, min_periods=3).median()
    logp = np.log(mkt_f)
    dret = logp.diff()
    changed = (mkt_f.diff().abs() > 1e-6) & present  # market price moved => at least one sale that day

    # Market-wide index: average daily log return across all cards over $20, each day's moves capped
    # at +-15% so a few repricings can't swing it. (A median would be ~0 every day, since most cards
    # don't change price on a given day.)
    big = mkt_f.where(mkt_f.shift(1) >= MIN_PRICE)
    idx_ret = dret.where(big.notna()).clip(-0.15, 0.15).mean(axis=1).fillna(0).cumsum()
    idx_level = np.exp(idx_ret.to_numpy())

    products = pd.read_pickle(os.path.join(work, "products.pkl.gz")).drop_duplicates("product_id")
    products["set_published"] = pd.to_datetime(products["set_published"], errors="coerce").dt.tz_localize(None)
    meta = products.set_index("product_id")

    dates = mkt.index
    asofs = [d for d in dates[LOOKBACK::STEP] if d + pd.Timedelta(days=HORIZON) <= dates[-1]]
    asofs_live = [dates[-1]]  # today: features only, used to score current cards
    rows = []
    for t in asofs + asofs_live:
        i = dates.get_loc(t)
        p0 = sm.iloc[i]
        ok = (p0 >= MIN_PRICE) & present.iloc[i - 6:i + 1].any()
        sids = p0.index[ok.values]
        if len(sids) == 0:
            continue
        P = sm.iloc[:i + 1][sids]
        R = dret.iloc[:i + 1][sids]
        f = pd.DataFrame(index=sids)
        f["asof"] = t
        f["price"] = p0[sids].values
        f["log_price"] = np.log(f["price"])
        for k in (7, 30, 90, 180):
            f[f"ret_{k}"] = np.log(p0[sids] / P.iloc[-1 - k]).values
        for k in (30, 90, 180):
            r = R.iloc[-k:]
            f[f"vol_{k}"] = r.std().values * np.sqrt(365)
            f[f"downvol_{k}"] = r.clip(upper=0).pow(2).mean().pow(0.5).values * np.sqrt(365)
        for k in (90, 180):
            w = P.iloc[-k:]
            f[f"past_dd_{k}"] = (1 - w / w.cummax()).max().values
            f[f"off_high_{k}"] = (1 - p0[sids] / w.max()).values
        f["sale_days_30"] = changed.iloc[i - 29:i + 1][sids].sum().values
        f["sale_days_90"] = changed.iloc[i - 89:i + 1][sids].sum().values
        f["coverage_180"] = present.iloc[i - 179:i + 1][sids].mean().values
        lo, mid, hi, mk = (W[c].iloc[i][sids].values for c in ("low", "mid", "high", "market"))
        f["low_to_market"] = lo / mk
        f["mid_to_market"] = mid / mk
        f["spread_hl"] = (hi - lo) / mid
        sp, n_obs, last_px, last_day = suggested_price(mkt_f, changed, idx_level, i, sids)
        f["suggested_price"] = sp
        f["sp_n_trades_180"] = n_obs
        f["last_trade_price"] = last_px
        f["last_trade_date"] = [dates[d].date().isoformat() if d >= 0 else None for d in last_day]
        f["sp_to_market"] = sp / p0[sids].values
        f["mkt_ret_30"] = idx_ret.iloc[i] - idx_ret.iloc[i - 30]
        f["mkt_ret_90"] = idx_ret.iloc[i] - idx_ret.iloc[i - 90]
        pid = np.array([int(s.split("|")[0]) for s in sids])
        f["product_id"] = pid
        f["sub_type"] = [s.split("|", 1)[1] for s in sids]
        m = meta.reindex(pid)
        f["name"] = m["name"].values
        f["set_name"] = m["set_name"].values
        f["group_id"] = m["group_id"].values
        f["rarity"] = m["rarity"].values
        f["is_card"] = m["is_card"].fillna(False).values
        f["set_age_days"] = (t - m["set_published"]).dt.days.values
        # Label: worst drop below the as-of value over the next 90 days (smoothed price).
        if t in asofs:
            fut = sm.iloc[i + 1:i + 1 + HORIZON][sids]
            f["fwd_dd_90"] = (1 - fut.min() / p0[sids]).clip(lower=0).values
            f["fwd_ret_90"] = np.log(fut.iloc[-1] / p0[sids]).values
            f["fwd_cover"] = fut.notna().mean().values
            f["fwd_end_price"] = fut.iloc[-1].values  # smoothed value when the 90-day loan matures
        rows.append(f)
    panel = pd.concat(rows).reset_index(names="sid")
    panel = panel[panel["is_card"] == True]  # noqa: E712  (drop sealed product, handled separately)
    panel["rarity_group"] = panel["rarity"].map(rarity_group)
    panel["vintage"] = (panel["set_age_days"] > 365 * 15).astype(int)
    panel.to_pickle(os.path.join(work, "panel.pkl.gz"), compression="gzip")
    mkt_f.to_pickle(os.path.join(work, "wide_market.pkl.gz"), compression="gzip")
    pd.Series(idx_level, index=dates, name="market_index").to_csv(os.path.join(work, "market_index.csv"))
    lab = panel.dropna(subset=["fwd_dd_90"])
    print("panel rows:", len(panel), "labelled:", len(lab), "series:", panel["sid"].nunique(),
          "as-of dates:", lab["asof"].nunique())
    print(lab["fwd_dd_90"].describe(percentiles=[.5, .75, .9, .95, .99]))


if __name__ == "__main__":
    main()
