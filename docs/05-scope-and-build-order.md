# Scope and build order

Build the must-haves first, in the dependency order below, and treat everything else as optional. The hackathon length is not set yet, so this file gives order and dependencies rather than dates. Add dates once the length is known.

## Must have

| Area | Item | Workstream |
| --- | --- | --- |
| Login | Wallet connect as the account | C |
| Assets | Test USDC, demo wallets, fake card NFTs on devnet, two fake lookalikes | E |
| Score | Score page with value, range, confidence, liquidity, recovery floor, loan score, terms, explanation | B, C |
| Contract | Create offer, accept, repay, claim default | A |
| Marketplace | Open offers list with the score on each one | C, D |
| Fake-token check | Unverified tokens rejected | B, D, E |
| Demo | Scripted happy path and default path, backup video | F |

## Nice to have

| Item | Workstream |
| --- | --- |
| Reputation profiles built from chain history | D |
| Public score API endpoint with documentation | B |
| Due-date reminders | D |
| Automatic sale to buyback after default | A |
| Fake-sales attack demo | B, E |
| Collection-level score | B |

## Pitch only (not built)

Bank partnerships, insurer use cases, cross-platform support for Courtyard, other asset types (watches, sneakers, comics), pooled instant loans, loan bundles, buy-now-pay-later, tranched lender vaults, and cards as DeFi pool collateral.

## Dependencies and build order

1. **Day one, in parallel:** E creates the test USDC and demo wallets. B ships mock mode with the fixed response shape. A scaffolds the program. C scaffolds the app with wallet connect. D scaffolds the server. F writes the story.
2. **Next:** E mints the demo cards and sales history. A finishes offer, accept, repay, claim with tests. B builds the dataset and baseline. C builds the score page on mock data.
3. **Then:** A deploys to devnet and publishes the program ID. D builds the indexer and loan endpoints. C wires the contract and the marketplace. B trains the model and builds the loan score and terms.
4. **Then:** E seeds loans in each state using the real contract. B swaps mock mode for the real engine. C and D connect to the real score.
5. **Last:** polish, reminders, reputation. F records the backup video and rehearses. Freeze features early, then test the whole flow on the venue network.

## What blocks what

- C and D are blocked by B's mock mode until the real engine exists, so mock mode comes first.
- D's indexer is blocked by A's program ID and IDL.
- Seeded loans (E) are blocked by A's deployed program.
- The demo cannot be rehearsed until all five flows work end to end.

## Cut list if time runs short

Cut in this order: collection-level score, fake-sales attack demo, automatic buyback sale, reminders, reputation, public API docs. Never cut: the score page, the contract's four core instructions, the marketplace, the fake-token check, and the demo backup video.
