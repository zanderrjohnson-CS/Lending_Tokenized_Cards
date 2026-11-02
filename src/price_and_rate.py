"""Suggested price, safety score and interest rate for every card, plus the website export.

Design (per Zander, 2026-11-02):
  * SUGGESTED PRICE is separate from the score. It is a recency-weighted median of the card's trade
    prices over the last 180 days (14-day half-life), each rolled forward by the market-wide index
    (see build_panel.suggested_price). Loan size = ADVANCE_RATE x suggested price for every card.
  * SAFETY SCORE (0-100) says only how safe the card is to lend against. Half of it is liquidity
    (how often it trades), half is price stability (the ML model's bad-case 90-day drop).
  * The score sets only the INTEREST RATE, which is priced so the lender's expected default loss is
    covered, calibrated on what actually happened to cards with similar scores (out of sample).

Loss model, borrowed from pawn, art and margin lending:
  * At maturity the borrower walks away if the card is worth less than the debt (strategic default);
    otherwise a base share of borrowers still fail to pay (BASE_DEFAULT).
  * On default the lender sells the card: recovery = value x (1 - SELL_FEE - illiquidity discount).
    The illiquidity discount grows as trading thins out (a card that rarely sells has to be dumped
    below its quoted price to sell quickly).
  * loss = max(0, debt - recovery). All-in APR = cost of funds + servicing + (1 + CAPITAL_MULT) x
    expected loss, annualised. The risk part is collected as an upfront fee so it doesn't feed back
    into the debt (see calibrate).

Usage: python src/price_and_rate.py WORK_DIR OUT_DIR [CARDS_CSV]
"""
import json
import os
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from train_drawdown_model import FEATURES, CAT

TERM_DAYS = 90
TERM_YEARS = TERM_DAYS / 365
ADVANCE_RATE = 0.90       # loan = 90% of suggested price, for every card
SELL_FEE = 0.10           # marketplace + payment fees when the lender sells a defaulted card
MAX_ILLIQ_DISCOUNT = 0.20  # extra fire-sale discount for a card that never trades; 0 for daily traders
BASE_DEFAULT = 0.05       # share of borrowers who fail to repay even when the card is worth more
COST_OF_FUNDS = 0.08
SERVICING = 0.04          # vaulting, insurance, authentication
CAPITAL_MULT = 1.0        # charge an extra 1x expected loss to cover bad years
W_LIQUIDITY, W_STABILITY = 0.5, 0.5
LIQ_FULL_DAYS = 60        # trading on 60+ of 90 days = full liquidity marks
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


def liquidity_score(sale_days_90):
    return 100 * np.clip(np.log1p(sale_days_90) / np.log1p(LIQ_FULL_DAYS), 0, 1)


def stability_score(q90):
    """100 = predicted bad-case (1-in-10) 90-day drop of 0%; 0 = a drop of 50% or more."""
    return 100 * np.clip(1 - np.asarray(q90, dtype=float) / 0.5, 0, 1)


def safety_score(sale_days_90, q90):
    return W_LIQUIDITY * liquidity_score(sale_days_90) + W_STABILITY * stability_score(q90)


def loss_and_default(value_ratio, liq, apr):
    """value_ratio = card value at maturity / suggested price at origination. Per unit of principal."""
    debt = ADVANCE_RATE * (1 + apr * TERM_YEARS)
    recovery = value_ratio * (1 - SELL_FEE - MAX_ILLIQ_DISCOUNT * (1 - liq / 100))
    p_default = np.where(value_ratio < debt, 1.0, BASE_DEFAULT)
    loss = np.clip(debt - recovery, 0, None) / ADVANCE_RATE
    return p_default * loss, p_default


def calibrate(oos):
    """Score bucket -> realised default probability, expected loss and break-even APR."""
    oos = oos.dropna(subset=["fwd_end_price", "suggested_price"])
    oos = oos[oos["suggested_price"] > 0]
    ratio = (oos["fwd_end_price"] / oos["suggested_price"]).clip(0, 5).values
    liq = oos["liquidity"].values
    bins = np.arange(0, 101, 5)
    b = np.clip(np.digitize(oos["score"].values, bins) - 1, 0, len(bins) - 2)
    rows = []
    for k in range(len(bins) - 1):
        m = b == k
        if m.sum() < 100:
            continue
        # The risk part of the price is charged as an upfront fee (like pawn fees or hard-money
        # "points"), so it does not inflate the amount owed at maturity. Charging it as interest due
        # at maturity would raise the debt, push more borrowers underwater, raise the loss, and
        # spiral: at a 90% advance there is often no interest rate that converges.
        apr = COST_OF_FUNDS + SERVICING
        el, pdf = loss_and_default(ratio[m], liq[m], apr)
        risk_fee = (1 + CAPITAL_MULT) * el.mean()
        apr = apr + risk_fee / TERM_YEARS
        rows.append({"score_mid": bins[k] + 2.5, "n": int(m.sum()), "default_prob_90d": float(pdf.mean()),
                     "expected_loss_90d": float(el.mean()), "risk_fee_90d": float(risk_fee), "apr_raw": float(apr),
                     "median_value_change": float(np.median(ratio[m]) - 1)})
    cal = pd.DataFrame(rows)
    # Monotone smoothing: a higher score must never cost more.
    w = cal["n"]
    cal["apr"] = IsotonicRegression(increasing=False).fit(cal["score_mid"], cal["apr_raw"], sample_weight=w).predict(cal["score_mid"])
    cal["default_prob"] = IsotonicRegression(increasing=False).fit(cal["score_mid"], cal["default_prob_90d"], sample_weight=w).predict(cal["score_mid"])
    return cal


def main():
    work, out = sys.argv[1], sys.argv[2]
    oos = pd.read_csv(os.path.join(out, "oos_predictions.csv.gz"), parse_dates=["asof"])
    oos["liquidity"] = liquidity_score(oos["sale_days_90"])
    oos["stability"] = stability_score(oos["pred_q90"])
    oos["score"] = safety_score(oos["sale_days_90"], oos["pred_q90"])
    cal = calibrate(oos)
    cal.to_csv(os.path.join(out, "rate_by_score.csv"), index=False)
    print(cal.round(4).to_string(index=False))

    # Today's scores.
    panel = pd.read_pickle(os.path.join(work, "panel.pkl.gz"))
    live = panel[panel["asof"] == panel["asof"].max()].copy()
    X = live[FEATURES].copy()
    for c in CAT:
        X[c] = pd.Categorical(X[c], categories=sorted(panel[c].dropna().unique()))
    for k in ("mean", "q50", "q90"):
        live[f"pred_{k}"] = lgb.Booster(model_file=os.path.join(out, f"drawdown_model_{k}.txt")).predict(X)
    live["liquidity"] = liquidity_score(live["sale_days_90"]).round(1)
    live["stability"] = stability_score(live["pred_q90"]).round(1)
    live["score"] = safety_score(live["sale_days_90"], live["pred_q90"]).round(1)
    xs = cal["score_mid"].values
    live["apr"] = np.interp(live["score"], xs, cal["apr"].values)
    live["default_prob_90d"] = np.interp(live["score"], xs, cal["default_prob"].values)
    live["max_loan_usd"] = (ADVANCE_RATE * live["suggested_price"]).round(2)
    live["card_key"] = "tcg-" + live["product_id"].astype(str) + "-" + live["sub_type"].str.lower().str.replace(" ", "-")
    for key, (name, set_name, sub) in STARTER.items():
        m = (live["name"].str.startswith(name)) & (live["set_name"] == set_name) & (live["sub_type"] == sub)
        if m.sum() == 0:
            print("starter card not found:", key)
            continue
        live.loc[live.index[m.values.nonzero()[0][0]], "card_key"] = key
    live["starter"] = live["card_key"].isin(STARTER)
    cols = ["card_key", "product_id", "name", "set_name", "sub_type", "rarity", "price", "suggested_price",
            "sp_n_trades_180", "last_trade_price", "last_trade_date", "sale_days_90", "ret_90", "pred_q90",
            "liquidity", "stability", "score", "max_loan_usd", "apr", "default_prob_90d", "starter"]
    live = live.sort_values("score", ascending=False)
    live[cols].to_csv(os.path.join(out, "scores_today.csv"), index=False)

    asof = str(live["asof"].max().date())
    idx = pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0, parse_dates=True).iloc[:, 0]
    mkt_30 = float(idx.iloc[-1] / idx.iloc[-31] - 1)

    def card_json(r):
        num = None
        if isinstance(r["name"], str) and " - " in r["name"]:
            num = r["name"].rsplit(" - ", 1)[1]
        return {
            "card_key": r["card_key"], "tcgplayer_product_id": int(r["product_id"]),
            "name": r["name"], "set": r["set_name"], "number": num, "printing": r["sub_type"],
            "grade": "raw", "image_url": f"https://tcgplayer-cdn.tcgplayer.com/product/{int(r['product_id'])}_200w.jpg",
            "score": round(float(r["score"]), 1),
            "factors": {"liquidity": round(float(r["liquidity"]), 1), "stability": round(float(r["stability"]), 1)},
            "suggested_price_usd": round(float(r["suggested_price"]), 2),
            "price_basis": {"method": "recency-weighted median of trade prices, market-adjusted",
                            "half_life_days": 14, "window_days": 180, "n_sales": int(r["sp_n_trades_180"]),
                            "last_sale_usd": None if pd.isna(r["last_trade_price"]) else round(float(r["last_trade_price"]), 2),
                            "last_sale_date": r["last_trade_date"],
                            "market_price_usd": round(float(r["price"]), 2),
                            "market_adj_pct_30d": round(100 * mkt_30, 2),
                            "trading_days_last_90": int(r["sale_days_90"])},
            "max_loan_usd": round(float(r["max_loan_usd"]), 2),
            "apr_pct": round(100 * float(r["apr"]), 1),
            "default_prob_90d": round(float(r["default_prob_90d"]), 4),
            "predicted_bad_case_drop_90d": round(float(r["pred_q90"]), 4),
        }

    top = pd.concat([live[live["starter"]], live[~live["starter"]].sort_values("sale_days_90", ascending=False).head(490)])
    meta = {"asof": asof, "model": "drawdown-gbm-v0.2", "term_days": TERM_DAYS,
            "loan_rule": {"advance_rate": ADVANCE_RATE, "max_loan_usd": "advance_rate x suggested_price_usd"},
            "score_rule": {"liquidity_weight": W_LIQUIDITY, "stability_weight": W_STABILITY},
            "rate_rule": {"cost_of_funds": COST_OF_FUNDS, "servicing": SERVICING, "capital_mult": CAPITAL_MULT,
                          "sell_fee": SELL_FEE, "max_illiquidity_discount": MAX_ILLIQ_DISCOUNT,
                          "base_default": BASE_DEFAULT,
                          "apr_by_score": [{"score": float(s), "apr_pct": round(100 * a, 2),
                                            "default_prob_90d": round(float(p), 4)}
                                           for s, a, p in zip(cal["score_mid"], cal["apr"], cal["default_prob"])]}}
    with open(os.path.join(out, "web_cards.json"), "w") as f:
        json.dump({**meta, "cards": [card_json(r) for _, r in top.iterrows()]}, f, indent=1)
    with open(os.path.join(out, "web_cards_all.json"), "w") as f:
        json.dump({**meta, "cards": [card_json(r) for _, r in live.iterrows()]}, f)
    print(live[live["starter"]][["card_key", "price", "suggested_price", "sale_days_90", "liquidity", "stability",
                                 "score", "max_loan_usd", "apr", "default_prob_90d"]].round(3).to_string(index=False))
    print("cards scored:", len(live))


if __name__ == "__main__":
    main()
