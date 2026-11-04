"""Turn the tcgcsv daily backfill into a training panel: features at an as-of date, the learned
suggested price (price_model.py), and forward outcomes used as training labels:
  * fwd_dd_90: worst price drop over the next 90 days (stability model)
  * fwd_end_price: smoothed price at loan maturity (day 90)
  * liq_price / liq_wait_days: the first actual trade at or after maturity (days 90-150), i.e. what a
    lender selling a defaulted card would have been able to get, and how long they'd have waited.

v0.3 reads the learned market index (market_index.py) and price model (price_model.py) instead of
fixed rules.

One row = one card printing (TCGplayer product + sub type such as Holofoil / Reverse Holofoil)
on one as-of date. Only cards worth at least MIN_PRICE on the as-of date are kept, since cheap
cards would never be loan collateral.

Usage: python src/build_panel.py WORK_DIR OUT_DIR
Reads WORK_DIR/wide.pkl (common.load_wide), WORK_DIR/market_index.csv, OUT_DIR/price_model.json;
writes WORK_DIR/panel.pkl.gz.
"""
import glob
import os
import sys

import json

import numpy as np
import pandas as pd

from common import MIN_PRICE, load_wide
from price_model import card_index, suggested_price

HORIZON = 90          # loan term in days for the label
LOOKBACK = 180        # history needed before an as-of date
LIQ_WINDOW = 60       # after maturity, how long a lender would wait for a buyer
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


def main():
    work, out = sys.argv[1], sys.argv[2]
    W = load_wide(work)
    mkt_f, present, changed = W["market"], W["present"], W["traded"]
    print("price matrix:", mkt_f.shape)
    # 7-day rolling median: TCGplayer "market price" jumps on single odd sales; lenders would mark
    # collateral on a smoothed value, so labels and most features use it.
    sm = mkt_f.rolling(7, min_periods=3).median()
    logp = np.log(mkt_f)
    dret = logp.diff()
    pm = json.load(open(os.path.join(out, "price_model.json")))["params"]
    cols = mkt_f.columns
    logI = card_index(work, cols, pm["index"])          # each card's own (era) market index, log
    idx_all = np.log(pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0)["all"].to_numpy())
    Pm = mkt_f.to_numpy(dtype="float64")
    Tm = changed.to_numpy()

    products = pd.read_pickle(os.path.join(work, "products.pkl.gz")).drop_duplicates("product_id")
    products["set_published"] = pd.to_datetime(products["set_published"], errors="coerce").dt.tz_localize(None)
    meta = products.set_index("product_id")

    dates = mkt_f.index
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
        ci = cols.get_indexer(sids)
        sp, n_eff, tau = suggested_price(pm, W, logI, i, ci)
        f["suggested_price"] = sp
        f["sp_n_eff"] = n_eff
        f["sp_tau_days"] = tau
        traded = Tm[:i + 1, ci] & np.isfinite(Pm[:i + 1, ci])
        f["sp_n_trades_365"] = traded[-365:].sum(0)
        has = traded.any(0)
        last_i = np.where(has, i - np.argmax(traded[::-1], axis=0), -1)
        f["last_trade_price"] = np.where(has, Pm[np.clip(last_i, 0, None), ci], np.nan)
        f["last_trade_date"] = [dates[d].date().isoformat() if d >= 0 else None for d in last_i]
        f["sp_to_market"] = sp / p0[sids].values
        f["mkt_ret_30"] = idx_all[i] - idx_all[i - 30]
        f["mkt_ret_90"] = idx_all[i] - idx_all[i - 90]
        f["seg_ret_30"] = logI[i, ci] - logI[i - 30, ci]
        f["seg_ret_90"] = logI[i, ci] - logI[i - 90, ci]
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
            f["fwd_sale_days_90"] = Tm[i + 1:i + 1 + HORIZON, ci].sum(0)
            # Liquidation: first real trade at/after maturity, within LIQ_WINDOW days.
            a, b = i + HORIZON, min(i + HORIZON + LIQ_WINDOW, len(dates) - 1)
            T2 = Tm[a:b + 1, ci] & np.isfinite(Pm[a:b + 1, ci])
            got = T2.any(0)
            k = np.argmax(T2, axis=0)
            f["liq_price"] = np.where(got, Pm[a + k, ci], np.nan)
            f["liq_wait_days"] = np.where(got, k, np.nan)
            f["liq_window_complete"] = (i + HORIZON + LIQ_WINDOW) <= len(dates) - 1
        rows.append(f)
    panel = pd.concat(rows).reset_index(names="sid")
    panel = panel[panel["is_card"] == True]  # noqa: E712  (drop sealed product, handled separately)
    panel["rarity_group"] = panel["rarity"].map(rarity_group)
    panel["vintage"] = (panel["set_age_days"] > 365 * 15).astype(int)
    panel.to_pickle(os.path.join(work, "panel.pkl.gz"), compression="gzip")
    lab = panel.dropna(subset=["fwd_dd_90"])
    print("panel rows:", len(panel), "labelled:", len(lab), "series:", panel["sid"].nunique(),
          "as-of dates:", lab["asof"].nunique())
    print(lab["fwd_dd_90"].describe(percentiles=[.5, .75, .9, .95, .99]))


if __name__ == "__main__":
    main()
