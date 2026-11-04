"""ML program 4 of 5: the safety score (v0.3).

v0.2: score = 50% liquidity + 50% stability, each on a hand-set scale (liquidity: 60+ trading days
out of 90 = 100; stability: a predicted 50% drop = 0).

v0.3:
  * Both inputs are normalised against the other cards on the same day, as percentiles 0-100:
      liquidity  = share of $20+ cards that traded on fewer days than this one in the last 90 days
      stability  = share of cards with a worse predicted bad-case (1-in-10) 90-day drop
                   (the drop comes from the stability model, train_drawdown_model.py)
    So "liquidity 80" means "trades more often than 80% of cards today", whatever the market is doing.
  * How the two combine is learned, with no fixed weights: a gradient-boosted model (monotone: more
    liquid or more stable can never lower the score) predicts what a lender actually lost on the
    card: the collateral shortfall
        shortfall = max(0, 1 - realisable value / suggested price)
    where realisable value is the first REAL trade at or after a 90-day loan's maturity (so a card
    nobody buys shows up as a long wait and a worse price), discounted for the waiting time.
    The model can learn interactions (e.g. stability matters more for rarely traded cards).
  * Score = 100 x share of historical card-days with a larger predicted shortfall. 90 means "safer
    collateral than 90% of what we've seen".

Usage: python src/safety_score_model.py WORK_DIR OUT_DIR
Reads OUT_DIR/oos_predictions.csv.gz (out-of-sample stability predictions); writes
OUT_DIR/safety_score_model.txt, OUT_DIR/safety_score_model.json.
"""
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

COST_OF_FUNDS = 0.08
LIQ_WINDOW = 60
INPUTS = ["liquidity", "stability"]
PARAMS = dict(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=500,
              monotone_constraints=[-1, -1], verbose=-1)


def normalise(df, by="asof"):
    """Cross-sectional percentiles (0-100) of trading frequency and predicted stability."""
    g = df.groupby(by)
    df["liquidity"] = 100 * g["sale_days_90"].rank(pct=True, method="average")
    df["stability"] = 100 * g["pred_q90"].rank(pct=True, method="average", ascending=False)
    return df


def realisable(df):
    """Realised liquidation value per $ of suggested price, and whether the window is complete."""
    sp = df["suggested_price"]
    sold = df["liq_price"].notna()
    r = df["liq_price"] / sp * np.exp(-COST_OF_FUNDS * df["liq_wait_days"].fillna(0) / 365)
    # Not sold within LIQ_WINDOW days of maturity: start from the quoted value at maturity, apply the
    # liquidation gap actually observed for the least-liquid tenth of cards that did sell, and charge
    # the full wait. Learned from data, not a fixed fire-sale discount.
    gap = np.log(df["liq_price"] / df["fwd_end_price"])
    thin = sold & (df["sale_days_90"] <= df.loc[sold, "sale_days_90"].quantile(0.1))
    unsold_gap = float(np.exp(gap[thin].median())) if thin.any() else 1.0
    r_unsold = df["fwd_end_price"] / sp * unsold_gap * np.exp(-COST_OF_FUNDS * (LIQ_WINDOW + 30) / 365)
    r = np.where(sold, r, r_unsold)
    ok = df["liq_window_complete"].astype(bool) & df["fwd_end_price"].notna() & (sp > 0)
    return pd.Series(r, index=df.index), ok, unsold_gap


def v02_score(df):
    liq = 100 * np.clip(np.log1p(df["sale_days_90"]) / np.log1p(60), 0, 1)
    stab = 100 * np.clip(1 - df["pred_q90"] / 0.5, 0, 1)
    return 0.5 * liq + 0.5 * stab


def fit(df):
    m = lgb.LGBMRegressor(**PARAMS)
    m.fit(df[INPUTS], df["shortfall"])
    return m


def to_score(pred, ref_sorted):
    """100 x share of reference card-days with a larger predicted shortfall (higher = safer)."""
    return 100 * (1 - np.searchsorted(ref_sorted, pred, side="left") / len(ref_sorted))


def evaluate(y, score, name):
    big = (y > 0.30).astype(int)
    q = pd.qcut(pd.Series(score).rank(method="first"), 5, labels=False).values
    return {"model": name, "n": int(len(y)), "spearman_score_vs_shortfall": float(spearmanr(score, y).correlation),
            "auc_shortfall_over_30pct": float(roc_auc_score(big, -score)),
            "mean_shortfall_safest_fifth": float(y[q == 4].mean()), "mean_shortfall_riskiest_fifth": float(y[q == 0].mean()),
            "share_over_30pct_safest_fifth": float(big[q == 4].mean()), "share_over_30pct_riskiest_fifth": float(big[q == 0].mean())}


def main():
    work, out = sys.argv[1], sys.argv[2]
    oos = pd.read_csv(os.path.join(out, "oos_predictions.csv.gz"), parse_dates=["asof"])
    oos = normalise(oos)
    r, ok, unsold_gap = realisable(oos)
    oos["realisable"] = r
    oos["shortfall"] = np.clip(1 - r, 0, 1)
    d = oos[ok].copy()
    print("rows with a complete liquidation window:", len(d), "| unsold-in-window share:",
          round(float(d["liq_price"].isna().mean()), 4), "| learned unsold price gap:", round(unsold_gap, 3))

    # Walk-forward: score each quarter with a model trained only on outcomes known before it starts.
    tests, rows = [], []
    for q, te in d.groupby(d["asof"].dt.to_period("Q")):
        tr = d[d["asof"] <= q.start_time - pd.Timedelta(days=90 + LIQ_WINDOW + 1)]
        if len(tr) < 5000:
            continue
        m = fit(tr)
        ref = np.sort(m.predict(tr[INPUTS]))
        te = te.copy()
        te["score"] = to_score(m.predict(te[INPUTS]), ref)
        te["score_v02"] = v02_score(te)
        tests.append(te)
        print(q, "train", len(tr), "test", len(te), flush=True)
    metrics = {}
    if tests:
        T = pd.concat(tests)
        metrics["walk_forward"] = [evaluate(T["shortfall"].values, T["score"].values, "v0.3 learned"),
                                   evaluate(T["shortfall"].values, T["score_v02"].values, "v0.2 50/50"),
                                   evaluate(T["shortfall"].values, T["liquidity"].values, "liquidity percentile only"),
                                   evaluate(T["shortfall"].values, T["stability"].values, "stability percentile only")]
        print(json.dumps(metrics["walk_forward"], indent=1))

    final = fit(d)
    final.booster_.save_model(os.path.join(out, "safety_score_model.txt"))
    pred = final.predict(d[INPUTS])
    ref = np.sort(pred)
    d["score"] = to_score(pred, ref)
    # How much each input moves the score, learned (replaces the fixed 50/50).
    gain = final.booster_.feature_importance("gain")
    lin = np.linalg.lstsq(np.column_stack([d["liquidity"], d["stability"], np.ones(len(d))]), d["score"], rcond=None)[0]
    grid = {f"liq{l}_stab{s}": round(float(to_score(final.predict(pd.DataFrame({"liquidity": [l], "stability": [s]})), ref)[0]), 1)
            for l in (10, 50, 90) for s in (10, 50, 90)}
    meta = {"model": "safety-score-gbm-v0.3", "inputs": INPUTS, "target": "collateral shortfall at liquidation",
            "unsold_price_gap": unsold_gap, "n_train": int(len(d)),
            "learned_importance_gain_share": dict(zip(INPUTS, (gain / gain.sum()).round(3).tolist())),
            "linear_equivalent_weights": {"liquidity": round(float(lin[0] / (lin[0] + lin[1])), 3),
                                          "stability": round(float(lin[1] / (lin[0] + lin[1])), 3)},
            "score_grid": grid,
            "reference_quantiles": np.quantile(ref, np.linspace(0, 1, 1001)).tolist(),
            **metrics}
    json.dump(meta, open(os.path.join(out, "safety_score_model.json"), "w"), indent=2)
    print({k: v for k, v in meta.items() if k not in ("reference_quantiles", "walk_forward")})


if __name__ == "__main__":
    main()
