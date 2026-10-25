# server/ (workstream D): backend, database, accounts, reputation

TypeScript on Node 22.13+, Fastify, and Node's built-in SQLite (`node:sqlite`): no native builds, no paid services.
The chain is the source of truth. The database is a searchable copy plus profile data, and can be deleted and rebuilt.

## Run locally

```bash
npm install
cp .env.example .env          # set PROGRAM_ID / IDL_PATH once workstream A publishes them
npm run mock-score            # synthetic stand-in for workstream B (port 8000)
npm run seed                  # optional: synthetic demo loans, replayed through the real indexer
npm run dev                   # API on :8787, indexer + reminders in the same process
npm test                      # acceptance checks, no network or validator needed
```

Without `PROGRAM_ID` or the IDL file, the indexer is disabled with a warning and the API still serves the database.

## What maps to the spec

| Spec item | Where |
| --- | --- |
| Tables and migrations | `src/db.ts` (versioned with `PRAGMA user_version`) |
| Score client, 10 min cache, stale fallback, schema validation | `src/scoreClient.ts` |
| Indexer (idempotent, replay-safe) | `src/indexer.ts`, sources in `src/chain/` |
| Reputation from chain history only | `src/reputation.ts` |
| Reminders 72/24/1 h, overdue | `src/reminders.ts` |
| Card reader (supported collection only) | `src/cards.ts` |
| Signed profile updates | `src/profiles.ts` |
| REST API | `src/app.ts` |

Extra columns/tables beyond the spec: `profiles.last_signed_at` (replay guard), `reputation.first_loan_at`, and `chain_events`
(a normalized copy of events so loans and reputation can be rebuilt without the RPC).

## Behaviors worth knowing

- **Fail soft.** Fresh cache, else fetch, else stale cache (`score.stale: true`), else `score: {available: false}`. A score is never invented, and an invalid response from the score service is rejected.
- **Unverified cards** return `verified: false`, `recommended_terms: null`, `within_score_limit: null`.
- **`within_score_limit`** compares `principal_usd` with the current score's `max_loan_usd`. It is a flag only. `score_at_offer` is a snapshot taken when the offer is first indexed (null if the score service was unreachable then).
- **Expired offers** (`offer_expires_at` in the past) are hidden from `GET /api/loans?status=open`.
- **Idempotency.** Events are keyed by `(signature, event index)`. Re-running the indexer, or a replay of the same events, changes nothing.
- **Rebuild.** Delete the DB file and run the indexer, or `npm run reindex`. `POST /api/admin/rebuild` (needs `ADMIN_TOKEN`) rebuilds loans/reputation from the stored event copy.
- **`POST /api/loans/index`** is public and cheap: it only reads the chain, and simultaneous calls share one run. The indexer also polls every `INDEXER_POLL_SECONDS`.
- **Notifications** are written for due reminders and state changes (accepted, repaid, defaulted). There is no delivery or mark-as-read yet (`read_at` stays null).

## Profile signing (for workstream C)

`PUT /api/profile/{wallet}` body: `{ username, avatar_url, timestamp, signature }`. `username` is 3-20 of `A-Za-z0-9_` or null, `avatar_url` is https or null.
Sign this exact UTF-8 message with the wallet (`signMessage`) and send the signature as base58 (base64 also accepted):

```text
CardCredit profile update
wallet: <wallet>
username: <username or empty>
avatar_url: <avatar_url or empty>
timestamp: <unix seconds>
```

The timestamp must be within 5 minutes of server time and greater than the wallet's previous signed timestamp, which blocks replays.

## Assumptions to reconcile with other workstreams

1. **Event payloads** are assumed in `src/events.ts` (field names, base-unit USDC, unix-second times, `loan_id` as the key). Workstream A should confirm; only that file and `src/chain/rpcSource.ts` (snake_case conversion) should need to change.
2. **Lender creates the offer, borrower accepts** (per the architecture data flow). `BuybackSold` is treated as `repaid`.
3. **`devnet/addresses.json`** is read leniently for `program_id` and card mints (`card_mints` / `cards`); adjust `readAddresses` in `src/config.ts` to E's real shape.
4. **Score `card.number`/`cert_number`** accept string or number.
5. The RPC indexer and wallet card reader are **not yet tested against live devnet** (no program or mints exist yet). Everything else is covered by `npm test`.

## Cost notes (MVP)

Free public devnet RPC with polling (no webhook service), SQLite file on disk, in-process jobs, 10 minute score cache. If the public RPC rate-limits you, set `SOLANA_RPC_URL` to a free-tier provider URL; nothing else changes.

## Out of scope

Passwords, KYC, fiat, email deliverability, admin dashboard. Stretch items (embedded-wallet sign-in, push, public API key, usage metering) are not started.
