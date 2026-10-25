# Future roadmap and ways to build on this

The long-term product is the score. The marketplace is the proof. Everything below either improves the score, gives lenders more ways to use it, or reaches new customers.

## Improve the score

- **Real data.** Connect eBay, TCGPlayer, PSA, and on-chain indexers, with agreements where required.
- **Real outcomes.** As loans run, record repayments and defaults, and use them to calibrate default probabilities and loan-to-value by score band.
- **Platform risk.** Add vault, grader, and platform health to the score, so a freeze or custody problem lowers it.
- **Collection scores.** Score a bundle of cards together, accounting for overlap (20 copies of one card are riskier than 20 different cards).
- **Live updates.** Refresh scores continuously and flag sudden moves.
- **Signed scores on chain.** The score service signs each score so contracts can verify it on chain and use it directly.

## More ways to lend

- **Pooled instant loans.** Borrowers get an immediate quote from a pool instead of waiting for a lender. Loan-to-value set by liquidity tier, for example higher for blue-chip grade 10 cards and lower for long-tail cards.
- **Buyback as a backstop.** Use the platform's discounted buyback as a price floor and as an automatic exit after default.
- **Bundled loans.** Combine many mid-tier cards into one position so small cards add up to a loan worth making.
- **Buy now, pay later.** Borrow to buy a card, with that card as collateral.
- **Lender vaults.** Tranched pools where lenders earn a share of many card loans without judging each card.
- **Loan extensions, partial repayment, and refinancing** with a new lender.

## Reach more customers

| Customer | What they need from the score | When |
| --- | --- | --- |
| On-chain lending protocols (Offerbook, NFTfi, GONDI, Teller) | A price and risk number next to each loan | First |
| Tokenization platforms (Collector Crypt, Courtyard) | A lending feature backed by a trusted score | First |
| Specialty collectibles lenders (Alt, auction-house advances, pawn shops) | Faster, cheaper, consistent valuations | Early |
| Crypto credit funds and market makers | Confidence to lend against a new asset class | Early |
| Insurers | Collection valuations for coverage | Mid |
| Banks and fintech lenders | Explainable, validated scores with a track record | Later |
| DeFi lending pools (Aave, Kamino style) | A price source to accept top-tier cards as collateral | Later |

## Reach more assets

Extend beyond Pokemon: sports cards, One Piece and other trading card games, then watches, sneakers, comics, and coins. Each category needs its own sales data and grading rules but reuses the same score structure and contract.

## Reach more users

- **Hide the crypto.** Embedded wallets, email or Google sign-in, and dollar payouts, so collectors never see a wallet.
- **Cross-chain.** Support Courtyard (Polygon) as well as Collector Crypt (Solana).
- **Free valuation tool.** A public "what is my collection worth and what can I borrow" tool that sends borrowers to partner lenders for a referral fee.

## The long-term line

Today, peer-to-peer card loans. Next, a score every lender uses. Eventually, graded collectibles accepted as standard collateral across DeFi and traditional finance, priced by our score.
