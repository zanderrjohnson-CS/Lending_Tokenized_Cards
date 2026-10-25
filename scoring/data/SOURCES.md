# Real data sources (all free; nothing paid used)

Raw files live in `scoring/data/raw/real/` (gitignored). Collected 2026-10-25 unless noted.

| Source | What | Access | Notes |
| --- | --- | --- | --- |
| Magic Eden public v2 API (`collector_crypt` collection) | Collector Crypt activity: sales (`buyNow`), listings, bids, delists | No key. Rate limited (429), history capped near offset 15,500 (about 2.5 months) | Magic Eden sales only. Buybacks and pack pulls are not here. Many tokens are non-cards (Moonbirds, hats); filtered by `Type == Card`. |
| Magic Eden `/v2/tokens/{mint}` | Card metadata: grader, grade, cert, set, year, name | No key | Includes GemRate ids (possible population source). |
| Polygon public RPC (publicnode) | Courtyard NFT `Transfer` logs and USDC payments into the Courtyard marketplace | No key, 10,000 blocks per call | Contract `0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD`, marketplace `0x5e49...4797`, vault wallet `0x66db...5642` (platform wallet, excluded). Taken from Courtyard docs and tokenURI. Not yet re-confirmed on Polygonscan (needs Etherscan login). |
| Courtyard tokenURI (`api.courtyard.io/index/token/...`) | Per-token metadata (grader, grade, cert, set, year) | Public; the same JSON wallets read. Sent with an honest User-Agent | Default curl User-Agent is blocked (403); we do not evade blocks. |
| Binance public market data | Daily SOLUSDT candles | No key | Used to convert SOL to USD at daily close. |
| Kaggle `ryanheger/pokemon-card-sold-price-reference` | Raw / PSA 9 / PSA 10 reference prices and sample counts for 508 Pokemon cards | Kaggle API token, CC BY 4.0 | Attribution required. Used to sanity-check per-grade prices. |
| Kaggle `zeynepcahan/pokemon-pricecharting` | Monthly used vs graded price per card, 2021 on | Kaggle API token, Apache 2.0 (as stated by uploader) | Underlying data appears to come from PriceCharting, a paid service. Provenance is unclear: keep as context only, do not ship. |

## Not used (paid or blocked)
PriceCharting, CardHedger, Card Ladder, PSA SMR, 130point paid, eBay scraping.

## Pending
- Helius (Collector Crypt buybacks, pack pulls, non-ME sales): needs account.
- PSA public API: the user must accept PSA's End User Agreement. It forbids publishing compiled PSA data and forbids offering it inside a software subscription product, so population data may only be used internally for the demo.
- Dune, Etherscan (Polygonscan), Pokemon TCG API: accounts not finished.
