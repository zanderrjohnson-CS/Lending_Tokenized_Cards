"""ML program 3 of 5 (stability): the stand-in-label model: predict each card's worst price drop over the next 90 days.

Walk-forward evaluation: for each test quarter, train only on as-of dates whose 90-day label
window closed before the quarter starts (no peeking). Out-of-sample predictions from all quarters
are then used to (1) measure accuracy against simple baselines and (2) calibrate risk tiers.

Usage: python src/train_drawdown_model.py WORK_DIR OUT_DIR
Writes OUT_DIR/model_metrics.json, OUT_DIR/oos_predictions.csv.gz, OUT_DIR/feature_importance.csv,
and saves the final model (trained on all labelled data) to OUT_DIR/drawdown_model_*.txt.
"""
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

NUM = ["log_price", "ret_7", "ret_30", "ret_90", "ret_180", "vol_30", "vol_90", "vol_180",
       "downvol_30", "downvol_90", "downvol_180", "past_dd_90", "past_dd_180", "off_high_90",
       "off_high_180", "sale_days_30", "sale_days_90", "coverage_180", "low_to_market", "mid_to_market",
       "spread_hl", "mkt_ret_30", "mkt_ret_90", "seg_ret_30", "seg_ret_90", "set_age_days", "vintage"]
CAT = ["rarity_group", "sub_type"]
FEATURES = NUM + CAT
TARGET = "fwd_dd_90"
# No trading-frequency gate: every card over $20 is scored. Thin trading is handled in the score
# (liquidity sub-score) and priced into the rate instead. Kept as a knob, 0 = off.
MIN_SALE_DAYS_90 = 0
BIG_DROP = 0.30          # "would have wiped out a typical 50-60% LTV cushion after selling costs"
QUANTILES = (0.5, 0.9)
PARAMS = dict(n_estimators=400, learning_rate=0.03, num_leaves=31, min_child_samples=200,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1)


def prep(df):
    X = df[FEATURES].copy()
    for c in CAT:
        X[c] = X[c].astype("category")
    return X


def fit(train, objective, alpha=None):
    kw = dict(PARAMS, objective=objective)
    if alpha is not None:
        kw["alpha"] = alpha
    m = lgb.LGBMRegressor(**kw)
    m.fit(prep(train), train[TARGET])
    return m


def baseline_formula(df):
    """Hand-weighted style score built from the same inputs (higher = riskier), for comparison.
    Mirrors the current composite: volatility, liquidity, spread and trend, fixed weights."""
    z = lambda s: (s - s.mean()) / (s.std() + 1e-9)  # noqa: E731
    return (0.25 * z(df["vol_90"]) - 0.30 * z(np.log1p(df["sale_days_30"])) + 0.15 * z(df["spread_hl"].fillna(0))
            - 0.15 * z(df["ret_90"]))


def evaluate(y, pred, name):
    pred = pd.Series(np.asarray(pred, dtype=float))
    pred = pred.fillna(pred.median())  # baselines have gaps where a card lacks 90 days of returns
    y = pd.Series(np.asarray(y))
    big = (y > BIG_DROP).astype(int)
    out = {"model": name, "n": int(len(y)), "spearman": float(spearmanr(y, pred).correlation),
           "auc_big_drop": float(roc_auc_score(big, pred)) if big.nunique() > 1 else None}
    # Top-vs-bottom quintile: how well does the ranking separate safe from risky cards?
    q = pd.qcut(pd.Series(pred).rank(method="first"), 5, labels=False)
    yy = pd.Series(np.asarray(y))
    out["dd_safest_fifth"] = float(yy[q.values == 0].mean())
    out["dd_riskiest_fifth"] = float(yy[q.values == 4].mean())
    out["big_drop_rate_safest_fifth"] = float((yy[q.values == 0] > BIG_DROP).mean())
    out["big_drop_rate_riskiest_fifth"] = float((yy[q.values == 4] > BIG_DROP).mean())
    return out


def main():
    work, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    panel = pd.read_pickle(os.path.join(work, "panel.pkl.gz"))
    lab = panel.dropna(subset=[TARGET])
    lab = lab[(lab["fwd_cover"] > 0.8) & (lab["coverage_180"] > 0.5)
              & (lab["sale_days_90"] >= MIN_SALE_DAYS_90)].copy()
    lab[TARGET] = lab[TARGET].clip(upper=0.95)
    print("labelled rows:", len(lab), "as-of range:", lab["asof"].min().date(), lab["asof"].max().date())

    quarters = pd.period_range(lab["asof"].min() + pd.Timedelta(days=270), lab["asof"].max(), freq="Q")
    oos = []
    for q in quarters:
        start, end = q.start_time, q.end_time
        tr = lab[lab["asof"] <= start - pd.Timedelta(days=91)]
        te = lab[(lab["asof"] >= start) & (lab["asof"] <= end)].copy()
        if len(tr) < 3000 or len(te) == 0:
            continue
        te["pred_mean"] = fit(tr, "regression").predict(prep(te))
        for a in QUANTILES:
            te[f"pred_q{int(a * 100)}"] = fit(tr, "quantile", a).predict(prep(te))
        te["pred_naive_vol"] = te["vol_90"]
        te["pred_formula"] = baseline_formula(te)
        te["test_quarter"] = str(q)
        oos.append(te)
        print(q, "train", len(tr), "test", len(te), flush=True)
    oos = pd.concat(oos)
    # Average with the median quantile model: a little more robust to the fat right tail.
    oos["pred"] = 0.5 * oos["pred_mean"] + 0.5 * oos["pred_q50"]

    metrics = {"overall": [evaluate(oos[TARGET], oos[c], c) for c in
                           ("pred", "pred_q90", "pred_naive_vol", "pred_formula")]}
    metrics["by_quarter"] = []
    for q, g in oos.groupby("test_quarter"):
        for c in ("pred", "pred_formula"):
            r = evaluate(g[TARGET], g[c], c)
            r["quarter"] = q
            metrics["by_quarter"].append(r)
    metrics["q90_coverage"] = float((oos[TARGET] <= oos["pred_q90"]).mean())
    metrics["label_summary"] = oos[TARGET].describe(percentiles=[.5, .75, .9, .95]).to_dict()
    json.dump(metrics, open(os.path.join(out, "model_metrics.json"), "w"), indent=2, default=str)
    keep = ["sid", "asof", "name", "set_name", "sub_type", "rarity_group", "price", TARGET, "fwd_ret_90",
            "pred", "pred_mean", "pred_q50", "pred_q90", "pred_formula", "test_quarter", "sale_days_90",
            "suggested_price", "fwd_end_price", "liq_price", "liq_wait_days", "liq_window_complete",
            # inputs the loan-terms model also uses
            "vol_90", "downvol_90", "ret_30", "ret_90", "log_price", "sp_to_market", "mkt_ret_90", "seg_ret_90",
            "set_age_days"]
    oos[keep].to_csv(os.path.join(out, "oos_predictions.csv.gz"), index=False, float_format="%.6g")

    # Final models on everything, for scoring today's cards.
    final = {"mean": fit(lab, "regression")}
    for a in QUANTILES:
        final[f"q{int(a * 100)}"] = fit(lab, "quantile", a)
    for k, m in final.items():
        m.booster_.save_model(os.path.join(out, f"drawdown_model_{k}.txt"))
    imp = pd.DataFrame({"feature": FEATURES,
                        "gain": final["mean"].booster_.feature_importance("gain")}).sort_values("gain", ascending=False)
    imp["share"] = imp["gain"] / imp["gain"].sum()
    imp.to_csv(os.path.join(out, "feature_importance.csv"), index=False)
    print(json.dumps(metrics["overall"], indent=1))
    print("q90 coverage", metrics["q90_coverage"])
    print(imp.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
