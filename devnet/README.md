# Workstream E: Mock data and devnet setup

**Goal.** Create everything the other workstreams need to run a believable demo without touching real cards or real money: fake graded-card NFTs, test USDC, funded demo wallets, sample sales history, and seeded loans. Other workstreams are blocked until this exists, so ship a first version early.

**Hand your agent:** the root [README](../README.md), [`docs/02-architecture.md`](../docs/02-architecture.md), and this file.

## Principles

- **Everything is clearly fake.** Card names are real franchises for realism in a demo, but metadata says `demo: true`, and images are placeholders or generated art, never scans of real cards.
- **One command sets up everything.** A single script (for example `npm run seed`) creates the whole demo world from scratch, so anyone on the team can reset it.
- **Deterministic.** Use fixed seeds so the same cards and prices appear every time.
- **Published constants.** Write all addresses (program ID, test USDC mint, card mints, wallets) to one `devnet/addresses.json` file that every other workstream reads. Start from [`addresses.example.json`](addresses.example.json). Public keys are fine to commit; **never commit private keys**.

## What to create

| Item | Details |
| --- | --- |
| Test USDC mint | Same 6 decimals as real USDC. A mint authority held by a team key so anyone can get demo funds |
| Faucet script | Gives a wallet test USDC and devnet SOL (devnet SOL via the standard airdrop, with retries) |
| Demo card collection | 30 to 50 card NFTs across five tiers (see below), each a supply-1, zero-decimal token with metadata |
| Demo wallets | At least 4: two collectors holding cards, two lenders holding test USDC. Keys stored in a local file, never committed |
| Fake sales history | Several months of sales per card, matching each card's tier, written as a CSV and as JSON for workstream B |
| Seeded loans | A handful in each state: open offers, an active loan, a repaid loan, a defaulted loan, and a cancelled offer, for the marketplace and profile pages |
| Mock buyback account | An account that pays a fixed discount to market for a card, used by the optional `sell_to_buyback` instruction |

## Card metadata (stored on each token)

Fields: `name`, `set`, `number`, `year`, `grade_company`, `grade`, `cert_number` (fake, unique), `card_id`, `image`, `collection` (a collection key that marks the demo collection as "official"), `demo` (true).

The score service and backend treat a token as `verified` only if its collection key matches the demo collection. Also create **two fake lookalike tokens** outside the collection, so the demo can show the fake-token check rejecting them.

## Tier mix for the demo set

| Tier | Count | Description | Expected score range |
| --- | --- | --- | --- |
| Blue chip | 6 to 8 | High value, many recent tight-cluster sales | 800 to 1000 |
| Strong | 10 | Moderate value, regular sales | 600 to 799 |
| Moderate | 10 | Lower value, occasional sales | 400 to 599 |
| Thin | 6 to 10 | A few sales months apart, wide price scatter | 200 to 399 |
| Not eligible | 2 to 4 | One sale or none, or flagged for suspicious sales | 0 to 199 |

Include two cards with **injected wash trades** (same wallet on both sides, inflated prices), so workstream B can show it ignores them.

## Fake sales data format

One row per sale. Columns match the scoring handoff:

`card_id`, `grade_company`, `grade`, `sale_price_usd`, `sale_timestamp`, `sale_venue`, `sale_type`, `buyer_id_hash`, `seller_id_hash`, `listing_days`, `is_injected_wash` (true or false, for testing only).

Prices follow a heavy-tailed distribution: a few cards worth thousands, most under $200, grade multipliers (grade 10 much higher than grade 9), noise that is larger for thin cards, a slow drift, and one market-wide dip so the model can be stress-tested. Label the data "synthetic" in the file and in the data dictionary.

## Planned folders

```text
devnet/
  addresses.json         published constants (commit public keys only)
  scripts/               mint, faucet, seed, reset
  data/                  generated sales history (CSV and JSON)
  assets/                placeholder card art
```

## Tasks

1. Create the test USDC mint and the faucet script. Publish the mint address.
2. Create the demo wallets and fund them.
3. Mint the demo card collection with metadata and the two lookalike fakes.
4. Generate the sales history for B (do this early, even a rough version).
5. Once the program ID exists from workstream A, seed loans in each state using the real contract.
6. Write `addresses.json` and a README section with the reset command.
7. Build the demo reset: wipe and rebuild in under five minutes.

## Acceptance checks

- Running the seed command twice in a row ends in the same state.
- Each other workstream can read `addresses.json` and find every address it needs.
- The marketplace shows open offers, and profiles show repaid and defaulted history, from seeded data only.
- The lookalike tokens are not in the official collection and are rejected as unverified.

## Stretch

Generated placeholder card art, a one-click "give me demo funds" button in the frontend, and a scripted "market crash" that lowers prices across the dataset so the demo can show the score reacting.
