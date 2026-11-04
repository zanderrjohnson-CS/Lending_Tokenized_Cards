# ML safety score v0.3: every piece learned from data

Updated 2026-11-03 per Zander: no fixed weights, splits, caps or advance rates. The pipeline is now
five separate ML programs, each fitted to 2.7 years of daily TCGplayer prices (tcgcsv archives,
2024-02-08 to 2026-11-01, 6,705 ungraded cards worth $20+ today) and each tested walk-forward (trained
only on data from before the period it's tested on). Code in `src/`, results in `output/ml/`, website
feed in `output/ml/web_cards.json`.

## What changed, in one picture

| Piece | v0.2 (fixed rules) | v0.3 (learned) | Program |
|---|---|---|---|
| **Market index** | Average daily % change of all cards, moves capped at ±15% | Repeat-sales index (Case-Shiller method), noise model and smoothness learned, one index per era | `market_index.py` |
| **Suggested price** | Weighted median, weight halves every 14 days, 180-day cut-off | Continuous recency weight `(1 + age/τ)^-κ`, memory length τ set per card, plus a learned trend correction | `price_model.py` |
| **Stability** | Gradient-boosted bad-case 90-day drop | Same model, retrained, now also sees the card's own era index | `train_drawdown_model.py` |
| **Safety score** | 50% liquidity + 50% stability, hand-set scales | Both inputs as percentiles vs. all other cards that day; combined by a model trained on what lenders actually lost | `safety_score_model.py` |
| **Loan amount** | 90% of suggested price, every card | Per card, from a learned distribution of outcomes: what the card covers in a 1-in-10 bad case after selling it | `loan_terms_model.py` |
| **Interest rate** | Looked up from a score-bucket table, smoothed | Solved per card and per loan size from the same distribution. No cap. Comes with a full rate-by-loan-size curve to negotiate on | `loan_terms_model.py` |

## 1. Market index (`market_index.py`)

**How v0.2 did it:** each day, average the % price change of every $20+ card, cap each card's move at
±15%, chain the days together. Most cards don't sell on a given day, so their "0% change" pulled the
average toward zero and made the index lag; the cap and the equal weights were fixed choices.

**v0.3:** every time a card trades, compare the price with its previous trade (892,016 such pairs
from 9,589 cards). Find the daily index path that best explains all pairs at once:
`log(price now / price then) = index[now] - index[then] + noise`.

- Days with no trade add nothing, so nothing drags the index toward zero.
- Noise is learned: a pair 60 days apart is noisier than one 2 days apart (variance = a + b × days,
  fitted from the residuals). A single odd sale is down-weighted by a robust (Huber) loss instead of a
  hard cap (8% of pairs get down-weighted).
- Smoothness is learned: a penalty on day-to-day changes in the index's trend, its strength picked
  by 5-fold cross-validation over cards (how well the index predicts price moves of cards it never
  saw). The CV curve has a clear minimum (λ ≈ 3×10⁵, `output/ml/market_index_model.json`).
- Four indexes: whole market, vintage (sets before 2004), 2004-2019, and 2020+. They really do move
  differently over the 2.7 years: whole market +112%, vintage +112%, 2004-19 +141%, 2020+ +82%.
  The price model picks the era index because it predicts better.

## 2. Suggested price (`price_model.py`)

Every past traded price (up to a year back) is rolled forward to today by the card's era index
(scaled by a learned market sensitivity β = 0.42) and given a weight that falls **continuously** with
age:

```
recency weight(age) = (1 + age / τ_card) ^ -κ          κ = 4.2 (learned)
log τ_card = a0 + a1 · (how often the card trades) + a2 · (volatility)   (all learned)
```

No steps, no window edge, no blend of fixed medians: weight is highest for today's price and smoothly
lower for every older one.

The data then added something we didn't expect: **TCGplayer's "market price" lags real sales** (it's
already their own rolling average), so in a moving market the latest quote is still behind. The model
learns a trend correction: it compares the short-memory average with a long-memory one (memory 50×
longer) and pushes the price γ of the way further in the direction of that gap. γ is learned per card
(0.6 for cards that trade daily, 1.2 for rarely traded cards).

**What it learned:** memory is short. For a typical card τ ≈ 0.8 days, i.e. the weight halves within
hours, and most of the information is in the latest price plus the recent trend. The data says older
prices should count far less than the 14-day half-life we had.

**Tested** on Aug 2025 - Oct 2026 (trained before), error vs. what the card actually traded at over the
next 30 days (median absolute log error, lower is better):

| Method | All cards | Rarely traded (<10 days/90) | 10-40 days | 40+ days |
|---|---|---|---|---|
| **v0.3 learned** | **5.6%** | **9.5%** | **3.1%** | **4.9%** |
| Today's TCGplayer market price | 5.9% | 9.7% | 3.3% | 5.1% |
| v0.2 (14-day half-life median) | 7.0% | 9.9% | 4.4% | 7.9% |

v0.3 cuts pricing error by about a fifth vs. v0.2, and beats just taking today's quote in every group.

## 3. Stability (`train_drawdown_model.py`)

Unchanged method (LightGBM predicting the worst price drop over the next 90 days; the 1-in-10 bad case
is the stability input), retrained on the new panel with the era index as extra inputs.
Walk-forward AUC for "fell more than 30%": **0.86**; 0.2% of the safest fifth vs 14.1% of the riskiest
fifth fell that far.

## 4. Safety score (`safety_score_model.py`)

- **Normalised against other cards, every day:** liquidity = percentile of how many of the last 90
  days the card traded, among all $20+ cards that day; stability = percentile of its predicted
  bad-case drop (less drop = higher). "Liquidity 80" = trades more often than 80% of cards today.
- **Combined by a model, not a 50/50 split.** A monotone gradient-boosted model (more liquid or more
  stable can never lower the score) predicts the **collateral shortfall** a lender actually suffered:
  `max(0, 1 - realised sale value / suggested price)`, where realised sale value is the first real
  trade at or after a 90-day loan's maturity, discounted for the wait. A card nobody buys shows up as a
  long wait and a worse price.
- **Score = share of historical card-days with a worse predicted shortfall.** 90 = safer collateral
  than 90% of what we've seen.

**What it learned:** stability carries almost all of the signal (linear-equivalent weights: 94%
stability, 6% liquidity; by tree gain 99/1). That's because the stability model already uses trading
frequency as its #1 input, so liquidity is mostly already inside stability. Liquidity still bites at
the bottom: a card with top-10% stability scores 91 if it trades like a median card but only 66 if it
is in the least-traded 10%.

Walk-forward test (Q4 2025 - Q2 2026, 73,974 card-loans):

| Score | Rank correlation with shortfall | AUC, shortfall > 30% | Shortfall > 30%, safest fifth | riskiest fifth |
|---|---|---|---|---|
| **v0.3 learned** | **0.28** | **0.84** | **0.08%** | 9.4% |
| v0.2 50/50 | 0.16 | 0.82 | 0.20% | 9.1% |

Note the score is now relative: the median card scores about 50. Our 10 starter cards score 13-43 today
because hyped high-value cards have larger predicted drops than the average $20+ card.

## 5. Loan amount and interest rate (`loan_terms_model.py`)

1. **Learn each card's spread of outcomes.** Two distributional models (median + spread + the actual
   shape of past errors) predict, per $ of suggested price: V = value at maturity (what the borrower
   compares the debt with) and R = what a lender would actually get selling it after a default (first
   real trade after maturity, discounted for the wait). Inputs: liquidity and stability percentiles,
   score, volatility, recent returns, price level, distance from market price, market and era momentum,
   set age, rarity. The 2024-26 bull market is taken out of the training targets, and a de-trended
   historical 90-day market move is added back as risk: **we don't assume the market keeps rising**.
2. **Price any loan size.** For an advance L (loan ÷ suggested price), solve for the lowest APR at which
   the lender's expected repayment covers cost of funds (8%) + servicing (4%) + a 1× expected-loss
   capital buffer. Borrowers walk away when the card is worth less than the debt; 5% of others default
   anyway. **There is no rate cap.** The rate rises smoothly with risk, and past some advance no rate
   works (a higher rate only pushes more borrowers underwater); that's the card's maximum lendable
   advance.
3. **Suggested loan** = what the card covers at maturity in a 1-in-10 bad case after 10% selling fees,
   net of interest; **suggested APR** = break-even at that size. Both continuous in every input.
4. **Negotiation curve.** Every card gets APR at each loan size from 20% of the suggested price up to its
   maximum lendable advance (`negotiation.apr_curve` in the feed). A borrower who wants more cash moves
   right and pays more; a lender who wants a lower rate offers less. The suggestion is a starting point.

Small, safe loans bottom out at 12% (the cost of funds plus servicing, i.e. zero expected loss); that
floor is an assumption about our funding, not a cap.

**Walk-forward backtest** (loans priced by a model that only knew earlier outcomes, then scored on what
really happened; 12,000 loans, Q4 2025 - Q2 2026):

| Score fifth | Median loan (% of price) | Median APR | Predicted default | Actual default | Lender's actual return (hurdle 12%) |
|---|---|---|---|---|---|
| 0-20 | 58% | 18.0% | 8.5% | 9.0% | 13.3% |
| 20-40 | 66% | 15.9% | 7.7% | 6.2% | 14.9% |
| 40-60 | 71% | 15.3% | 7.5% | 5.8% | 14.8% |
| 60-80 | 74% | 14.9% | 7.3% | 5.3% | 15.0% |
| 80-100 | 79% | 14.3% | 7.1% | 5.4% | 14.2% |

The lender clears its 12% hurdle in every band, with no band subsidising another: riskier cards get
smaller loans and higher rates, safer cards bigger loans and lower rates. Compared with v0.2 (90%
loans at 25-200% APR), loans are smaller and much cheaper.

## Starter cards today (2026-11-01, raw)

| Card | Market | Suggested | Liquidity | Stability | Score | Loan | APR | Max lendable |
|---|---|---|---|---|---|---|---|---|
| Gengar VMAX alt art | $1,026 | $1,009 | 86 | 41 | 43 | $711 (71%) | 14.4% | 75% |
| Base Set Blastoise | $230 | $229 | 88 | 38 | 41 | $153 (67%) | 16.4% | 75% |
| Charizard ex 199 (151) | $300 | $295 | 99 | 38 | 41 | $267 (91%) | 14.4% | 100% |
| Giratina V alt art | $822 | $812 | 88 | 36 | 37 | $590 (73%) | 16.0% | 80% |
| Charizard ex 223 (OBF) | $86 | $85 | 99 | 27 | 30 | $73 (86%) | 14.3% | 95% |
| Pikachu with Grey Felt Hat | $987 | $963 | 84 | 27 | 30 | $675 (70%) | 15.3% | 75% |
| Lugia V alt art | $460 | $444 | 91 | 22 | 24 | $313 (70%) | 16.4% | 75% |
| Base Set Venusaur | $143 | $133 | 90 | 21 | 24 | $86 (65%) | 18.7% | 70% |
| Base Set Charizard | $987 | $1,000 | 77 | 15 | 16 | $633 (63%) | 16.0% | 70% |
| Umbreon VMAX alt art | $2,210 | $2,307 | 89 | 13 | 13 | $1,419 (62%) | 17.4% | 70% |

Across all 6,705 cards: median suggested loan 71% of price, median APR 17.5%, 10% of cards at or below
13.7% and 10% at 22.3% or more.

## Website feed

`output/ml/web_cards.json` (10 starters + 490 most-traded) and `web_cards_all.json` (all 6,705). Every
v0.2 field is still there with the same meaning (`score`, `factors.liquidity`/`stability` (now
percentiles), `suggested_price_usd`, `price_basis`, `max_loan_usd` (now the suggested, negotiable
loan), `apr_pct`, `default_prob_90d`). New: `suggested_ltv`, `max_lendable_ltv`,
`negotiation.apr_curve` (`ltv`, `loan_usd`, `apr_pct`, `default_prob_90d` per step),
`price_basis.recency_weight` and `trend_correction`. The top level drops the fixed `advance_rate` and
the `apr_by_score` table.

## Caveats

- **Stand-in outcomes, not real loans.** Defaults are simulated (walk away when underwater, 5% base
  rate). Cost of funds, servicing, 10% selling fees, 1× capital buffer and the 1-in-10 confidence level
  are assumptions, at the top of `src/loan_terms_model.py`. Replace with real repayment data once loans
  exist.
- **TCGplayer "market price" is not a sale.** "Trading days" are days that price moved, and the price
  targets are that same series. Real sold listings (the data-expansion thread is collecting them)
  would sharpen every model, the price model most.
- **One market regime.** 2024-26 rose strongly with no full crash. We remove the drift, but tail
  losses are probably still understated.
- **Short test windows.** The score and loan models need 150 days of future data per example, so their
  walk-forward tests cover three quarters.
- The trend correction makes the price respond faster to momentum, including hype. The loan model
  prices that risk (it learns how often a fast riser falls back), but a lender could still cap the
  suggested price at e.g. the latest quote.

## Re-running

```bash
apt install p7zip-full; pip install pandas py7zr lightgbm scikit-learn scipy
python src/backfill_tcgcsv.py WORK                    # ~15 min, ~240 MB, resumes where it left off
python src/market_index.py WORK output/ml             # 1. market index (~1 min)
python src/price_model.py WORK output/ml              # 2. suggested price (~20 min)
python src/build_panel.py WORK output/ml              #    features + labels for every card, every 14 days
python src/train_drawdown_model.py WORK output/ml     # 3. stability
python src/safety_score_model.py WORK output/ml       # 4. safety score
python src/loan_terms_model.py WORK output/ml         # 5. loan size + APR
python src/export_web.py WORK output/ml               # today's scores + web_cards.json
```

`data/processed/` holds `panel.pkl.gz`, `market_index.csv` and `card_era.csv`, so steps 3-5 and the
export can run without re-downloading (use `data/processed` as WORK; the export also needs `wide.pkl`
from step 1's download).
