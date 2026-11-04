"""ML program 1 of 5: the Pokemon card market index (v0.3).

v0.2 index: each day, the plain average of every $20+ card's daily price change, each move capped at
+-15%, chained together. Two problems: (1) most cards don't trade on a given day, so their "0% change"
dragged the average toward zero and made the index lag; (2) the 15% cap and the equal weights were
fixed choices, not learned.

v0.3 is a repeat-sales index, the method behind the Case-Shiller house price index, fitted to data:
  * Every time a card trades, we compare its price with the card's previous trade. That pair says
    "the market moved by about this much between those two days". Non-trading days add nothing.
  * The index is the daily path L[d] (log level) that best explains all ~millions of pairs at once:
        log(P_t1 / P_t0) = L[t1] - L[t0] + noise
  * Noise is learned, not fixed: pairs far apart in time are noisier (variance = a + b x gap days,
    estimated from the residuals), and outliers (a single odd sale) are down-weighted with a robust
    Huber loss instead of a hard 15% cap.
  * Smoothness is learned: a penalty on day-to-day index moves, with its strength chosen by 5-fold
    cross-validation over cards (how well the index predicts price changes of cards it never saw).
  * One index for the whole market plus one per era (vintage WOTC, 2004-2019, 2020+), because the
    segments move differently. The price model picks whichever predicts better.

Usage: python src/market_index.py WORK_DIR OUT_DIR
Writes WORK_DIR/market_index.csv (daily levels per segment, 1.0 on the first day) and
OUT_DIR/market_index_model.json (chosen smoothing, noise model, CV scores).
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import spsolve

from common import MIN_PRICE, load_wide

MAX_GAP = 180
LAMBDAS = [float(x) for x in np.geomspace(1e2, 1e10, 17)]  # penalty grid, relative to ~1/variance pair weights
HUBER_K = 1.345


def era_of(published):
    y = pd.to_datetime(published, errors="coerce").dt.tz_localize(None).dt.year
    return np.where(y < 2004, "vintage", np.where(y < 2020, "mid", "modern"))


def repeat_pairs(W):
    """All consecutive-trade pairs for cards worth >= MIN_PRICE at the earlier trade."""
    P = W["market"].to_numpy(dtype="float64")
    T = W["traded"].to_numpy()
    rows = []
    for j in range(P.shape[1]):
        t = np.flatnonzero(T[:, j] & np.isfinite(P[:, j]))
        if len(t) < 2:
            continue
        t0, t1 = t[:-1], t[1:]
        p0, p1 = P[t0, j], P[t1, j]
        ok = (p0 >= MIN_PRICE) & (t1 - t0 <= MAX_GAP)
        if ok.any():
            rows.append(np.column_stack([np.full(ok.sum(), j), t0[ok], t1[ok], np.log(p1[ok] / p0[ok])]))
    a = np.vstack(rows)
    return pd.DataFrame({"col": a[:, 0].astype(int), "t0": a[:, 1].astype(int), "t1": a[:, 2].astype(int),
                         "r": a[:, 3]})


def solve(pairs, D, lam, w):
    """Weighted least squares for the log index path with a smoothness penalty; L[0] = 0."""
    n = len(pairs)
    X = sp.csr_matrix((np.r_[np.ones(n), -np.ones(n)],
                       (np.r_[np.arange(n), np.arange(n)], np.r_[pairs["t1"].values, pairs["t0"].values])),
                      shape=(n, D))[:, 1:]
    Wd = sp.diags(w)
    # Second differences (L[d] - 2 L[d-1] + L[d-2]): penalises changes in the index's daily trend, not
    # the trend itself, so a steady rise is free and only wiggles cost (Hodrick-Prescott style).
    D2 = sp.diags([np.ones(D - 2), -2 * np.ones(D - 2), np.ones(D - 2)], [0, 1, 2], shape=(D - 2, D)).tocsc()[:, 1:]
    A = (X.T @ Wd @ X + lam * (D2.T @ D2)).tocsc()
    b = X.T @ (w * pairs["r"].values)
    return np.r_[0.0, spsolve(A, b)]


def fit(pairs, D, lam, iters=3):
    """Iteratively reweighted: learn the gap-dependent noise variance and Huber outlier weights."""
    gap = (pairs["t1"] - pairs["t0"]).values.astype(float)
    w = np.ones(len(pairs))
    noise = (None, None)
    for _ in range(iters):
        L = solve(pairs, D, lam, w)
        res = pairs["r"].values - (L[pairs["t1"].values] - L[pairs["t0"].values])
        # Case-Shiller stage: squared residual ~ a + b*gap (robust: fit on residuals clipped at 99th pct).
        e2 = np.minimum(res ** 2, np.quantile(res ** 2, 0.99))
        b_, a_ = np.polyfit(gap, e2, 1)
        a_, b_ = max(a_, 1e-5), max(b_, 1e-7)
        var = a_ + b_ * gap
        z = np.abs(res) / np.sqrt(var)
        w = (1 / var) * np.where(z <= HUBER_K, 1.0, HUBER_K / z)
        noise = (a_, b_)
    return L, w, noise


def cv_lambda(pairs, D, folds=5, seed=0):
    rng = np.random.default_rng(seed)
    cols = pairs["col"].unique()
    fold_of = dict(zip(cols, rng.integers(0, folds, len(cols))))
    f = pairs["col"].map(fold_of).values
    # One fixed noise scale for scoring every lambda (from a lightly smoothed fit), so a smoother index
    # can't look better just by claiming more noise.
    _, _, (a_, b_) = fit(pairs, D, LAMBDAS[0], iters=2)
    out = {}
    for lam in LAMBDAS:
        errs = []
        for k in range(folds):
            tr, te = pairs[f != k], pairs[f == k]
            L, _, _ = fit(tr, D, lam, iters=2)
            res = te["r"].values - (L[te["t1"].values] - L[te["t0"].values])
            var = a_ + b_ * (te["t1"] - te["t0"]).values
            z = res / np.sqrt(var)
            hub = np.where(np.abs(z) <= HUBER_K, 0.5 * z ** 2, HUBER_K * (np.abs(z) - 0.5 * HUBER_K))
            errs.append(hub.mean())
        out[lam] = float(np.mean(errs))
        print(f"  lambda {lam}: held-out robust loss {out[lam]:.5f}", flush=True)
    return min(out, key=out.get), out


def main():
    work, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    W = load_wide(work)
    days = W["market"].index
    D = len(days)
    pairs = repeat_pairs(W)
    products = pd.read_pickle(os.path.join(work, "products.pkl.gz")).drop_duplicates("product_id").set_index("product_id")
    pid = np.array([int(s.split("|")[0]) for s in W["market"].columns])
    era = era_of(products.reindex(pid)["set_published"])
    pairs["era"] = era[pairs["col"].values]
    print("repeat-sale pairs:", len(pairs), "cards:", pairs["col"].nunique(), flush=True)

    print("cross-validating smoothness (all cards)", flush=True)
    lam, cv = cv_lambda(pairs, D)
    print("chosen lambda", lam)
    levels, meta = {}, {"lambda": lam, "cv_loss_by_lambda": cv, "n_pairs": int(len(pairs)), "segments": {}}
    for seg, g in [("all", pairs)] + [(e, pairs[pairs["era"] == e]) for e in ("vintage", "mid", "modern")]:
        L, w, (a_, b_) = fit(g, D, lam)
        levels[seg] = np.exp(L)
        meta["segments"][seg] = {"n_pairs": int(len(g)), "n_cards": int(g["col"].nunique()),
                                 "noise_var_base": a_, "noise_var_per_day": b_,
                                 "share_downweighted_outliers": float(np.mean(w * (a_ + b_ * (g["t1"] - g["t0"]).values) < 0.999)),
                                 "total_change_pct": float(100 * (np.exp(L[-1]) - 1))}
        print(seg, meta["segments"][seg], flush=True)
    idx = pd.DataFrame(levels, index=days)
    idx.index.name = "date"
    idx["market_index"] = idx["all"]  # v0.2 column name, kept for anything that reads it
    idx.to_csv(os.path.join(work, "market_index.csv"))
    np.save(os.path.join(work, "card_era.npy"), era)
    pd.DataFrame({"sid": W["market"].columns, "era": era}).to_csv(os.path.join(work, "card_era.csv"), index=False)
    json.dump(meta, open(os.path.join(out, "market_index_model.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
