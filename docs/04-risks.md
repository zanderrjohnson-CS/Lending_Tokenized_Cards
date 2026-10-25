# Strengths, weak points, and risks

The idea is strong because it fills a gap rather than copying a product, but its biggest weakness is the same gap: pricing is hard, and our demo data is synthetic. Judges who know this space will probe that, so the plan is to name it first.

## Strengths

- **Real demand.** Collector Crypt reports 130,000+ tokenized cards and Courtyard reports tens of thousands of daily trades, so there is collateral sitting idle.
- **Gap, not clone.** Offerbook and Alt lend against cards, but none offers a shared, transparent price and risk score.
- **Standardized collateral.** A graded card (a known set, number, grade, and cert) is far easier to value than a one-of-one NFT.
- **Proven loan shape.** A reported $30,000 loan against a roughly $60,000 PSA 10 card shows 50% loan-to-value is something people already do.
- **Neutral position.** As a scoring layer we sell to every lender instead of competing with them.
- **Buildable in a hackathon.** Escrow contracts are well-understood, and hard parts (real data, custody) can be mocked and named.

## Weak points and risks

| Risk | Why it matters | How we handle it |
| --- | --- | --- |
| No reliable price feed | Sales are sparse and spread across venues. A wrong price over-lends | Confidence score, loan size from the recovery floor, low loan-to-value on thin cards |
| Fake sales and wash trading | Someone can pump a card's score to borrow more | Drop linked-wallet sales, down-weight thin evidence, cap value movement, show the stress test |
| Fake tokens | Anyone can mint an NFT with copied card details | `verified` check against the official collection before any score |
| Illiquid collateral | A defaulted $300 card is hard to sell for fair value | Fixed terms with no forced selling, buyback as a floor, minimum loan size |
| Small loans not worth it | Interest on $100 is tiny. A 12% APR on $100 of cards has unclear value to a borrower | Minimum loan size, bundling cards into one position (roadmap) |
| Stacked trust | We rely on the tokenizer, its vault, and the grader (PSA, CGC) | Name it in the pitch. Add platform risk to the score later |
| Collectors wary of crypto | Reports say many card collectors do not want to go on-chain | Embedded wallets and dollar payouts (roadmap), free valuation tool as the entry point |
| Cold start for lenders | A marketplace needs lenders before borrowers show up | Seed demo offers. Sell the score to existing lenders first |
| Regulation | Consumer lending is regulated state by state. Randomized pack mechanics on some platforms draw gambling questions | Devnet demo only. Disclaimer. Partner with licensed lenders. List compliance as future work |
| Concentration | One platform holds most of Solana's tokenized card market | Support Courtyard and others |
| No real default history | Default probabilities are assumptions | Label them as assumptions. Collect real outcomes as loans happen |
| Bank adoption is slow | Banks need legal clarity on NFT collateral and explainable models | Start with on-chain and specialty lenders. Design for explainability |

## Where the idea is most likely to be challenged

1. "Isn't this Offerbook?" Prepare the answer in [`03-pitch-and-demo.md`](03-pitch-and-demo.md).
2. "Your data is fake." Say so first. Show the method, the validation, and the plan to connect real sources.
3. "Who would ever lend against a $200 card?" Show that the score sets size and rate, and that bundles and higher tiers are where volume is.
