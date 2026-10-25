# Handoff Prompt: Collectible Credit Score (ML Project)

You are helping build the scoring engine for a hackathon project called **Card Credit** (working name). Read this whole file, then start with Phase 1. Ask me questions only where this file leaves a real gap; otherwise make a reasonable choice and note it.

## 1. Project context

Card Credit is a credit score for graded trading cards (PSA/CGC/BGS-graded Pokemon, sports, One Piece, etc.) that have been tokenized as NFTs by platforms like Collector Crypt (Solana) and Courtyard (Polygon). Collectors want to borrow USDC against a card without selling it. Lenders need to know how much they can safely lend.

There is no trusted price feed for these cards. Prices live off-chain (eBay sold listings, TCGPlayer, PSA auction records) and on-chain (marketplace sales). Our scoring engine is the "oracle": it takes a card identifier and returns a value estimate, a confidence level, a liquidity estimate, a recovery floor, and a loan score that maps to loan terms.

The rest of the team is building: a Solana escrow smart contract, a web frontend, a backend/database, and mock devnet assets. **Your job is only the scoring engine.** It must expose its output through a simple API the others can call.

Everything is a hackathon demo on Solana devnet. No real money, no real cards. Include a "demo only, not financial advice" note in any user-facing output.

## 2. Goal and the three phases

Build in this order. Finish and show me each phase before starting the next.

1. **Phase 1: Data collection.** Build a dataset of historical sales of graded cards.
2. **Phase 2: Model training.** Train models that estimate fair value, uncertainty, and liquidity per card.
3. **Phase 3: Score-to-loan mapping.** Turn model outputs into a single loan score and a table mapping score to loan amount, term, and interest rate.

## 3. Output the engine must produce

For any card, return JSON like this (field names are fixed so the team can integrate; they match `docs/02-architecture.md` and `scoring/schema/score_response.example.json` in the project repo):

```json
{
  "token_mint": "string (Solana NFT mint address, base58)",
  "card_id": "string",
  "card": { "name": "Charizard", "set": "Base Set", "number": "4/102", "year": 1999, "grade_company": "PSA", "grade": 10, "cert_number": "string" },
  "verified": true,
  "fair_value_usd": 1200.0,
  "value_low_usd": 1050.0,
  "value_high_usd": 1380.0,
  "confidence": 0.82,
  "liquidity_score": 0.74,
  "est_days_to_sell": 9,
  "recovery_floor_usd": 780.0,
  "loan_score": 710,
  "recommended_terms": { "max_loan_usd": 600.0, "term_days": 30, "interest_bps": 500, "ltv_pct": 50.0 },
  "explanation": ["Based on 14 comparable sales in the last 60 days", "Sales prices are tightly clustered", "..."],
  "model_version": "string",
  "as_of": "ISO-8601 timestamp"
}
```

**Interest units.** The API and the smart contract use `interest_bps`: a flat charge in basis points over the **whole term** (500 = 5% of the principal for the term, whatever the term length). Do your analysis however you like (APR is useful for comparing tiers), but convert before returning terms: `interest_bps = apr_pct x term_days / 365 x 100`. The score service also accepts the token address (`token_mint`) as its lookup key, since that is what the frontend has.
Explanations must be plain English and reference the actual evidence. A lender or a regulator should be able to see why the score is what it is. Avoid black-box output.

## 4. Phase 1: Data collection

### Data sources, in priority order

1. **Official or documented APIs first.** eBay (sold/completed listings via their official APIs, subject to access), PSA public data (certification lookup, population reports), TCGPlayer API where access is available.
2. **On-chain sales.** Collector Crypt (Solana) and Courtyard (Polygon) marketplace sales and gacha/buyback events. Use public indexers or RPC data (for example Helius, Magic Eden APIs, DefiLlama, Dune queries for Solana; Polygon indexers for Courtyard).
3. **Public datasets.** Look for existing Kaggle/Hugging Face datasets of card sales and prices.
4. **Synthetic fallback.** If real data is hard to get in hackathon time, generate realistic synthetic sales data (see below). Do not stall on scraping.

Respect each site's terms of service and robots.txt. Do not scrape sites that forbid it. If something is blocked, say so and use another source or the synthetic fallback. Do not collect personal data about buyers or sellers; wallet addresses are fine only for wash-trade detection and should be hashed or pseudonymous in any shared dataset.

### Fields to collect per sale

- card_id (our canonical ID: set + number + variant + language)
- grade_company, grade, cert_number (if available)
- sale_price_usd, sale_timestamp, sale_venue (ebay, tcgplayer, collector_crypt, courtyard, auction_house)
- sale_type (auction, fixed_price, buyback, gacha_pull_value)
- buyer_id_hash, seller_id_hash (for wash-trade detection)
- listing_days (time listed before sale, when known)
- days_since_previous_sale of the same card_id and grade

### Also collect, per card

- PSA/CGC population counts at each grade (scarcity)
- Set, year, character/player, language, first-edition or variant flags
- Raw (ungraded) price where available, to compute grade premiums
- Platform buyback offer price where available (this is our recovery-floor signal)

### Data cleaning and quality (important)

- Normalize every card to a canonical card_id so the same card from different sources matches.
- Remove or flag **wash trades**: same wallet on both sides, wallets that repeatedly trade only with each other, round-trip trades within a short window, and prices far from the surrounding cluster with no news.
- Remove duplicates, relisted auctions, shipping-inclusive price mismatches, and obvious errors.
- Flag outliers instead of silently deleting them, and keep a column recording why.
- Store everything in a simple, versioned format (Parquet or SQLite). Keep raw data separate from cleaned data.

### Synthetic data fallback (only if needed)

Generate sales for a catalog of about 200 to 500 cards with realistic structure:
- Base value per card drawn from a heavy-tailed distribution (a few cards worth thousands, most worth under $200).
- Grade multipliers (PSA 10 much higher than PSA 9, and so on).
- Sales volume per card that varies widely (liquid blue chips with many sales, long-tail cards with a few).
- Price noise that is larger for illiquid cards, plus slow drift and occasional shocks (market-wide dips).
- A small share of injected wash trades so the detection logic can be tested.
Label the dataset clearly as synthetic everywhere it appears.

### Phase 1 deliverables

- A data pipeline script that can be re-run.
- A cleaned dataset plus a data dictionary (column names, meanings, units).
- A short data quality report: row counts per source, date coverage, missing-value rates, wash-trade flags.
- A decision note: which sources worked, which did not, and whether we are using real, synthetic, or mixed data.

## 5. Phase 2: Model training

Predict, for any card and grade, at a point in time:

1. **Fair value** (what the card would sell for in a normal sale), with an **uncertainty range**.
2. **Liquidity** (how quickly it could be sold, and how much price concession a fast sale needs).
3. **Recovery value** (what a lender could get on a forced fast sale, anchored to platform buyback prices).

### Suggested approach (start simple, then improve)

- **Baseline:** a comparable-sales estimator. Value is a recency-weighted median of recent sales of the same card and grade, with fallbacks to adjacent grades or similar cards when sales are sparse. Every ML model must beat this baseline to justify itself.
- **Main model:** gradient boosting (LightGBM or XGBoost). Use quantile regression (for example 10th, 50th, 90th percentiles) so the model gives a range, not just a point.
- **Features:** recent sale prices and their statistics (median, mean, spread, trend over 7/30/90 days), number of sales in the last 30/90 days, days since last sale, grade and grade-company, population counts and scarcity ratios, set, year, character or player, raw-price ratio, venue mix, market-wide index (a card-market index built from a basket of popular cards).
- **Confidence score (0 to 1):** derive from the width of the prediction interval relative to the value, the number and recency of comparable sales, and agreement between sources. Wide interval or few sales means low confidence.
- **Liquidity score (0 to 1):** derive from sales frequency, time listed before sale, bid-ask or buyback-to-market gap, and venue breadth.
- **Recovery floor:** a conservative low estimate, for example the lower quantile of value times a haircut tied to liquidity, capped by observed buyback offers.

### Validation rules (critical)

- **Split by time, never randomly.** Train on the past, test on the future. Random splits leak information and will give fake results.
- Evaluate by liquidity tier. Report error separately for liquid blue-chip cards and long-tail cards.
- Metrics: median absolute percentage error, interval coverage (does the 10th to 90th range contain the truth about 80% of the time), and **how often the model overestimates**. Overestimating is the dangerous error for lenders, so track the cost of over-prediction separately.
- Stress test: simulate a 20% to 30% market drop and a wash-trade attack (fake sales inflating one card) and show how the model behaves.
- Check calibration: when the model says confidence is 0.9, it should be right about that often.

### Phase 2 deliverables

- Training code, saved models, and a model card (data used, features, limits, known failure modes).
- A results report with the metrics above, compared to the baseline.
- A function `score_card(card_id, grade, as_of)` returning fair value, range, confidence, liquidity, and recovery floor.
- A short list of what the model does badly (for the pitch: honesty here builds trust).

## 6. Phase 3: Map the score to loans

Convert the model outputs into one **loan score from 0 to 1000** and a lookup from score to loan terms.

### Principles

- **The score describes collateral quality, not the borrower.** There is no credit check; the card is the security. Higher score means the card is easier to price and easier to sell.
- **Loan size comes from recovery value, not market value.** The lender should get back at least the loan even in a bad case.
- Loan terms must be explainable and monotonic: a higher score never gets worse terms than a lower score for the same card value.

### Suggested loan score construction

Combine, with transparent weights (start with something like these and tune):
- Confidence (about 35%)
- Liquidity (about 30%)
- Recovery floor as a share of fair value (about 20%)
- Price stability, meaning low volatility over the last 90 days (about 15%)

Scale the result to 0 to 1000. Document the formula. Keep the weights in a config file.

### Terms table

Produce a table of score bands to terms. Example shape (numbers are placeholders to be derived from your analysis, not final):

| Score band | Tier | Max loan-to-value of fair value | Term options | Interest rate (APR) |
|---|---|---|---|---|
| 800 to 1000 | Blue chip | up to 50% | 7 to 90 days | lowest |
| 600 to 799 | Strong | up to 40% | 7 to 60 days | low |
| 400 to 599 | Moderate | up to 30% | 7 to 30 days | medium |
| 200 to 399 | Thin | up to 20% | 7 to 14 days | high |
| 0 to 199 | Not eligible | 0% | none | none |

A worked example for the demo, and the shape our team has in mind: a card with a mid-range score (say 500) and fair value of a few thousand dollars might qualify for a roughly $1,000 loan over 30 days at about 3% for the term. Reproduce that kind of example from your own numbers rather than assuming it. Note the example's interest is for the 30-day term, which is about 36% annualized, so check whether that rate is consistent with expected losses and say so if not. Make sure the interest and the loan size come out of the model, not from the example.

### Pricing logic for interest

Derive interest from first principles so we can defend it:

```
interest_rate = cost_of_capital + expected_loss + margin
expected_loss = probability_of_default x loss_given_default
```

- Probability of default: for the demo, assume a base rate by tier (document the assumption, since we have no real default history).
- Loss given default: estimated from the gap between loan amount and recovery floor, so a loan below the recovery floor has near-zero expected loss.
- Cost of capital: use a stable reference (for example a typical DeFi stablecoin lending yield, labeled as an assumption).

### Backtest the whole system

Simulate loans over the historical data: for each card and date, compute the score and recommended loan, then check what the card sold for 30, 60, and 90 days later. Report:
- How often the recovery floor was above the loan amount (the lender gets made whole).
- Loss rate by score band.
- Whether higher bands really have lower losses (the score must rank risk correctly).

### Phase 3 deliverables

- The scoring formula and config file.
- The score-to-terms table and the code that produces it.
- The backtest report with loss rates by band.
- A function `get_loan_offer(card_id, grade, requested_amount, requested_term_days)` returning approval status, max loan, rate, and explanation.

## 7. API for the rest of the team

Wrap the engine in a small service (FastAPI is fine):

- `GET /score/{card_id}?grade=10&company=PSA` returns the JSON in section 3.
- `POST /offer` with card_id, grade, requested_amount, requested_term_days returns terms or a decline reason.
- `GET /health` returns model version and data freshness.

Also provide a mock mode with a small fixed set of fake cards so the frontend team can build before the real model is ready.

## 8. Security and manipulation resistance

- Someone may fake sales to pump a card's value. Ignore sales where buyer and seller are linked, down-weight thin or single-venue evidence, and lower confidence when sales look unusual.
- Never output a high confidence from very few sales.
- Cap how fast the value can move between updates, and flag sudden jumps for review.
- Verify that the card is real before scoring (the token must come from the platform's official collection; this check lives in the backend, but expose a `verified` flag input).

## 9. Constraints and style

- Python. Keep dependencies modest and common (pandas, scikit-learn, LightGBM, FastAPI).
- Keep the project in one repo with folders: `data/`, `pipeline/`, `models/`, `scoring/`, `api/`, `reports/`, `config/`.
- Write short tests for the cleaning logic, the score function, and the terms table.
- Be honest in all reports: state what is real data versus synthetic, and where the model is weak.
- Do not give personalized financial advice. Include the disclaimer in outputs.

## 10. How to begin

1. Restate the plan in your own words in five lines or fewer.
2. Tell me which data sources you will try first and which you expect to fail.
3. Start Phase 1. Show me the data quality report before moving to Phase 2.

## 11. Open questions to raise with me early

- Should the loan score be per card only, or also per collection (portfolio of cards)?
- Which card categories first: Pokemon only, or sports and One Piece too?
- Do we have API access to eBay or other sources, or should we start with synthetic data?
- Is the loan term fixed at the borrower's request, or chosen by the model?
