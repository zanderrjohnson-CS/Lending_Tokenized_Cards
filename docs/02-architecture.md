# System architecture and shared contracts

Five components talk to each other through three interfaces: the score API, the backend REST API, and the loan contract. **Every workstream must use the names below exactly**, so pieces plug together without rework. If a name or shape has to change, post it in the group, update this file, then build.

```text
                         +------------------+
                         |   Frontend (C)   |
                         +------------------+
                    signs |            | REST API
            transactions  |            |
                          v            v
 +--------------------+  events  +----------------+  score API  +--------------------+
 | Loan contract (A)  | -------> |  Backend (D)   | ----------> | Score service (B)  |
 | holds card + USDC  |          | loan index,    |             | value, risk, terms |
 +--------------------+          | profiles       |             +--------------------+
          ^                      +----------------+                       ^
          | seeds                        | stores                         | feeds
 +--------------------+          +----------------+              +--------------------+
 | Devnet setup (E)   |          | Database (D)   |              | Sales data (B, E)  |
 +--------------------+          +----------------+              +--------------------+
```

Only the loan contract holds cards and money. The backend indexes its events, the score service advises, and the frontend signs transactions and reads through the backend.

## Components

| Component | Owner workstream | Tech | Job |
| --- | --- | --- | --- |
| Loan escrow contract | A | Rust, Anchor, Solana devnet | Holds card NFT and USDC, enforces loan rules |
| Scoring service | B | Python, FastAPI | Returns value, confidence, liquidity, recovery floor, loan score, terms |
| Frontend | C | Next.js or Vite + React, Solana wallet adapter | Wallet login, collection view, score page, marketplace, loan pages |
| Backend and database | D | Node or Python, Postgres or SQLite | Profiles, loan index, reputation, notifications, calls the score service |
| Mock data and devnet setup | E | Anchor/TypeScript scripts | Fake card NFTs, test USDC, seeded sales data, seeded offers |

## Shared names

| Concept | Name | Format |
| --- | --- | --- |
| Card NFT address | `token_mint` | Solana public key, base58 string |
| Canonical card identity | `card_id` | String: set + number + variant + language, for example `base1-4-holo-en` |
| Grade | `grade_company`, `grade` | `PSA` / `CGC` / `BGS`, number 1 to 10 |
| Money on chain | `amount_usdc` | Integer in base units (6 decimals), so $500 = 500000000 |
| Money in APIs | `amount_usd` | Decimal number in dollars |
| Interest | `interest_bps` | Integer basis points charged over the whole term, so 5% = 500 |
| Term | `term_days` | Integer |
| Loan state | `status` | `open`, `active`, `repaid`, `defaulted`, `cancelled` |
| Wallet | `wallet` | Solana public key, base58 string |
| Time | `*_at` | ISO 8601 UTC string in APIs, unix seconds on chain |

## Interface 1: score API (workstream B serves, C and D call)

- `GET /score/{token_mint}` returns the full score object.
- `POST /offer` with `token_mint`, `requested_amount_usd`, `requested_term_days` returns `approved` true or false, `max_loan_usd`, `interest_bps`, `term_days`, and `reason`.
- `GET /health` returns `model_version` and `data_as_of`.

The score object always contains these fields: `token_mint`, `card_id`, `card` (name, set, number, year, grade_company, grade, cert_number), `verified` (boolean), `fair_value_usd`, `value_low_usd`, `value_high_usd`, `confidence`, `liquidity_score`, `est_days_to_sell`, `recovery_floor_usd`, `loan_score` (0 to 1000), `recommended_terms` (`max_loan_usd`, `term_days`, `interest_bps`, `ltv_pct`), `explanation` (list of strings), `model_version`, `as_of`.

A full example lives in [`scoring/schema/score_response.example.json`](../scoring/schema/score_response.example.json).

**Mock mode:** until the real model exists, B returns these fields from a fixed table of fake cards so C and D can build against real shapes.

## Interface 2: backend REST API (workstream D serves, C calls)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/cards?owner={wallet}` | Cards the wallet holds, each with its score summary |
| `GET /api/cards/{token_mint}` | One card with the full score |
| `GET /api/loans?status=open` | Marketplace listing of open offers, each with the score of the card |
| `GET /api/loans/{loan_id}` | One loan with state, dates, parties |
| `POST /api/loans/index` | Called after a chain event to refresh the loan index |
| `GET /api/profile/{wallet}` | Profile and reputation |
| `PUT /api/profile/{wallet}` | Update username and avatar (signed message required) |
| `GET /api/notifications?wallet={wallet}` | Due-date reminders and state changes |

## Interface 3: loan contract (workstream A builds, C and D call)

Instructions: `create_offer`, `cancel_offer`, `accept_offer`, `repay`, `claim_default`. Optional: `sell_to_buyback`. Loan account fields are defined in [`contracts/README.md`](../contracts/README.md).

The contract does not read the score on chain in the MVP. The frontend and backend check the score before an offer is created, and the offer's parameters are fixed in the contract once posted. Reading a signed score on chain is a future upgrade.

## Data flow

1. Collector connects a wallet. Frontend reads the wallet's card NFTs from chain.
2. Frontend asks the backend for each card's score. Backend calls the score service and caches the result.
3. A lender creates an offer through the contract. Backend indexes the event.
4. Borrower accepts through the contract. Card moves to escrow and USDC moves to the borrower.
5. Backend watches chain events, updates loan state, sends reminders, and updates reputation.
6. Borrower repays, or the lender claims after the due date. Backend records the outcome.

## Repo layout

```text
card-credit/
  contracts/   workstream A (Anchor program, tests)
  scoring/     workstream B (data, models, FastAPI service)
  web/         workstream C (frontend)
  server/      workstream D (backend, database)
  devnet/      workstream E (mint, seed, setup scripts)
  docs/        this plan, pitch, demo script
```

## Environment

- Network: Solana devnet only.
- Loan currency: a test USDC mint created by workstream E, with the same decimals (6) as real USDC.
- Secrets (RPC keys, database URL) in `.env` files, never committed. Each service ships a `.env.example`.
- Every service documents how to run locally in its own README.
- All addresses (program ID, test USDC mint, card mints, demo wallets) are published by workstream E in `devnet/addresses.json`. See [`devnet/addresses.example.json`](../devnet/addresses.example.json).
