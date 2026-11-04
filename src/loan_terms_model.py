"""ML program 5 of 5: suggested loan amount and interest rate, as a negotiable curve (v0.3).

v0.2: loan = 90% of the suggested price for every card; APR read off a score-bucket table.

v0.3 learns, for each card, the whole spread of outcomes a lender faces, then prices any loan size:

  1. A distributional model (gradient-boosted, location + scale + learned residual shape) predicts,
     per $ of suggested price:
       V = the card's value when a 90-day loan matures (what the borrower compares the debt with)
       R = what the lender actually realises selling it after a default: the first real trade at or
           after maturity, discounted for the wait (see safety_score_model.realisable)
     Inputs: liquidity and stability percentiles, safety score, volatility, recent returns, price
     level, distance from the market price, market and segment momentum, set age, rarity.
     V and R are drawn together (from the same historical residual pairs), so a card that's both
     falling and hard to sell gets both at once.

  2. For any advance L (loan / suggested price) the break-even APR is solved numerically: the lowest
     rate at which the lender's expected repayment covers cost of funds + servicing + a capital
     buffer of CAPITAL_MULT x expected loss. Borrowers default when the card is worth less than the
     debt, and BASE_DEFAULT of the others default anyway. There is NO rate cap: the rate rises as
     smoothly as the risk does, and above some advance no rate covers the risk (raising the rate
     only pushes more borrowers underwater). That point is the card's maximum lendable advance.

  3. Suggested loan = the advance the card covers at maturity in a 1-in-10 bad case after selling
     fees (LENDER_CONFIDENCE), solved jointly with its APR. Suggested APR = break-even APR there.
     Both are continuous in every input; neither is a fixed % or a lookup table.

  4. Every card also gets an APR-by-loan-size curve (from 20% of the suggested price up to its
     maximum lendable advance). That is the negotiation range: a borrower who wants more cash moves
     right along the curve and pays more; a lender who wants a lower rate offers less.

Assumptions that can't be learned until real loans exist (no repayment data yet): SELL_FEE,
BASE_DEFAULT, COST_OF_FUNDS, SERVICING, CAPITAL_MULT, LENDER_CONFIDENCE.

Usage: python src/loan_terms_model.py WORK_DIR OUT_DIR
Reads OUT_DIR/oos_predictions.csv.gz and the safety score model; writes OUT_DIR/loan_terms_*.txt,
OUT_DIR/loan_terms_model.json (incl. residual draws) and OUT_DIR/loan_terms_backtest.csv.
"""
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

from safety_score_model import INPUTS, LIQ_WINDOW, normalise, realisable, to_score

TERM_DAYS = 90
T = TERM_DAYS / 365
SELL_FEE = 0.10
BASE_DEFAULT = 0.05
COST_OF_FUNDS = 0.08
SERVICING = 0.04
CAPITAL_MULT = 1.0
LENDER_CONFIDENCE = 0.90
N_DRAWS = 200
APR_GRID = np.r_[0.0, np.geomspace(0.01, 50.0, 140)]  # 0% .. 5000%: a search range, not a cap
LTV_CURVE = np.round(np.arange(0.20, 1.61, 0.05), 2)

FEATS = INPUTS + ["score", "vol_90", "downvol_90", "ret_30", "ret_90", "log_price", "sp_to_market",
                  "mkt_ret_90", "seg_ret_90", "sale_days_90", "set_age_days", "rarity_group"]
CAT = ["rarity_group"]
P = dict(n_estimators=300, learning_rate=0.03, num_leaves=31, min_child_samples=300, subsample=0.8,
         subsample_freq=1, colsample_bytree=0.8, verbose=-1)
RARITIES = ["common_other", "illustration", "rare_holo", "secret_sir_hyper", "ultra"]


def X_of(df):
    X = df[FEATS].copy()
    X["rarity_group"] = pd.Categorical(X["rarity_group"], categories=RARITIES)
    return X


def fit_dist(df, seed=0):
    """Location (median) + scale (mean |residual|) models for log V and log R, plus residual pairs."""
    X = X_of(df)
    models, eps = {}, {}
    folds = np.random.default_rng(seed).integers(0, 3, len(df))
    for t in ("V", "R"):
        y = df[f"y{t}"].values
        oof = np.zeros(len(df))
        for k in range(3):  # out-of-fold medians, so residuals are honest
            m = lgb.LGBMRegressor(objective="quantile", alpha=0.5, **P).fit(X[folds != k], y[folds != k])
            oof[folds == k] = m.predict(X[folds == k])
        loc = lgb.LGBMRegressor(objective="quantile", alpha=0.5, **P).fit(X, y)
        sc = lgb.LGBMRegressor(objective="regression", **P).fit(X, np.abs(y - oof))
        s_oof = np.maximum(sc.predict(X), 1e-3)
        models[t] = (loc, sc)
        eps[t] = (y - oof) / s_oof
    pairs = np.column_stack([eps["V"], eps["R"]])
    return models, pairs


def market_shocks(work):
    """Historical 90-day moves of the whole-market index with the average trend removed: we keep the
    market's ups and downs in the risk, but don't assume the 2024-26 rise continues."""
    li = np.log(pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0)["all"].to_numpy())
    m = li[TERM_DAYS:] - li[:-TERM_DAYS]
    return m - m.mean()


def draw_pick(pairs, shocks, n=N_DRAWS, seed=1):
    rng = np.random.default_rng(seed)
    return np.column_stack([pairs[rng.choice(len(pairs), n, replace=False)], rng.choice(shocks, n)])


def draws(models, pick, df):
    """(cards x n) joint draws of V and R per $ of suggested price: card-specific outcome (market
    move removed) + a de-trended market shock shared by V and R."""
    X = X_of(df)
    out = {}
    for j, t in enumerate(("V", "R")):
        loc, sc = models[t]
        mu, s = loc.predict(X), np.maximum(sc.predict(X), 1e-3)
        out[t] = np.exp(mu[:, None] + s[:, None] * pick[None, :, j] + pick[None, :, 2])
    return out["V"], out["R"]


def lender(L, apr, V, R):
    """Per $ lent: expected repayment, expected loss, default probability. Shapes broadcast."""
    debt = L * (1 + apr * T)
    p = np.where(V < debt, 1.0, BASE_DEFAULT)
    rec = np.minimum(debt, R * (1 - SELL_FEE))
    pay = (((1 - p) * debt + p * rec) / L).mean(-1)
    el = (p * (debt - rec) / L).mean(-1)
    return pay, el, p.mean(-1)


def break_even_apr(L, V, R):
    """Lowest APR whose expected repayment covers funding + servicing + capital buffer; NaN if none."""
    hurdle = 1 + (COST_OF_FUNDS + SERVICING) * T
    L = np.broadcast_to(np.asarray(L, dtype=float), (V.shape[0],))
    best = np.full(V.shape[0], np.nan)
    prev_f = None
    for a0, a1 in zip(APR_GRID[:-1], APR_GRID[1:]):
        if prev_f is None:
            pay, el, _ = lender(L[:, None], a0, V, R)
            prev_f = pay - CAPITAL_MULT * el - hurdle
            hit = np.isnan(best) & (prev_f >= 0)
            best[hit] = a0
        pay, el, _ = lender(L[:, None], a1, V, R)
        f = pay - CAPITAL_MULT * el - hurdle
        hit = np.isnan(best) & (prev_f < 0) & (f >= 0)
        best[hit] = a0 + (a1 - a0) * (-prev_f[hit]) / (f[hit] - prev_f[hit])
        prev_f = f
        if not np.isnan(best).any():
            break
    return best


def suggest(V, R):
    """Suggested advance (1-in-10 bad-case net sale value at maturity, net of interest), its APR,
    and the default probability there. Solved as a fixed point because the APR depends on the size."""
    q = np.quantile(R * (1 - SELL_FEE), 1 - LENDER_CONFIDENCE, axis=1)
    L = q.copy()
    for _ in range(4):
        apr = break_even_apr(L, V, R)
        L = np.where(np.isnan(apr), L * 0.9, q / (1 + np.nan_to_num(apr) * T))
    apr = break_even_apr(L, V, R)
    _, el, pd_ = lender(L[:, None], np.nan_to_num(apr)[:, None], V, R)
    return L, apr, pd_, el


def curve(V, R):
    """APR at each advance on LTV_CURVE (NaN where no rate covers the risk)."""
    A = np.column_stack([break_even_apr(np.full(V.shape[0], l), V, R) for l in LTV_CURVE])
    P_ = np.column_stack([lender(np.full((V.shape[0], 1), l), np.nan_to_num(A[:, i])[:, None], V, R)[2]
                          for i, l in enumerate(LTV_CURVE)])
    return A, P_


def prepare(oos, score_model, score_ref, work):
    oos = normalise(oos)
    oos["score"] = to_score(score_model.predict(oos[INPUTS]), score_ref)
    r, ok, _ = realisable(oos)
    oos["yV_raw"] = np.log(oos["fwd_end_price"] / oos["suggested_price"])
    oos["yR_raw"] = np.log(np.clip(r, 1e-3, None))
    # Remove each card's own-era market move over the loan, so the model learns the card-specific part
    # of the outcome and not "the market went up 30% in 2025".
    idx = pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0, parse_dates=True)
    era = pd.read_csv(os.path.join(work, "card_era.csv")).set_index("sid")["era"]
    seg = oos["sid"].map(era).fillna("all").values
    li = np.log(idx[["all", "vintage", "mid", "modern"]])
    pos0 = idx.index.get_indexer(oos["asof"])
    pos1 = np.minimum(pos0 + TERM_DAYS, len(idx) - 1)
    col = li.columns.get_indexer(seg)
    move = li.to_numpy()[pos1, col] - li.to_numpy()[pos0, col]
    oos["yV"] = oos["yV_raw"] - move
    oos["yR"] = oos["yR_raw"] - move
    return oos, ok & np.isfinite(oos["yV"]) & np.isfinite(oos["yR"])


def main():
    work, out = sys.argv[1], sys.argv[2]
    sm = lgb.Booster(model_file=os.path.join(out, "safety_score_model.txt"))
    ref = np.array(json.load(open(os.path.join(out, "safety_score_model.json")))["reference_quantiles"])
    oos = pd.read_csv(os.path.join(out, "oos_predictions.csv.gz"), parse_dates=["asof"])
    oos, ok = prepare(oos, sm, ref, work)
    shocks = market_shocks(work)
    d = oos[ok].copy()
    print("training rows:", len(d), flush=True)

    # Walk-forward backtest: price each quarter's loans with a model that only knew earlier outcomes,
    # then see what the lender actually earned.
    bt = []
    for q, te in d.groupby(d["asof"].dt.to_period("Q")):
        tr = d[d["asof"] <= q.start_time - pd.Timedelta(days=TERM_DAYS + LIQ_WINDOW + 1)]
        if len(tr) < 5000:
            continue
        te = te.sample(min(len(te), 4000), random_state=0).copy()
        models, pairs = fit_dist(tr)
        V, R = draws(models, draw_pick(pairs, shocks), te)
        L, apr, pdef, el = suggest(V, R)
        te["ltv"], te["apr"], te["pred_default"], te["pred_el"] = L, apr, pdef, el
        Vr, Rr = np.exp(te["yV_raw"].values)[:, None], np.exp(te["yR_raw"].values)[:, None]  # what really happened
        pay, el_r, d_r = lender(L[:, None], np.nan_to_num(apr)[:, None], Vr, Rr)
        te["realised_return_ann"] = (pay - 1) / T
        te["realised_default"] = d_r
        te["realised_loss"] = el_r
        bt.append(te)
        print(q, "train", len(tr), "test", len(te), "median ltv", round(float(np.median(L)), 3),
              "median apr", round(float(np.nanmedian(apr)), 3), flush=True)
    B = pd.concat(bt)
    B["score_fifth"] = pd.qcut(B["score"].rank(method="first"), 5, labels=["0-20", "20-40", "40-60", "60-80", "80-100"])
    summ = B.groupby("score_fifth", observed=True).agg(
        n=("ltv", "size"), median_ltv=("ltv", "median"), median_apr=("apr", "median"),
        predicted_default=("pred_default", "mean"), realised_default=("realised_default", "mean"),
        predicted_loss=("pred_el", "mean"), realised_loss=("realised_loss", "mean"),
        realised_lender_return=("realised_return_ann", "mean")).reset_index()
    print(summ.round(4).to_string(index=False))
    B[["asof", "sid", "name", "score", "ltv", "apr", "pred_default", "realised_default", "pred_el",
       "realised_loss", "realised_return_ann"]].to_csv(os.path.join(out, "loan_terms_backtest.csv"), index=False)

    models, pairs = fit_dist(d)
    for t, (loc, sc) in models.items():
        loc.booster_.save_model(os.path.join(out, f"loan_terms_{t}_loc.txt"))
        sc.booster_.save_model(os.path.join(out, f"loan_terms_{t}_scale.txt"))
    rng = np.random.default_rng(1)
    meta = {"model": "loan-terms-dist-v0.3", "features": FEATS, "term_days": TERM_DAYS,
            "assumptions": {"sell_fee": SELL_FEE, "base_default": BASE_DEFAULT, "cost_of_funds": COST_OF_FUNDS,
                            "servicing": SERVICING, "capital_mult": CAPITAL_MULT,
                            "lender_confidence": LENDER_CONFIDENCE},
            "backtest_by_score_fifth": summ.to_dict(orient="records"),
            "backtest_overall": {"realised_lender_return": float(B["realised_return_ann"].mean()),
                                 "hurdle": COST_OF_FUNDS + SERVICING,
                                 "predicted_default": float(B["pred_default"].mean()),
                                 "realised_default": float(B["realised_default"].mean()),
                                 "median_ltv": float(B["ltv"].median()), "median_apr": float(B["apr"].median())},
            "draws_note": "each row: [V residual, R residual, de-trended 90-day market shock (log)]",
            "residual_pairs": draw_pick(pairs, shocks).round(5).tolist()}
    json.dump(meta, open(os.path.join(out, "loan_terms_model.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
