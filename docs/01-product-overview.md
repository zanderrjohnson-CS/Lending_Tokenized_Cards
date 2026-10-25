# Product overview and market context

Tokenized graded cards are a real and growing market, and lending against them has started, but nobody offers a shared, transparent price and risk score. That gap is our opening. Market figures below are as reported in news coverage and should be rechecked before the pitch. They were read from search results, not full pages, so treat them as approximate until verified.

## Market context

### Who is already in this space

| Player | What it does | Chain | Relevance to us |
| --- | --- | --- | --- |
| [Collector Crypt](https://solanacompass.com/news/collector-crypt-crosses-16-billion-in-volume-as-solanas-tokenized-card-market-builds-scale) | Vaults graded cards, issues NFTs, runs gacha packs and a buyback. Reported 130,000+ cards tokenized and $1.6B lifetime volume. | Solana | Main source of collateral and sales data. Its buyback price is our recovery-floor signal. |
| [Courtyard](https://privy.io/blog/inside-the-stack-how-courtyard-is-reinventing-the-collectibles-marketplace) | Vaults cards at Brink's, mints 1:1 tokens, runs a marketplace. Reported 50,000+ trades a day on many days in 2026. | Polygon | Second collateral and data source. Supports cross-platform expansion. |
| [Jupiter Offerbook](https://solanacompass.com/news/jupiter-offerbook-enters-public-beta-with-fixed-rate-lending-against-tokens-nfts-and-tcg-cards) | Peer-to-peer fixed-rate, fixed-term loans against tokens, NFTs, and graded cards. Public beta announced June 23, 2026. No price-based liquidations. | Solana | Closest competitor and best first integration. It accepts cards but has no card pricing. |
| [Alt](https://techcrunch.com/?p=2357431) | Lends against cards stored in its own vault. Rolling out state by state because lending rules vary. | Off-chain | Proves demand. A likely customer for a scoring API. |
| NFTfi, GONDI, Teller | Bespoke peer-to-peer NFT loans. Teller supports Courtyard NFTs. | Ethereum and others | Potential integrations on the Ethereum side. |

### What is missing

- **A trusted price.** Card prices live off-chain on eBay, TCGPlayer, and auction sites, which makes automated lending hard ([Decrypt](https://decrypt.co/338694/tokenized-pokemon-cards-hot-lending-crypto-different-story)).
- **A shared risk number.** Each lender judges each card by eye, so loan sizes are inconsistent and slow.
- **Pool-style lending.** DeFi pools such as Aave and Kamino reject card NFTs, because they cannot price them or sell them quickly.

### How we are different

1. We sell the **score**, not just a loan product, so lenders compete and all of them need us.
2. Our score is **transparent**: every number comes with a plain-English reason, which regulators and risk teams will ask for.
3. We anchor loan size to the **recovery floor** (what a lender gets back on a forced sale), not market value.
4. We treat the platform **buyback** as a price floor, which Offerbook does not use.

### Reasons the market may be shaky

- Collector Crypt holds a large share of Solana's tokenized card market (reported 63 to 64%), so the sector leans on one operator.
- Its randomized pack mechanic draws regulatory questions because it resembles gambling.
- Courtyard's CEO said last year it was not exploring lending, and card collectors are reported to be wary of going on-chain.

### Sources

- [Solana Compass: Collector Crypt volume](https://solanacompass.com/news/collector-crypt-crosses-16-billion-in-volume-as-solanas-tokenized-card-market-builds-scale)
- [Solana Compass: Jupiter Offerbook beta](https://solanacompass.com/news/jupiter-offerbook-enters-public-beta-with-fixed-rate-lending-against-tokens-nfts-and-tcg-cards)
- [Decrypt: Tokenized Pokemon cards and lending](https://decrypt.co/338694/tokenized-pokemon-cards-hot-lending-crypto-different-story)
- [TechCrunch: Alt lending](https://techcrunch.com/?p=2357431)
- [Privy: Inside Courtyard's stack](https://privy.io/blog/inside-the-stack-how-courtyard-is-reinventing-the-collectibles-marketplace)

## Product overview

The product has two pieces. The **score** is the core business. The **marketplace** is the demo and first customer that proves the score works.

### Piece 1: the score (the oracle)

An "oracle" is a service that brings outside information (like a card's price) onto the blockchain so contracts can use it. A user enters a card's token address. The system checks the token is genuine, reads the card details, pulls recent sales, and returns:

- **Fair value** and a low to high range
- **Confidence** (0 to 1): how much to trust the value, based on how many sales exist, how recent they are, and how closely they agree
- **Liquidity** (0 to 1): how fast the card could realistically sell
- **Recovery floor**: the minimum a lender could expect on a forced sale, anchored to platform buyback offers
- **Loan score** (0 to 1000) and **recommended terms**: maximum loan, term, interest rate
- **Plain-English explanation** of why

The score is shown on every listing in our marketplace and served through an API for other platforms.

### Piece 2: the lending marketplace

Collectors request loans against their tokenized cards. Lenders post offers or fund requests. An escrow smart contract holds the card and the money, and enforces the rules.

### Users and customers

| Group | Role | What they get | Pays? |
| --- | --- | --- | --- |
| Collectors (borrowers) | Hold a tokenized card, want cash without selling | Cash in minutes, keep future price gains, free valuation tool | No |
| Lenders | Individuals and funds with spare USDC | Interest above standard DeFi pools, protection from the recovery floor, a score instead of guesswork | Yes, via platform fee |
| Lending protocols and platforms | Offerbook, Alt, Collector Crypt, Courtyard | A ready-made price and risk feed | Yes, via paid API |
| Banks and insurers (later) | Value collections, lend at scale | Track record and explainable scores | Later |

We do not target banks first. They approve new data vendors slowly and need legal clarity on holding NFTs as collateral. Start with on-chain protocols and specialty lenders who can say yes in weeks.

### Business model

- A small fee on each loan funded (for example 1%).
- Paid API access to the score for other platforms.
- Referral fees from lenders for borrowers sent through the free valuation tool.

### Loan lifecycle (MVP rules)

The MVP uses fixed-term loans with no price-based liquidation. The score decides how much can be lent, never when a card is seized. This avoids unfair liquidations from a bad price reading.

1. **Check.** The borrower enters a token address and sees the score and the maximum loan.
2. **Offer.** A lender posts an offer, for example "$500 USDC for 30 days at 5%". The USDC is deposited into the escrow contract.
3. **Accept.** The borrower accepts. In one transaction the card NFT goes into escrow and the USDC goes to the borrower.
4. **Repay.** Before the due date, the borrower pays principal plus interest. The contract returns the NFT to the borrower and pays the lender.
5. **Default.** If the due date passes unpaid, the lender can claim the NFT. Optionally the contract sells it to the platform buyback and pays the lender in USDC.
6. **Remind.** The borrower gets notices before the due date so forgetfulness does not become default.

### Why the wallet is the account

Users sign in by connecting a Solana wallet. The wallet address is the account ID. An optional profile (username, avatar) and an automatic reputation record (loans repaid, defaulted, total volume) are stored off-chain and tied to the address. Email or Google sign-in through an embedded wallet service is a stretch goal for collectors who do not want to touch crypto.

### Why escrow is a smart contract, not our wallet

We never hold user assets in a wallet we control. A contract with fixed rules holds the card and the money, so users do not have to trust us, a hack of our servers cannot move funds, and our legal exposure as a custodian shrinks.
