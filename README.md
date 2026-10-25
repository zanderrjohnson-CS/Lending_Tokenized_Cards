# Card Credit (working name)

A credit score for graded collectibles, plus a lending marketplace that proves the score works.

A collector enters a card's token, gets a fair value and a safe borrowing limit, and can borrow USDC against the card from lenders who see the same score. An escrow smart contract holds the card and the money and enforces the loan rules.

> **Hackathon demo.** Runs on Solana devnet with fake cards, synthetic data, and test money. Not financial advice. Nothing here touches real money or real cards.

**One-line pitch:** "We're the credit score for collectibles: one number that tells any lender how much they can safely lend against a graded card, and why."

## The problem and the solution

- **Problem.** Tokenized graded cards (Collector Crypt, Courtyard) hold real value, but there is no trusted way to price them for lending. DeFi pools such as Aave and Kamino reject them, so collectors must sell to get cash.
- **Solution.** A transparent scoring engine (the "oracle") that outputs value, confidence, liquidity, recovery floor, and a recommended maximum loan for any card, plus an escrow contract and a marketplace where lenders fund loans using that score.
- **Who pays.** Lenders and lending protocols (API access plus a small fee per loan). Collectors use the app free.

## Repo layout and workstreams

Each workstream has its own folder with a README that stands alone. Give your agent three things: this README, `docs/02-architecture.md` (shared names and interfaces), and your workstream's README.

| Folder | Workstream | What it builds |
| --- | --- | --- |
| [`contracts/`](contracts/README.md) | A | Solana (Anchor) loan escrow program |
| [`scoring/`](scoring/README.md) | B | Scoring engine and API (Python, FastAPI). ML project prompt in [`scoring/HANDOFF.md`](scoring/HANDOFF.md) |
| [`web/`](web/README.md) | C | Frontend web app |
| [`server/`](server/README.md) | D | Backend, database, accounts, reputation, reminders |
| [`devnet/`](devnet/README.md) | E | Fake card NFTs, test USDC, demo wallets, seeded data |
| [`docs/`](docs/03-pitch-and-demo.md) | F | Pitch, demo script, judging strategy, plus the shared plan documents |

## Shared documents

1. [Product overview and market context](docs/01-product-overview.md)
2. [System architecture and shared contracts](docs/02-architecture.md) (**read this first, every workstream depends on it**)
3. [Pitch, demo script, and judging strategy](docs/03-pitch-and-demo.md)
4. [Strengths, weak points, and risks](docs/04-risks.md)
5. [Scope and build order](docs/05-scope-and-build-order.md)
6. [Roadmap and ways to build on this](docs/06-roadmap.md)
7. [Open questions and glossary](docs/07-open-questions-and-glossary.md)

## Working agreements

- Use the exact field names and endpoint shapes in `docs/02-architecture.md` so the pieces plug together.
- If you need to change a shared interface, post it in the group before building on it, then update the doc.
- Everything runs on Solana devnet with fake assets. Where a doc says "mock", build a simple stand-in that returns realistic data. Real integrations are future work.
- Never commit secrets: `.env` files, wallet keypairs, RPC keys.
- Be honest about what is fake. Label synthetic data as synthetic everywhere it appears.

## Build order at a glance

1. **Day one, in parallel:** E creates test USDC and demo wallets. B ships mock mode. A scaffolds the program. C scaffolds the app. D scaffolds the server. F writes the story.
2. **Next:** E mints demo cards and sales history. A finishes the four core instructions with tests. B builds the dataset and baseline. C builds the score page on mock data.
3. **Then:** A deploys to devnet and publishes the program ID. D builds the indexer. C wires the contract. B trains the model and builds the loan score.
4. **Then:** E seeds loans using the real contract. B swaps mock mode for the real engine.
5. **Last:** polish, reminders, reputation, backup demo video, rehearsal.

Full details, dependencies, and the cut list are in [`docs/05-scope-and-build-order.md`](docs/05-scope-and-build-order.md).
