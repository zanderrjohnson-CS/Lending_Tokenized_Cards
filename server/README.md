# Workstream D: Backend, database, accounts, and reputation

**Goal.** A small server that connects the pieces: it asks the score service for scores, watches the chain for loan events, keeps a searchable index of loans, stores profiles and reputation, and sends reminders. The chain is the source of truth for money and cards; the database is a fast, searchable copy plus profile data.

**Hand your agent:** the root [README](../README.md), [`docs/02-architecture.md`](../docs/02-architecture.md), and this file.

## Principles

- **Chain first.** Never store anything that decides who owns a card or money. Rebuild the loan index from chain events if the database is wiped.
- **The wallet is the account.** No passwords. Profile edits require a signed message from the wallet.
- **Cache scores.** Scores take time and cost compute. Cache per `token_mint` for a short period (for example 10 minutes) and expose the `as_of` time.
- **Fail soft.** If the score service is down, show the last cached score marked stale. Never invent a score.

## Data model

| Table | Key fields |
| --- | --- |
| `profiles` | `wallet` (primary key), `username` (unique, optional), `avatar_url`, `created_at` |
| `cards` | `token_mint` (primary key), `card_id`, `name`, `set`, `grade_company`, `grade`, `cert_number`, `image_url`, `verified` |
| `scores` | `token_mint`, `loan_score`, `fair_value_usd`, `confidence`, `liquidity_score`, `recovery_floor_usd`, `payload_json`, `model_version`, `as_of` |
| `loans` | `loan_id` (primary key), `lender`, `borrower`, `token_mint`, `principal_usd`, `interest_bps`, `term_days`, `status`, `offer_expires_at`, `started_at`, `due_at`, `score_at_offer`, `tx_signatures` |
| `reputation` | `wallet` (primary key), `loans_repaid`, `loans_defaulted`, `volume_usd`, `updated_at` |
| `notifications` | `id`, `wallet`, `type`, `loan_id`, `message`, `created_at`, `read_at` |
| `chain_cursor` | `last_signature`, `last_slot` (where the indexer stopped) |

Use SQLite or Postgres. SQLite is fine for the hackathon.

## Services inside the backend

1. **REST API.** The endpoints listed in [`docs/02-architecture.md`](../docs/02-architecture.md).
2. **Chain indexer.** Listens to the loan program's events (`OfferCreated`, `OfferCancelled`, `LoanStarted`, `LoanRepaid`, `LoanDefaulted`, `BuybackSold`), updates `loans`, and records the transaction signature. Use program logs or a webhook service. Must be safe to re-run without creating duplicates.
3. **Score client.** Calls the score service, validates the response against the shared field names, and caches it.
4. **Reputation updater.** On `LoanRepaid` and `LoanDefaulted`, updates both parties' counts and volume.
5. **Reminder job.** A scheduled task that finds active loans due within 72, 24, and 1 hours and writes notifications. Email or push delivery is a stretch.
6. **Card reader.** Given a wallet, lists token accounts, keeps only mints from the supported demo collection, and attaches the card record.

## Rules the backend enforces

- An offer is shown as "within score limit" only if `principal_usd` is at or below the score's `max_loan_usd`. Show a clear flag otherwise. The contract itself does not block above-limit offers in the MVP.
- Store `score_at_offer` when an offer is indexed, so the score used at the time can be reviewed later (useful for the backtest and the pitch).
- A token that is not `verified` is returned with `verified: false` and never gets terms.
- Profile changes require a signature over a fixed message plus a timestamp, to stop replays.

## Reputation record

Built only from chain history, so it cannot be faked: loans repaid, loans defaulted, total volume, and the date of the first loan. Show it on profiles. Do not turn it into a score in the MVP.

## Tasks

1. Scaffold the server, database, and migrations. Add a health endpoint.
2. Build the score client with caching and a stale-score fallback. Use the score service's mock mode first.
3. Build `GET /api/cards` and `GET /api/cards/{token_mint}`.
4. Build the indexer against devnet with the program ID from workstream A. Test it with replayed events.
5. Build `GET /api/loans`, `GET /api/loans/{loan_id}`, and the reindex endpoint.
6. Build profiles with signed updates, and the reputation updater.
7. Build reminders and notifications.
8. Add a seed script so the demo database starts with realistic loans (coordinate with workstream E).

## Acceptance checks

- Deleting the database and re-running the indexer reproduces the same loan list.
- Running the indexer twice on the same events creates no duplicates.
- A stale or failing score service never breaks a page.
- Profile updates without a valid signature are rejected.
- Reminders appear for a loan due within 24 hours in a test.

## Out of scope

Password accounts, KYC and identity checks, fiat payments, email deliverability, and an admin dashboard. List compliance as future work in the pitch.

## Stretch

Email or Google sign-in through an embedded wallet service, push notifications, a public read-only API key for other platforms, and usage metering for the paid score API.
