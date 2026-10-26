# Card safety score: data sources, scripts, and a first sample

Starter data pipeline for the lending "safety score" (Liquidity, Volatility, Spread, Authenticity,
Concentration, Trend). Ten popular cards, real prices and sold listings pulled on 2026-10-26,
and a script that turns them into factor scores and a 0-100 composite.

## What's here

| Path | What it is |
|---|---|
| `data/cards.csv` | Starter set: 10 cards (3 vintage Base Set holos, 7 modern chase cards) with pokemontcg.io ids and PriceCharting paths |
| `data/raw/pricecharting_2026-10-26.txt` | Per-grade price + sales volume, and ~60 ungraded sold listings per card (eBay + TCGplayer), 585 sales total |
| `data/raw/pokemontcg_snapshot.csv` | TCGplayer low/mid/high/market and Cardmarket avg1/7/30/trend for 5 of the 10 cards |
| `src/compute_factors.py` | Computes all six factors and the composite. Standard library only. `python src/compute_factors.py` |
| `src/fetch_*.py` | One fetcher per source (below), to run on a normal laptop or server |
| `output/factors.csv`, `output/factors.json` | Results of the sample run |
| `web/` | Frontend web app (Next.js), kept from the earlier version of this repo |

## Data sources and access

| Source | What it gives | Access | Limits and terms | Factors it feeds |
|---|---|---|---|---|
| **PriceCharting** | Per-grade prices (raw, 7, 8, 9, 9.5, PSA 10), sales-volume per grade, recent sold listings from eBay, TCGplayer, Goldin, Fanatics, Heritage | Official API needs a paid subscription token. Public card pages show ~30 eBay + ~30 TCGplayer recent sales | Terms restrict scraping; page mode is for a small demo only. API gives prices + volume but not sale-by-sale history | Liquidity, Volatility, Spread, Trend, Concentration (venue proxy) |
| **pokemontcg.io** | Card metadata + daily TCGplayer listing prices (low/mid/high/market) and Cardmarket averages (1/7/30-day, trend) | Free; key optional (dev.pokemontcg.io) | 1,000 req/day without key, 20,000 with. Snapshot only, so history must be built by running daily. The API was flaky today (5 of 10 cards timed out) | Spread (listed vs sold), Trend (Cardmarket) |
| **tcgcsv.com** | Every TCGplayer Pokemon product's daily low/mid/high/market price as JSON | Free, no key | Daily granularity, no individual sales. Dated archives exist for backfill | Volatility and Trend once history accrues |
| **TCGplayer API** | Same pricing, first party | Closed to new developers | Use tcgcsv instead. Their internal sales-history endpoints are undocumented; we did not use them | |
| **eBay Browse API** | Active listings: count and asking prices | Free developer account, OAuth client credentials | 5,000 calls/day. **No sold data**: that's the Marketplace Insights API, partner-only. Scraping sold pages violates the user agreement | Spread (ask vs sold), Liquidity (supply) |
| **PSA Public API** | Cert lookup (verifies a pledged slab), population by spec | Free account + token | ~100 calls/day. Pop report web pages require login (confirmed: redirect to sign-in) | Authenticity |
| **CGC / BGS** | Cert verification on their sites | Web lookup only; no public API | Manual or per-cert | Authenticity |
| **Distinct buyers** | — | Not available from any public source | eBay, TCGplayer, PriceCharting all hide buyer identity | Concentration (only a venue-diversity proxy is possible; real buyer data would come from our own platform's transactions) |

## How each factor is computed (sample version)

- **Liquidity**: modeled sales per 30 days across all grades, from PriceCharting's volume figures. Log-scaled, 300+/month = 100.
- **Volatility**: weekly median of TCGplayer Near Mint sales (cleaner than eBay raw, which mixes conditions), then the std of weekly log returns and the max drawdown over 90 days (180 if thin). Sales below 0.5x or above 2x the median are dropped as damaged copies or lots.
- **Spread**: interquartile range of the last 30 days of sold prices as a % of the median, plus TCGplayer listed mid vs median sold when the snapshot is available.
- **Authenticity**: share of trading volume that is graded, and the PSA 10 to raw price multiple. Pop counts need a PSA token.
- **Concentration**: 1 minus the venue HHI of observed sales. A weak proxy, so it carries 5% weight.
- **Trend**: last-30-day median vs the 30 to 120 day median (falls are penalized harder than rises), plus Cardmarket trend vs 30-day average. A manual reprint flag column is included.

Composite weights: liquidity 30%, volatility 25%, spread 15%, trend 15%, authenticity 10%, concentration 5%. Factors without data are dropped and the rest reweighted.

## Sample results (2026-10-26)

| Card | Score | Tier | Liq | Vol | Spread | Auth | Conc | Trend |
|---|---|---|---|---|---|---|---|---|
| Gengar VMAX alt art | 81.4 | A | 89.5 | 81.9 | 43.6 | 90.8 | 74.8 | 98.5 |
| Pikachu with Grey Felt Hat | 81.2 | A | 99.0 | 65.9 | 74.8 | 99.3 | 74.4 | 67.8 |
| Giratina V alt art | 81.1 | A | 85.4 | 73.3 | 67.7 | 85.4 | 75.0 | 98.0 |
| Charizard ex 223 (Obsidian Flames) | 76.2 | A | 96.7 | 61.0 | 69.5 | 97.7 | 75.0 | 53.1 |
| Charizard ex 199 (151) | 75.7 | A | 94.5 | 65.1 | 83.4 | 95.9 | 74.4 | 34.9 |
| Lugia V alt art | 75.5 | A | 94.9 | 61.5 | 66.7 | 96.2 | 75.0 | 55.5 |
| Umbreon VMAX alt art | 72.8 | B | 83.5 | 61.0 | 64.4 | 98.9 | 73.2 | 61.6 |
| Base Set Blastoise | 68.2 | B | 92.0 | 42.3 | 21.7 | 100 | 34.7 | 100 |
| Base Set Charizard | 65.9 | B | 92.0 | 55.4 | 8.4 | 100 | 58.2 | 68.8 |
| Base Set Venusaur | 52.5 | C | 89.0 | 27.4 | 0.0 | 100 | 65.4 | 37.5 |

What this already shows:
- **Raw vintage is weak collateral.** Ungraded Base Set holos have huge sold-price spreads (IQR 49 to 59% of median) because "ungraded" mixes Heavily Played and Near Mint copies. The same cards trade 2 to 3 times a day per grade once slabbed. The score should be computed per card *and grade*, since a loan is secured by one specific slab.
- **Modern chase cards look safest right now** on liquidity and spread, but several are in a pullback (151 Charizard down ~18%, Lugia and Obsidian Flames Charizard down 12 to 13% vs the prior 3 months), which the Trend factor catches.
- **Umbreon VMAX** had two TCGplayer sales at $399 and $800 against a ~$2,000 median; without the outlier filter its volatility score was 0. Data cleaning matters as much as the formula.

## Caveats on the sample data

- Our cloud sandbox's network policy blocks these sites, so the sample was read through a web-page fetcher and transcribed, not pulled by the scripts. Spot-check a few rows before quoting numbers. The fetch scripts are written to run from a normal machine; `compute_factors.py` was run on the sample.
- PriceCharting caps each list at ~30 sales per venue, so "observed sales" is a lower bound; use the per-grade volume figures for liquidity.
- For the Obsidian Flames Charizard the page labelled its first sales table "All"; it was treated as ungraded.
- Graded-sale tables were truncated in the fetch and are left out of the sample.
- `fetch_pricecharting.py page`, `fetch_psa.py`, `fetch_tcgcsv.py` and `fetch_ebay.py` have not been run against the live services (blocked here). The parsing logic compiles and the HTML parser passes a synthetic test, but expect small fixes on first run.

## Running it

```bash
python src/compute_factors.py                      # score the sample (no network)
python src/fetch_pokemontcg.py                     # daily snapshot (key optional; injected in the cloud env)
python src/fetch_tcgcsv.py                         # daily TCGplayer prices
PRICECHARTING_TOKEN=... python src/fetch_pricecharting.py api
EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=... python src/fetch_ebay.py
python src/fetch_psa.py cert 12345678              # PSA_TOKEN=... outside the cloud env
```
Python 3.9+, no third-party packages. Run fetchers from the repo root.
