# ML safety score v0.2: suggested price, safety score, interest rate

Updated 2026-11-02 to Zander's design: price and safety are separate. Code in `src/`, results in
`output/ml/`, website feed in `output/ml/web_cards.json`.

## How a loan is priced, in one picture

| Piece | What it answers | How it's set |
|---|---|---|
| **Suggested price** | What is the card worth today? | Recency-weighted median of recent trade prices, adjusted for the overall market |
| **Loan amount** | How much can I borrow? | 90% of the suggested price, for every card |
| **Safety score (0-100)** | How safe is this card to lend against? | 50% how often it trades, 50% how stable its price is predicted to be (ML) |
| **Interest rate** | What does it cost? | Set by the score only, high enough to cover the lender's expected default loss |

So a $15 card that trades daily at a steady price gets a ~$13.50 loan at a low rate. A $1,000 card
that rarely trades still gets a ~$900 loan, but at a much higher rate.

## Data

- tcgcsv.com daily archives of TCGplayer prices, 2024-02-08 to 2026-11-01 (998 days, all 220
  Pokémon sets, 33,058 products). Raw/ungraded cards only.
- Universe: single cards with a market price of $20 or more. **No trading requirement**: all 6,702
  such cards are scored today.
- Training examples: one per card printing every 14 days, about 187,000 with a known 90-day outcome.

## Suggested price

Recency-weighted median of the card's TCGplayer market price on days it actually traded (the price
moved) over the last 180 days. Weights halve every 14 days, so last week dominates and 3-month-old
prices barely count. Every old price is first rolled forward by the market-wide index: a $5 sale
when the whole market was 20% lower counts as $6 today.

Market index: average daily price change across all $20+ cards (each day's moves capped at ±15%).
It roughly doubled from Feb 2024 to Nov 2026.

Note: when a card is sliding, the suggested price lags above the latest price (151 Charizard ex:
$317 suggested vs $300 market). The rate calibration below uses the suggested price, so that lag is
priced in, but a lender-friendly cap such as "never above 105% of the latest price" would be easy to
add.

## Safety score

**Liquidity (50%)**: days in the last 90 that the card's price moved (a sales proxy), log-scaled.
60 or more days = 100. A card that never trades = 0.

**Stability (50%)**: from the ML model's bad-case (1-in-10) prediction of the card's worst price drop
over the next 90 days. 0% drop = 100, a 50% or worse drop = 0. The model also uses trading frequency
as an input, and it's the model's single most important input.

### The ML model

Gradient-boosted trees (LightGBM) predicting each card's worst drop over the next 90 days, from:
price level; returns over 7, 30, 90 and 180 days; volatility and downside volatility; past drawdowns;
trading days; listing spreads; market-wide returns; set age; rarity; printing.

Tested walk-forward: each quarter from 2025 Q2 to 2026 Q3 was predicted by a model trained only on
earlier data whose outcome was already known.

| Method | AUC for "fell more than 30%" | "Fell >30%", safest fifth | riskiest fifth |
|---|---|---|---|
| **ML model (bad-case)** | **0.86** | **0.2%** | **14.0%** |
| Old hand-weighted formula | 0.64 | 3.5% | 7.1% |
| Volatility alone | 0.53 | 6.0% | 6.8% |

The model beat the old formula in every test quarter (0.81 to 0.85 vs 0.51 to 0.77).

## Interest rate

The rate is calibrated on what actually happened, out of sample, to loans we would have made on
cards with similar scores. The loss rules come from collateral lending (pawn, art, margin, auto):

- At maturity, the borrower walks away if the card is worth less than what they owe. Another 5% of
  borrowers fail to pay even when the card is worth more.
- On default the lender sells the card for its value minus 10% fees, minus an extra fire-sale
  discount of up to 20% for a card that rarely trades (0% for a card that trades daily).
- Lender loss = what's owed minus what the sale brings in, if positive.
- **APR = 8% cost of funds + 4% servicing (vault, insurance, authentication) + 2 × expected loss,
  annualised.** The risk part is collected as an upfront fee, like pawn fees or hard-money "points".
  If it were added to the balance due, it would push more borrowers underwater, raise losses, raise
  the rate again, and spiral. At a 90% advance, many cards then have no rate that works.

Result (`output/ml/rate_by_score.csv`, smoothed so a higher score never costs more):

| Score | APR | Chance of default per 90-day loan |
|---|---|---|
| 95-100 | 25% | 14% |
| 80-95 | 28% | 14% |
| 75-80 | 32% | 15% |
| 60-75 | 37% | 15% |
| 50-60 | 43-46% | 15% |
| 40-50 | 50-56% | 16-17% |
| 30-40 | 58-77% | 17-21% |
| 0-30 | 80-208% | 22-47% |

**Why even safe cards cost ~25% at a 90% loan:** with 10% selling fees, a 90% loan has almost no
cushion, so ordinary price noise puts about 1 in 7 loans underwater. The score separates the risky
end well (below 60), but above 60 the size of the loan matters more than the score. The advance rate
is the lever (rates by score band, before smoothing, `output/ml/apr_by_advance_rate.csv`):

| Advance rate | APR, score 80-100 | score 60-80 | score 40-60 | score 0-40 |
|---|---|---|---|---|
| 70% | 13% | 16% | 22% | 52% |
| 80% | 17% | 21% | 31% | 72% |
| 90% | 28% | 36% | 47% | 97% |

## Starter cards today (2026-11-01, raw)

| Card | Suggested price | Trading days /90 | Liquidity | Stability | Score | Loan | APR |
|---|---|---|---|---|---|---|---|
| Charizard ex 199 (151) | $317 | 86 | 100 | 82 | 90.8 | $286 | 27.7% |
| Charizard ex 223 (Obsidian Flames) | $93 | 86 | 100 | 73 | 86.4 | $84 | 27.7% |
| Lugia V alt art | $478 | 44 | 93 | 75 | 83.7 | $431 | 27.7% |
| Giratina V alt art | $860 | 33 | 86 | 79 | 82.2 | $774 | 28.0% |
| Base Set Blastoise | $231 | 34 | 87 | 71 | 78.6 | $207 | 30.7% |
| Base Set Venusaur | $157 | 40 | 90 | 67 | 78.4 | $141 | 30.9% |
| Gengar VMAX alt art | $1,040 | 27 | 81 | 73 | 76.9 | $936 | 32.2% |
| Pikachu with Grey Felt Hat | $997 | 24 | 78 | 73 | 75.7 | $898 | 33.6% |
| Umbreon VMAX alt art | $2,314 | 38 | 89 | 54 | 71.5 | $2,082 | 37.3% |
| Base Set Charizard | $987 | 18 | 72 | 49 | 60.3 | $888 | 39.8% |

Across all 6,702 cards: median score 68.5, median APR 37%, 10% of cards at or below 28%, 10% at
67% or more.

## Website feed

`output/ml/web_cards.json`: our 10 starter cards (by `card_key` from `data/cards.csv`) plus the 490
most-traded others. `web_cards_all.json` has all 6,702. Each card carries `score`, `factors`
(liquidity, stability), `suggested_price_usd`, `price_basis`, `max_loan_usd`, `apr_pct`,
`default_prob_90d`. The top level carries the rules and the score-to-APR table, so the site can price
any score.

## Caveats

- **Stand-in outcome, not real defaults.** Borrower behaviour is modelled with simple rules. Replace
  them with real repayment data once loans exist.
- **One market regime**: 2024-26 was a strong rising market with pullbacks in hyped modern cards.
  There was no full crash in the data, so tail losses are probably understated.
- **Raw cards, TCGplayer only.** No graded slabs or eBay or auction sales yet. Per-grade pricing
  needs the PriceCharting API or similar. Some cards trade far more often elsewhere than on TCGplayer.
- **"Trading days" is a proxy**: days the TCGplayer market price changed, not a sale count.
- Fees, cost of funds, the 5% base default rate and the 20% maximum fire-sale discount are
  assumptions. They live at the top of `src/price_and_rate.py`.

## Re-running

```bash
apt install 7zip; pip install pandas py7zr lightgbm scikit-learn scipy
python src/backfill_tcgcsv.py WORK                 # ~15 min, ~240 MB, resumes where it left off
python src/build_panel.py WORK                     # features, labels, suggested prices
python src/train_drawdown_model.py WORK output/ml  # walk-forward test + final models
python src/price_and_rate.py WORK output/ml        # rates, today's scores, web_cards.json
```

`data/processed/` holds `panel.pkl.gz` and `market_index.csv`, so the last two steps can run without
re-downloading (use `data/processed` as WORK).
