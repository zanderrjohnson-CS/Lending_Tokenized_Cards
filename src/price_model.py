"""ML program 2 of 5: the suggested price (v0.3).

v0.2: weighted median of the last 180 days of trade prices, with a weight that halved every 14 days
(a fixed choice, and with a hard 180-day cut-off).

v0.3: a smooth, continuous recency weight whose shape is learned from data, per card:

    weight(age) = (1 + age / tau_card) ^ (-kappa)          age in days, 0 = today

  * The weight is 1 for a trade today and falls continuously and smoothly as a trade gets older.
    There is no step, no window edge and no blend of fixed medians. (This curve family includes the
    exponential half-life as a limiting case, so the data can pick it if it really is best.)
  * tau_card (how long the card's "memory" is) is not one number: it depends on the card. A card
    that trades every day has plenty of fresh prices and can forget fast; a card that trades a few
    times a quarter needs a longer memory. Volatility enters the same way:
        log tau_card = th0 + th1 * z(log trades in last 90 days) + th2 * z(90-day volatility)
  * Every past price is first rolled forward to today by the market index for the card's era, scaled
    by a learned market sensitivity beta (beta = 1: fully follows the market, 0: ignores it).
  * Suggested price = exp(weighted average of log prices). The log average is smooth in the
    parameters, robust to the price level, and beat the weighted median out of sample (see metrics).

Training target: what the card actually traded at over the NEXT 30 days (median of its traded
prices, rolled back to the as-of date by the market index, so we don't reward guessing the market).
Parameters are fitted by minimising the mean absolute log error on as-of dates before
TRAIN_END, and tested on later dates against v0.2 and simple baselines.

Usage: python src/price_model.py WORK_DIR OUT_DIR
Writes OUT_DIR/price_model.json (learned parameters and test metrics).
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from common import MIN_PRICE, load_wide

MAX_AGE = 365          # history the kernel can see; weights there are tiny anyway (see json)
FWD = 30               # target window
STEP = 14
TRAIN_END = pd.Timestamp("2025-08-01")
SAMPLE_PER_DATE = 700
SEED = 0


def card_index(work, cols, segment):
    idx = pd.read_csv(os.path.join(work, "market_index.csv"), index_col=0, parse_dates=True)
    if segment == "all":
        return np.repeat(np.log(idx["all"].to_numpy())[:, None], len(cols), axis=1)
    era = np.load(os.path.join(work, "card_era.npy"), allow_pickle=True)
    return np.log(idx[list(era)].to_numpy())  # column j = the index of card j's era


def card_features(W, i, cols):
    """Inputs that set each card's memory length, as of day i (no look-ahead)."""
    ci = W["market"].columns.get_indexer(cols)
    T = arr(W, "traded")[max(0, i - 89):i + 1][:, ci]
    lp = np.log(arr(W, "market", "float64")[max(0, i - 90):i + 1][:, ci])
    vol = np.nanstd(np.diff(lp, axis=0), axis=0) * np.sqrt(365)
    return np.column_stack([np.log1p(T.sum(axis=0)), np.nan_to_num(vol, nan=0.0)])


def arr(W, key, dtype=None):
    """Cached numpy view of one of the daily matrices."""
    k = "_np_" + key
    if k not in W:
        W[k] = W[key].to_numpy(dtype=dtype) if dtype else W[key].to_numpy()
    return W[k]


def window(W, logI, i, cols_idx):
    """(age x card) arrays: log price rolled to day i (beta applied later), log index gap, weight mask."""
    lo = max(0, i - MAX_AGE + 1)
    P = arr(W, "market", "float64")[lo:i + 1][:, cols_idx]
    C = arr(W, "traded")[lo:i + 1][:, cols_idx].copy()
    C[-1, :] = True  # today's quoted market price always counts (age 0)
    ok = C & np.isfinite(P) & (P > 0)
    lp = np.where(ok, np.log(np.where(ok, P, 1.0)), 0.0)
    dI = logI[i, cols_idx][None, :] - logI[lo:i + 1][:, cols_idx]
    age = (i - np.arange(lo, i + 1)).astype("float64")
    pad = MAX_AGE - (i + 1 - lo)
    if pad > 0:  # left-pad so every as-of date has the same shape
        lp = np.vstack([np.zeros((pad, lp.shape[1])), lp])
        dI = np.vstack([np.zeros((pad, dI.shape[1])), dI])
        ok = np.vstack([np.zeros((pad, ok.shape[1]), bool), ok])
        age = np.r_[np.arange(MAX_AGE - 1, MAX_AGE - 1 - pad, -1).astype(float), age]
    return lp.astype("float32"), dI.astype("float32"), ok, age


NAMES = ["a0", "a1_liq", "a2_vol", "log_kappa", "log_rho_minus_1", "g0", "g1_liq", "g2_vol", "beta"]
X0 = [0.0, 0.0, 0.0, np.log(3.0), np.log(9.0), 0.0, 0.0, 0.0, 1.0]
# Search ranges that keep the fit to sensible shapes; price_model.json lists any that bind ("bounds_hit").
BOUNDS = [(np.log(0.1), np.log(365)), (-2, 2), (-2, 2), (np.log(0.3), np.log(10)), (np.log(0.5), np.log(50)),
          (-1, 3), (-1, 1), (-1, 1), (0, 1.5)]


def unpack(theta, mu, sd):
    p = dict(zip(NAMES, map(float, theta)))
    p.update(mu=list(map(float, mu)), sd=list(map(float, sd)))
    return p


def zf(p, feats):
    return (feats - np.array(p["mu"])) / np.array(p["sd"])


def tau_of(p, feats):
    """Each card's memory length in days (how fast its recency weight falls)."""
    z = zf(p, feats)
    return np.exp(np.clip(p["a0"] + p["a1_liq"] * z[:, 0] + p["a2_vol"] * z[:, 1], np.log(0.1), np.log(365)))


def gamma_of(p, feats):
    """Trend term: how much the short-memory average is pushed away from (gamma > 0) or pulled toward
    (gamma < 0) the long-memory average."""
    z = zf(p, feats)
    return p["g0"] + p["g1_liq"] * z[:, 0] + p["g2_vol"] * z[:, 1]


def kappa_rho(p):
    return float(np.clip(np.exp(p["log_kappa"]), 0.2, 20)), 1 + float(np.exp(p["log_rho_minus_1"]))


def weights(p, ok, age, feats):
    """Effective weight of each past price (age x card); each card's weights sum to 1.
    w(age) = (1 + gamma) k(age; tau) - gamma k(age; rho tau), k(age; t) = (1 + age/t)^-kappa normalised
    over the card's trades. Smooth and continuous in age; highest for the newest price."""
    tau, g = tau_of(p, feats), gamma_of(p, feats)
    kap, rho = kappa_rho(p)
    k1 = np.where(ok, (1 + age[:, None] / tau[None, :]) ** (-kap), 0.0)
    k2 = np.where(ok, (1 + age[:, None] / (rho * tau[None, :])) ** (-kap), 0.0)
    return (1 + g) * k1 / k1.sum(0) - g * k2 / k2.sum(0)


def estimate(p, lp, dI, ok, age, feats):
    w = weights(p, ok, age, feats)
    v = lp + float(np.clip(p["beta"], 0, 2)) * dI
    return (w * v).sum(0), w


def suggested_price(p, W, logI, i, cols_idx):
    """Public entry used by build_panel: suggested price, effective number of trades, memory length."""
    lp, dI, ok, age = window(W, logI, i, cols_idx)
    feats = card_features(W, i, W["market"].columns[cols_idx])
    est, w = estimate(p, lp, dI, ok, age, feats)
    wp = np.clip(w, 0, None)
    n_eff = wp.sum(0) ** 2 / np.maximum((wp ** 2).sum(0), 1e-12)
    return np.exp(est), n_eff, tau_of(p, feats)


def target(W, logI, i, cols_idx):
    P = arr(W, "market", "float64")[i + 1:i + 1 + FWD][:, cols_idx]
    C = arr(W, "traded")[i + 1:i + 1 + FWD][:, cols_idx]
    v = np.where(C & np.isfinite(P), np.log(np.where(np.isfinite(P), P, 1)) - (logI[i + 1:i + 1 + FWD][:, cols_idx] - logI[i, cols_idx][None, :]), np.nan)
    n = np.isfinite(v).sum(0)
    with np.errstate(all="ignore"):
        t = np.nanmedian(v, axis=0)
    return np.where(n >= 2, t, np.nan)


def v02(lp, dI, ok, age):
    """v0.2 rule for comparison: 14-day half-life weighted median, 180-day window, beta 1 (global index)."""
    w = np.where(ok & (age[:, None] < 180), 0.5 ** (age[:, None] / 14), 0.0)
    v = np.where(ok, lp + dI, np.inf)
    order = np.argsort(v, axis=0)
    vs = np.take_along_axis(v, order, 0)
    cw = np.cumsum(np.take_along_axis(w, order, 0), 0)
    k = (cw >= 0.5 * cw[-1][None, :]).argmax(0)
    return vs[k, np.arange(vs.shape[1])]


def build_sample(W, logI, rng):
    days = W["market"].index
    M = arr(W, "market", "float64")
    out = []
    for i in range(180, len(days) - FWD, STEP):
        ok = np.flatnonzero(np.nan_to_num(M[i]) >= MIN_PRICE)
        if len(ok) > SAMPLE_PER_DATE:
            ok = np.sort(rng.choice(ok, SAMPLE_PER_DATE, replace=False))
        y = target(W, logI, i, ok)
        keep = np.isfinite(y)
        ok, y = ok[keep], y[keep]
        lp, dI, msk, age = window(W, logI, i, ok)
        out.append(dict(date=days[i], cols=ok, y=y, lp=lp, dI=dI, ok=msk, age=age,
                        feats=card_features(W, i, W["market"].columns[ok]),
                        last=np.log(M[i, ok])))
    return out


def stack(S):
    return dict(y=np.concatenate([s["y"] for s in S]), lp=np.hstack([s["lp"] for s in S]),
                dI=np.hstack([s["dI"] for s in S]), ok=np.hstack([s["ok"] for s in S]),
                age=S[0]["age"], feats=np.vstack([s["feats"] for s in S]),
                last=np.concatenate([s["last"] for s in S]))


def mae(a, b):
    return float(np.mean(np.abs(a - b)))


def fit(tr, x0=X0):
    mu, sd = tr["feats"].mean(0), tr["feats"].std(0) + 1e-9

    def loss(theta):
        est, _ = estimate(unpack(theta, mu, sd), tr["lp"], tr["dI"], tr["ok"], tr["age"], tr["feats"])
        return mae(est, tr["y"])

    x0 = np.clip(np.array(x0, dtype=float), [b[0] for b in BOUNDS], [b[1] for b in BOUNDS])
    r = minimize(loss, x0, method="Powell", bounds=BOUNDS, options=dict(maxiter=6000, xtol=1e-3, ftol=1e-7))
    print("  fitted", dict(zip(NAMES, np.round(r.x, 3))), "train loss", round(float(r.fun), 5), flush=True)
    p = unpack(r.x, mu, sd)
    p["bounds_hit"] = [n for n, x, (lo, hi) in zip(NAMES, r.x, BOUNDS) if min(x - lo, hi - x) < 1e-3]
    return p, float(r.fun)


def by_liquidity(est, d):
    n = np.expm1(d["feats"][:, 0])
    g = {"thin_<10_trades_90d": n < 10, "mid_10_40": (n >= 10) & (n < 40), "liquid_40plus": n >= 40}
    return {k: {"n": int(m.sum()), "mae_log": mae(est[m], d["y"][m])} for k, m in g.items()}


def main():
    work, out = sys.argv[1], sys.argv[2]
    W = load_wide(work)
    cols = W["market"].columns
    results, models = {}, {}
    for segment in ("all", "era"):
        logI = card_index(work, cols, segment)
        S = build_sample(W, logI, np.random.default_rng(SEED))
        tr = stack([s for s in S if s["date"] < TRAIN_END - pd.Timedelta(days=FWD)])
        te = stack([s for s in S if s["date"] >= TRAIN_END])
        print(f"index={segment}: train rows {len(tr['y'])}, test rows {len(te['y'])}", flush=True)
        p, tr_loss = fit(tr)
        est, _ = estimate(p, te["lp"], te["dI"], te["ok"], te["age"], te["feats"])
        p.update(index=segment)
        models[segment] = p
        results[segment] = {"train_mae_log": tr_loss, "test_mae_log": mae(est, te["y"]),
                            "test_bias_log": float(np.mean(est - te["y"])), "test_by_liquidity": by_liquidity(est, te)}
        if segment == "all":
            v = v02(te["lp"], te["dI"], te["ok"], te["age"])
            results["baselines_test"] = {
                "v0.2_halflife14_median180": {"mae_log": mae(v, te["y"]), "by_liquidity": by_liquidity(v, te)},
                "todays_market_price": {"mae_log": mae(te["last"], te["y"]), "by_liquidity": by_liquidity(te["last"], te)},
            }
            results["test_rows"] = int(len(te["y"]))
        print(segment, json.dumps(results[segment], default=float), flush=True)
    print(json.dumps(results["baselines_test"], default=float))
    seg = min(("all", "era"), key=lambda s: results[s]["test_mae_log"])
    # Refit on all dates for production, same index choice, warm-started from the test fit.
    logI = card_index(work, cols, seg)
    S = build_sample(W, logI, np.random.default_rng(SEED + 1))
    p_all, _ = fit(stack(S), x0=[models[seg][k] for k in NAMES])
    p_all.update(index=seg)
    ages = np.arange(0, MAX_AGE, dtype=float)
    feats_q = np.vstack([s["feats"] for s in S])
    show = [0, 1, 2, 3, 7, 14, 30, 60, 90, 180]
    curves = {}
    for name, q in (("rarely_traded_card_p10", 10), ("typical_card_p50", 50), ("often_traded_card_p90", 90)):
        f = np.array([[np.percentile(feats_q[:, 0], q), np.median(feats_q[:, 1])]])
        w = weights(p_all, np.ones((MAX_AGE, 1), bool), ages, f)[:, 0]  # a card with a price every day
        curves[name] = {"trades_last_90d": round(float(np.expm1(f[0, 0])), 1),
                        "tau_days": round(float(tau_of(p_all, f)[0]), 3), "gamma": round(float(gamma_of(p_all, f)[0]), 3),
                        "weight_at_age_days": {int(a): round(float(w[a]), 5) for a in show},
                        "share_of_weight_last_7d": round(float(w[:7].sum()), 3)}
    res = {"model": "price-kernel-v0.3", "params": p_all, "chosen_index": seg, "walk_forward_test": results,
           "train_end_for_test": str(TRAIN_END.date()),
           "target": f"median traded price over the next {FWD} days, rolled back to the as-of date by the market index",
           "weight_curves_if_card_trades_daily": curves}
    json.dump(res, open(os.path.join(out, "price_model.json"), "w"), indent=2, default=float)
    print(json.dumps({k: v for k, v in res.items() if k != "walk_forward_test"}, indent=1, default=float))


if __name__ == "__main__":
    main()
