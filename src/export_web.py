"""Score today's cards with all five v0.3 models and write the website feed.

  market index (market_index.py) -> suggested price (price_model.py) -> stability model
  (train_drawdown_model.py) -> safety score (safety_score_model.py) -> loan size + APR + negotiation
  curve (loan_terms_model.py)

Usage: python src/export_web.py WORK_DIR OUT_DIR
Writes OUT_DIR/scores_today.csv, OUT_DIR/web_cards.json (10 starter cards + 490 most-traded),
OUT_DIR/web_cards_all.json (every $20+ card).

web_cards.json keeps every field the site reads in v0.2 (score, factors.liquidity/stability,
suggested_price_usd, price_basis, max_loan_usd, apr_pct, default_prob_90d). New in v0.3:
suggested_ltv, max_lendable_ltv, negotiation.apr_curve, and price_basis.recency_weight.
"""
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

import loan_terms_model as LT
import price_model as PM
from safety_score_model import INPUTS, normalise, to_score
from train_drawdown_model import CAT, FEATURES

STARTER = {  # card_key -> (name prefix, TCGplayer set name, printing)
    "base-charizard": ("Charizard", "Base Set", "Holofoil"),
    "base-blastoise": ("Blastoise", "Base Set", "Holofoil"),
    "base-venusaur": ("Venusaur", "Base Set", "Holofoil"),
    "umbreon-vmax-alt": ("Umbreon VMAX (Alternate Art Secret)", "SWSH07: Evolving Skies", "Holofoil"),
    "gengar-vmax-alt": ("Gengar VMAX (Alternate Art Secret)", "SWSH08: Fusion Strike", "Holofoil"),
    "giratina-v-alt": ("Giratina V (Alternate Full Art)", "SWSH11: Lost Origin", "Holofoil"),
    "lugia-v-alt": ("Lugia V (Alternate Full Art)", "SWSH12: Silver Tempest", "Holofoil"),
    "charizard-ex-151-sir": ("Charizard ex - 199/165", "SV: Scarlet & Violet 151", "Holofoil"),
    "charizard-ex-obf-sir": ("Charizard ex - 223/197", "SV03: Obsidian Flames", "Holofoil"),
    "pikachu-grey-felt-hat": ("Pikachu with Grey Felt Hat", "SV: Scarlet & Violet Promo Cards", "Normal"),
}


def r2(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def main():
    work, out = sys.argv[1], sys.argv[2]
    panel = pd.read_pickle(os.path.join(work, "panel.pkl.gz"))
    live = panel[panel["asof"] == panel["asof"].max()].copy()

    # Stability model -> percentiles -> safety score.
    X = live[FEATURES].copy()
    for c in CAT:
        X[c] = pd.Categorical(X[c], categories=sorted(panel[c].dropna().unique()))
    for k in ("mean", "q50", "q90"):
        live[f"pred_{k}"] = lgb.Booster(model_file=os.path.join(out, f"drawdown_model_{k}.txt")).predict(X)
    live = normalise(live)
    sm = lgb.Booster(model_file=os.path.join(out, "safety_score_model.txt"))
    smeta = json.load(open(os.path.join(out, "safety_score_model.json")))
    live["pred_shortfall"] = sm.predict(live[INPUTS])
    live["score"] = to_score(live["pred_shortfall"].values, np.array(smeta["reference_quantiles"]))

    # Loan terms.
    lmeta = json.load(open(os.path.join(out, "loan_terms_model.json")))
    pick = np.array(lmeta["residual_pairs"])
    Xl = LT.X_of(live)
    dr = {}
    for j, t in enumerate(("V", "R")):
        loc = lgb.Booster(model_file=os.path.join(out, f"loan_terms_{t}_loc.txt")).predict(Xl)
        sc = np.maximum(lgb.Booster(model_file=os.path.join(out, f"loan_terms_{t}_scale.txt")).predict(Xl), 1e-3)
        dr[t] = np.exp(loc[:, None] + sc[:, None] * pick[None, :, j] + pick[None, :, 2])
    L, apr, pdef, el = LT.suggest(dr["V"], dr["R"])
    A, Pd = LT.curve(dr["V"], dr["R"])
    pos = {k: i for i, k in enumerate(live.index)}  # row of A / Pd for each card, before any re-sorting
    live["suggested_ltv"], live["apr"], live["default_prob_90d"] = L, apr, pdef
    live["max_loan_usd"] = (L * live["suggested_price"]).round(2)
    feas = ~np.isnan(A)
    live["max_lendable_ltv"] = np.where(feas.any(1), LT.LTV_CURVE[np.where(feas.any(1), feas.shape[1] - 1 - np.argmax(feas[:, ::-1], 1), 0)], np.nan)
    live["value_q10"] = np.quantile(dr["V"], 0.1, axis=1)
    live["value_q50"] = np.quantile(dr["V"], 0.5, axis=1)

    live["card_key"] = "tcg-" + live["product_id"].astype(str) + "-" + live["sub_type"].str.lower().str.replace(" ", "-")
    for key, (name, set_name, sub) in STARTER.items():
        m = (live["name"].str.startswith(name)) & (live["set_name"] == set_name) & (live["sub_type"] == sub)
        if m.sum() == 0:
            print("starter card not found:", key)
            continue
        live.loc[live.index[m.values.nonzero()[0][0]], "card_key"] = key
    live["starter"] = live["card_key"].isin(STARTER)
    live = live.sort_values("score", ascending=False)
    cols = ["card_key", "product_id", "name", "set_name", "sub_type", "rarity", "price", "suggested_price",
            "sp_tau_days", "sp_n_eff", "sp_n_trades_365", "last_trade_price", "last_trade_date", "sale_days_90",
            "pred_q90", "liquidity", "stability", "pred_shortfall", "score", "suggested_ltv", "max_loan_usd", "apr",
            "default_prob_90d", "max_lendable_ltv", "starter"]
    live[cols].to_csv(os.path.join(out, "scores_today.csv"), index=False)

    pmeta = json.load(open(os.path.join(out, "price_model.json")))
    pp = pmeta["params"]
    asof = str(live["asof"].max().date())
    idx = pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0, parse_dates=True)
    era = np.load(os.path.join(work, "card_era.npy"), allow_pickle=True)
    W = pd.read_pickle(os.path.join(work, "wide.pkl"))
    sid_era = dict(zip(W["market"].columns, era))
    feats = PM.card_features(W, len(W["market"].index) - 1, pd.Index(live["sid"]))
    live["sp_gamma"] = PM.gamma_of(pp, feats)
    kap, rho = PM.kappa_rho(pp)
    seg_30 = {s: float(idx[s].iloc[-1] / idx[s].iloc[-31] - 1) for s in ("all", "vintage", "mid", "modern")}

    def card_json(r, i):
        num = r["name"].rsplit(" - ", 1)[1] if isinstance(r["name"], str) and " - " in r["name"] else None
        tau = float(r["sp_tau_days"])
        seg = sid_era.get(r["sid"], "all") if pp["index"] == "era" else "all"
        return {
            "card_key": r["card_key"], "tcgplayer_product_id": int(r["product_id"]),
            "name": r["name"], "set": r["set_name"], "number": num, "printing": r["sub_type"],
            "grade": "raw", "image_url": f"https://tcgplayer-cdn.tcgplayer.com/product/{int(r['product_id'])}_200w.jpg",
            "score": round(float(r["score"]), 1),
            "factors": {"liquidity": round(float(r["liquidity"]), 1), "stability": round(float(r["stability"]), 1)},
            "suggested_price_usd": round(float(r["suggested_price"]), 2),
            "price_basis": {"method": "learned continuous recency weight over all past trades, plus learned trend "
                                      "correction, market-adjusted",
                            "recency_weight": {"formula": "(1 + age_days / tau) ^ -kappa", "tau_days": round(tau, 3),
                                               "kappa": round(kap, 3), "market_beta": round(pp["beta"], 3)},
                            "trend_correction": {"gamma": round(float(r["sp_gamma"]), 3),
                                                 "long_memory_tau_days": round(rho * tau, 2)},
                            "half_life_days": round(tau * (2 ** (1 / kap) - 1), 1),
                            "n_sales": int(r["sp_n_trades_365"]), "effective_n_sales": round(float(r["sp_n_eff"]), 1),
                            "last_sale_usd": r2(r["last_trade_price"]), "last_sale_date": r["last_trade_date"],
                            "market_price_usd": round(float(r["price"]), 2),
                            "market_segment": seg, "market_adj_pct_30d": round(100 * seg_30[seg], 2),
                            "trading_days_last_90": int(r["sale_days_90"])},
            "suggested_ltv": round(float(r["suggested_ltv"]), 4),
            "max_loan_usd": round(float(r["max_loan_usd"]), 2),
            "apr_pct": r2(100 * r["apr"], 1),
            "default_prob_90d": round(float(r["default_prob_90d"]), 4),
            "max_lendable_ltv": r2(r["max_lendable_ltv"]),
            "predicted_bad_case_drop_90d": round(float(r["pred_q90"]), 4),
            "negotiation": {"apr_curve": [
                {"ltv": float(l), "loan_usd": round(float(l * r["suggested_price"]), 2),
                 "apr_pct": round(float(100 * A[pos[r.name], k]), 1), "default_prob_90d": round(float(Pd[pos[r.name], k]), 4)}
                for k, l in enumerate(LT.LTV_CURVE) if np.isfinite(A[pos[r.name], k])]},
        }

    top = pd.concat([live[live["starter"]], live[~live["starter"]].sort_values("sale_days_90", ascending=False).head(490)])
    meta = {"asof": asof, "model": "dynamic-v0.3", "term_days": LT.TERM_DAYS,
            "loan_rule": {"method": "per-card learned outcome distribution; suggested loan = 1-in-10 bad-case "
                                    "net sale value at maturity, net of interest; APR = break-even for that size",
                          "lender_confidence": LT.LENDER_CONFIDENCE, "negotiable": True, "apr_cap": None},
            "score_rule": {"method": "monotone GBM on liquidity and stability percentiles, predicting collateral shortfall",
                           "learned_importance": smeta["learned_importance_gain_share"],
                           "linear_equivalent_weights": smeta["linear_equivalent_weights"]},
            "rate_rule": {**lmeta["assumptions"]},
            "price_rule": {"formula": "log price = (1+gamma) * avg_w1(log p) - gamma * avg_w2(log p); "
                                      "w1 = (1 + age/tau)^-kappa, w2 = (1 + age/(rho*tau))^-kappa",
                           "kappa": kap, "rho": rho, "params": pp},
            "market_index_30d_pct": {k: round(100 * v, 2) for k, v in seg_30.items()}}
    with open(os.path.join(out, "web_cards.json"), "w") as f:
        json.dump({**meta, "cards": [card_json(r, i) for i, r in top.iterrows()]}, f, indent=1)
    with open(os.path.join(out, "web_cards_all.json"), "w") as f:
        json.dump({**meta, "cards": [card_json(r, i) for i, r in live.iterrows()]}, f)
    show = ["card_key", "price", "suggested_price", "sp_tau_days", "sale_days_90", "liquidity", "stability", "score",
            "suggested_ltv", "max_loan_usd", "apr", "default_prob_90d", "max_lendable_ltv"]
    print(live[live["starter"]][show].round(3).to_string(index=False))
    d = live
    print("cards scored:", len(d), "| median score", round(d["score"].median(), 1), "| median ltv",
          round(d["suggested_ltv"].median(), 3), "| median apr", round(d["apr"].median(), 3),
          "| apr p10/p90", d["apr"].quantile([.1, .9]).round(3).tolist())


if __name__ == "__main__":
    main()
