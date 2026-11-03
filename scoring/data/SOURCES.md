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

| Helius free plan (Enhanced Transactions + DAS) | Collector Crypt marketplace sales (crawled via the marketplace fee wallet `8373hLiA...`), gacha buybacks (crawled via buyback wallet `GachaNgy...`), asset metadata | Free key, 1M credits per month, about 100 credits per enhanced call | Two Collector Crypt collections found through DAS: legacy `CCryptWBYk...` and Metaplex Core `CCryptUfeFS...` (most recent cards). Both addresses came from on-chain DAS grouping, not yet matched to Collector Crypt's own site. Asset metadata includes CC's own `Insured Value`, GemRate ids and PSA pop-report spec ids. |

## Not used (paid or blocked)
PriceCharting, CardHedger, Card Ladder, PSA SMR, 130point paid, eBay scraping.

## Pending
- PSA public API: agreement accepted and token generated, but every call returns HTTP 403 "Access to this API is limited to approved customers". Needs PSA approval (collectors-apis@collectors.com). The agreement also forbids publishing compiled PSA data or using it inside a software subscription product.
- Pack pulls (gacha purchases) are not collected yet.
- Dune, Etherscan (Polygonscan), Pokemon TCG API: accounts not finished.
