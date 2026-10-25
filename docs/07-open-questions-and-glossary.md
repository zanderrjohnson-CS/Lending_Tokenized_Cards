# Open questions and glossary

These decisions need the group's answer before or early in the build. Each one lists who it affects and a proposed default. When one is settled, tick it and note the answer.

## Open questions

- [ ] **Which hackathon and track is this for?** It sets the length, the judging criteria, and whether to lean on Solana. Affects: everyone.
- [ ] **How long is the build window?** Needed to turn the build order into dates. Affects: everyone.
- [ ] **Solana only, or also Polygon?** Proposed: Solana only for the build, Courtyard in the pitch. Affects: A, C, D, E.
- [ ] **NFT standard for demo cards.** Proposed: plain SPL token NFTs. Affects: A, E.
- [ ] **Late repayment after the due date.** Proposed: allowed until the lender claims. Affects: A, C.
- [ ] **Protocol fee in the demo.** Proposed: 1% of interest, so the business model shows. Affects: A, D, C.
- [ ] **Interest rate scale.** The earlier example (about 3% for a 30-day loan) is roughly 36% annualized. Decide whether the demo quotes a whole-term rate or an annual rate, and use one consistently. The shared contract currently uses a flat whole-term `interest_bps`. Affects: A, B, C.
- [ ] **Request-driven or offer-driven marketplace.** Proposed: lenders post offers on specific cards, optionally restricted to a borrower who asked. Affects: A, C, D.
- [ ] **Real data or synthetic?** Proposed: synthetic with a labeled real-data attempt for one or two sources. Affects: B, E.
- [ ] **Per-card score only, or collection score too?** Proposed: per card for the build. Affects: B, C.
- [ ] **Who owns what?** Assign a person to each workstream A to F. Affects: everyone.
- [ ] **Product name.** "Card Credit" is a placeholder.

## Glossary

| Term | Plain meaning |
| --- | --- |
| Oracle | A service that brings outside information (like a card's price) onto the blockchain so contracts can use it |
| Token or NFT | A unique digital record on a blockchain. Here it stands for one specific graded card held in a vault |
| Tokenization | Putting a physical item in a vault and issuing a token that represents it |
| Vault | A secure facility (for example Brink's) that stores the physical card |
| Redeem | Burn the token to get the physical card shipped |
| Gacha | A randomized pack opening on a tokenization platform |
| Buyback | A platform's offer to buy a card back at a discount to market, giving instant cash |
| Stablecoin, USDC | A crypto token designed to always be worth $1 |
| DeFi | Finance run by smart contracts instead of banks |
| Pool lending (Aave, Kamino) | Automated pools where depositors earn interest and borrowers post crypto collateral |
| Wallet | An app holding a user's keys. Here, the wallet address is the account |
| Solana, devnet | The blockchain we use, and its free test network |
| Smart contract, program | Code on the blockchain that enforces rules automatically. Solana calls them programs |
| Anchor | A framework for writing Solana programs in Rust |
| IDL | A generated interface file that lets the frontend and backend call the program |
| PDA | A program-controlled account address with no private key, used for vaults |
| Escrow | A neutral holder of assets until the deal's conditions are met |
| Collateral | The asset a borrower locks up to secure a loan |
| Loan-to-value (LTV) | Loan size as a percent of the collateral's value |
| Basis points (bps) | One hundredth of a percent. 500 bps is 5% |
| APR | Annual percentage rate, the interest scaled to a year |
| Liquidation | Automatic selling of collateral when its value falls. Our MVP does not do this |
| Default | Failing to repay by the due date |
| Recovery floor | The conservative amount a lender could get back by selling the collateral fast |
| Confidence | How much we trust a value estimate, from the amount, recency, and agreement of sales |
| Liquidity | How quickly something can be sold without a big discount |
| Wash trading | Faking sales, often between wallets one person controls, to make a price look higher |
| Population report | A grader's count of how many cards exist at each grade |
| PSA, CGC, BGS | Companies that authenticate and grade collectible cards |
| Quantile model | A model that predicts a range (for example 10th to 90th percentile) instead of one number |
| Backtest | Replaying the system on past data to see how it would have performed |
| Peer-to-peer (P2P) | Individuals lending directly rather than through a pooled fund |
