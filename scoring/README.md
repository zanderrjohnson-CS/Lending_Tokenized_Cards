# Workstream B: Scoring engine (the oracle)

**Goal.** For any card token, return a fair value, a confidence level, a liquidity estimate, a recovery floor, a 0 to 1000 loan score, and recommended loan terms, each with a plain-English reason. This is the core product.

[`HANDOFF.md`](HANDOFF.md) is a self-contained prompt for running the data collection, model training, and score-to-loan mapping in its own conversation. This README is the summary and the contract with the rest of the team.

**Hand your agent:** the root [README](../README.md), [`docs/02-architecture.md`](../docs/02-architecture.md), this file, and [`HANDOFF.md`](HANDOFF.md).

## What the engine outputs

| Output | Range | Meaning |
| --- | --- | --- |
| `fair_value_usd` with `value_low_usd` and `value_high_usd` | dollars | What the card sells for in a normal sale, with an uncertainty range |
| `confidence` | 0 to 1 | How much to trust the value. Few, old, or scattered sales lower it |
| `liquidity_score` | 0 to 1 | How easily the card sells. Depends on sales frequency and time to sell |
| `est_days_to_sell` | days | Typical time to sell |
| `recovery_floor_usd` | dollars | Conservative amount a lender could recover on a fast forced sale |
| `loan_score` | 0 to 1000 | One number for the quality of the card as collateral |
| `recommended_terms` | see below | Maximum loan, term, interest, loan-to-value for that score |
| `explanation` | list of text | Evidence in plain English, for example "Based on 14 sales in the last 60 days" |

The score describes the **card as collateral**, not the borrower. There is no credit check. See [`schema/score_response.example.json`](schema/score_response.example.json) for the exact response shape.

## Inputs

- **Sales data:** eBay sold listings, TCGPlayer, PSA records, Collector Crypt and Courtyard on-chain sales, platform buyback prices.
- **Card facts:** set, year, character or player, grade, grader, population counts.
- **Token facts:** the token's metadata (grade, cert number) and whether it comes from the platform's official collection (`verified`).

If real data is hard to get in hackathon time, use clearly labeled synthetic sales data. Do not stall on scraping, and respect each site's terms.

## Method in three phases

1. **Data collection.** Build a cleaned dataset of historical sales. Remove wash trades (same wallet on both sides, wallets trading only with each other, round trips, price spikes with no surrounding support).
2. **Model training.** Start with a recency-weighted median of comparable sales as the baseline. Then train a gradient boosting model with quantile outputs (10th, 50th, 90th percentile) for the value range. Validate by splitting on **time**, never randomly. Track how often the model overestimates, because that is the dangerous error for a lender.
3. **Score to loan mapping.** Combine confidence, liquidity, recovery share, and price stability into the 0 to 1000 score, then map score bands to loan-to-value, term, and interest. Backtest it: higher score bands must show lower loss rates.

## Starting formulas (tune from data)

Loan size comes from the recovery floor, not market value, so the lender is made whole in a bad case.

```text
loan_score = 1000 x (0.35 C + 0.30 L + 0.20 R + 0.15 S)
```

C is confidence, L is liquidity, R is recovery floor divided by fair value, and S is price stability over the last 90 days, each scaled 0 to 1. Weights live in a config file.

```text
interest = cost_of_capital + (P_default x loss_given_default) + margin
```

Loss given default is the gap between the loan and the recovery floor, so a loan below the recovery floor has near-zero expected loss. With no real default history, default probabilities by score band are labeled assumptions.

## Score bands to terms (placeholders to derive from data)

| Score | Tier | Max loan-to-value | Max term | Interest |
| --- | --- | --- | --- | --- |
| 800 to 1000 | Blue chip | about 50% | 90 days | lowest |
| 600 to 799 | Strong | about 40% | 60 days | low |
| 400 to 599 | Moderate | about 30% | 30 days | medium |
| 200 to 399 | Thin | about 20% | 14 days | high |
| 0 to 199 | Not eligible | 0% | none | none |

Terms must never get worse as the score goes up for the same card value.

## Manipulation resistance

- Ignore sales where buyer and seller are linked. Down-weight single-venue or thin evidence.
- Never report high confidence from very few sales.
- Cap how fast value can move between updates and flag sudden jumps.
- Reject tokens that are not from the platform's official collection (`verified` is false), since anyone can mint a fake NFT with copied card details.

## API

Served as in [`docs/02-architecture.md`](../docs/02-architecture.md): `GET /score/{token_mint}`, `POST /offer`, `GET /health`. Build a **mock mode** first, with 10 to 20 fake cards and hand-picked scores, so workstreams C and D are not blocked.

## Planned folders

```text
scoring/
  data/        raw/ and cleaned/ (gitignored), data dictionary, small samples
  pipeline/    collection and cleaning scripts
  models/      training code and model card (saved models are gitignored)
  scoring/     score, confidence, liquidity, recovery floor, loan score
  api/         FastAPI service and mock mode
  reports/     data quality report, results, backtest
  config/      score weights, terms table, assumptions
  schema/      shared response examples
```

## Tasks

1. Ship mock mode with the fixed response shape (day one).
2. Collect or generate the dataset. Write the data quality report.
3. Build the baseline comparable-sales estimator and its evaluation.
4. Train the quantile model and compare it to the baseline.
5. Build confidence, liquidity, and recovery floor functions.
6. Build the loan score and the terms table. Run the backtest.
7. Replace mock mode with the real engine behind the same API.
8. Write a model card: data used, features, limits, known failure modes.

## Acceptance checks

- The API response matches the shared field names exactly.
- Time-split validation shows the model beats the baseline on the liquid cards, or the baseline is kept and the reason is documented.
- Interval coverage is close to its target (the 10th to 90th range holds the truth about 80% of the time).
- Backtest shows loss rate falling as score band rises.
- A simulated fake-sales attack on one card does not raise its loan score above its band by more than a stated limit.
- Every response includes an explanation that cites the evidence used.

## Honest limits to state in the pitch

No real default history exists, so default probabilities are assumptions. Thin cards are scored less reliably. Prices can move faster than updates. Naming these builds trust with judges and lenders.
