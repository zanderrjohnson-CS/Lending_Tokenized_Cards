"""Shared loading for the v0.3 pipeline: the daily price matrix built from the tcgcsv backfill.

Every model in v0.3 starts from the same three daily matrices (rows = days, columns = card printings
"productId|subType"):
  * market:  TCGplayer market price, short gaps (missing archive days) forward-filled up to 7 days
  * present: the card was in that day's feed
  * traded:  the market price moved that day, our proxy for "at least one sale happened"
"""
import glob
import os

import numpy as np
import pandas as pd

MIN_PRICE = 20.0   # collateral floor, USD: only cards worth this much are scored or used for the index
KEEP_PRICE = 15.0  # keep any series that was ever worth this much, so cards crossing $20 have history


def load_wide(work):
    cache = os.path.join(work, "wide.pkl")
    if os.path.exists(cache):
        return pd.read_pickle(cache)
    files = sorted(glob.glob(os.path.join(work, "prices", "*.pkl.gz")))
    parts = [pd.read_pickle(f)[["date", "product_id", "sub_type", "low", "mid", "high", "market"]] for f in files]
    df = pd.concat(parts, ignore_index=True)
    df["sid"] = df["product_id"].astype(str) + "|" + df["sub_type"].fillna("")
    keep = df.groupby("sid")["market"].max()
    df = df[df["sid"].isin(keep.index[keep >= KEEP_PRICE])]
    out = {}
    for col in ["market", "low", "mid", "high"]:
        out[col] = df.pivot_table(index="date", columns="sid", values=col, aggfunc="last").astype("float32")
    days = pd.date_range(out["market"].index.min(), out["market"].index.max(), freq="D")
    cols = out["market"].columns
    for col in out:
        out[col] = out[col].reindex(index=days, columns=cols)
    present = out["market"].notna()
    market = out["market"].ffill(limit=7)
    traded = (market.diff().abs() > 1e-6) & present
    W = {"market": market, "present": present, "traded": traded, "low": out["low"], "mid": out["mid"],
         "high": out["high"]}
    pd.to_pickle(W, cache)
    return W
