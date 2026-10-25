# Workstream A: Loan escrow smart contract

**Goal.** A Solana program (Anchor, Rust) that holds a card NFT and USDC in escrow and enforces fixed-term loans with no one able to override the rules, including us. Runs on devnet.

**Hand your agent:** the root [README](../README.md), [`docs/02-architecture.md`](../docs/02-architecture.md), and this file.

## Design rules

- Fixed-term loans. No price-based liquidation. The score decides how much to lend before the offer exists; the contract never reads a price.
- Interest is a flat amount over the whole term: `interest = principal x interest_bps / 10000`. No compounding.
- Assets sit in program-owned vaults (PDAs). No admin key can move them.
- One offer funds one card (`token_mint`). Optionally an offer is restricted to one borrower wallet.
- Amounts are USDC base units (6 decimals). Use checked math and 128-bit intermediates so nothing overflows.

## Accounts

### Loan (PDA, seeds `["loan", loan_id]`)

| Field | Type | Meaning |
| --- | --- | --- |
| `loan_id` | u64 | Unique ID chosen by the lender's client |
| `lender` | Pubkey | Funds the loan |
| `borrower` | Option<Pubkey> | Restricts who can accept; set on accept if empty |
| `token_mint` | Pubkey | The card NFT mint |
| `usdc_mint` | Pubkey | Loan currency mint |
| `principal_usdc` | u64 | Amount lent |
| `interest_bps` | u16 | Flat interest over the whole term |
| `term_seconds` | i64 | Loan length |
| `offer_expires_at` | i64 | Offer can no longer be accepted after this |
| `started_at` | i64 | Set on accept |
| `due_at` | i64 | `started_at + term_seconds` |
| `status` | enum | `Open`, `Active`, `Repaid`, `Defaulted`, `Cancelled` |
| `bump` | u8 | PDA bump |

### Vaults

- **USDC vault** (token account, PDA seeds `["usdc_vault", loan_id]`) holds the lender's principal while the offer is open.
- **NFT vault** (token account, PDA seeds `["nft_vault", loan_id]`) holds the card while the loan is active.

## Instructions

| Instruction | Signer | What it does | Fails if |
| --- | --- | --- | --- |
| `create_offer` | lender | Creates Loan, moves `principal_usdc` from lender to the USDC vault, status `Open` | principal is 0, term is 0, expiry is in the past, interest above a sanity cap (for example 5000 bps) |
| `cancel_offer` | lender | Returns USDC to lender, status `Cancelled` | status is not `Open` |
| `accept_offer` | borrower | In ONE transaction: moves the NFT from borrower to the NFT vault, moves principal from the USDC vault to the borrower, sets `started_at` and `due_at`, status `Active` | status is not `Open`, offer expired, wrong borrower when restricted, borrower does not hold the NFT |
| `repay` | borrower | Moves principal + interest from borrower to lender, returns NFT from the vault to the borrower, status `Repaid` | status is not `Active`, signer is not the borrower |
| `claim_default` | lender | Moves the NFT from the vault to the lender, status `Defaulted` | status is not `Active`, current time is not past `due_at` |
| `sell_to_buyback` (optional) | lender | After default, sells the NFT to a mock buyback account at a fixed price and pays the lender in USDC | status is not `Defaulted` or buyback is not configured |

## Decisions to confirm

These defaults are proposed. Change them in the group before building.

1. **Late repayment.** The borrower may still repay after `due_at` until the lender calls `claim_default`. This is borrower-friendly and simple. The alternative is a hard deadline.
2. **Protocol fee.** A config value `fee_bps` (default 0) taken from the interest at repay and sent to a treasury account. Set it to 100 (1%) to demo the business model.
3. **NFT standard.** The demo uses plain SPL token NFTs (decimals 0, supply 1) with Metaplex metadata, or Metaplex Core if the team prefers. Real Collector Crypt and Courtyard tokens may use a different standard, so list "confirm real token standard" as future work.
4. **Who is the borrower on an open offer.** Default is any holder of the card can accept. Use the `borrower` field to restrict it when a collector asked for a specific loan.

## Events to emit

The backend indexes these. Each event carries `loan_id`, `lender`, `borrower`, `token_mint`, and the relevant amounts and times.

`OfferCreated`, `OfferCancelled`, `LoanStarted`, `LoanRepaid`, `LoanDefaulted`, `BuybackSold`.

## Security checklist

- Check every signer and every account owner. Verify the vault PDAs by seeds.
- Verify `usdc_mint` matches the Loan, and that the NFT mint has supply 1 and zero decimals.
- Use checked arithmetic. Reject interest above the sanity cap.
- Close vaults and the Loan account when finished so rent returns to the right party.
- State transitions only move forward: `Open` to `Active` to `Repaid` or `Defaulted`, or `Open` to `Cancelled`. No state can be re-entered.
- Several open offers can exist for one card. Once one is accepted the card is in escrow, so the others cannot be accepted. Make sure this fails cleanly.

## Tasks

1. Scaffold the Anchor workspace and define the Loan account and status enum.
2. Implement `create_offer` and `cancel_offer`, with tests.
3. Implement `accept_offer` as a single atomic transaction, with tests.
4. Implement `repay` and `claim_default`, with tests.
5. Add events and generate the IDL (the interface file) for the frontend and backend.
6. Optional: `sell_to_buyback` against a mock buyback account.
7. Deploy to devnet and publish the program ID to workstreams C, D, and E (write it to `devnet/addresses.json`).

## Tests that must pass

- Happy path: offer, accept, repay. Balances end correct, card back with the borrower.
- Default path: offer, accept, wait past `due_at`, claim. Card ends with the lender.
- Cancel before accept returns all USDC.
- Accept after `offer_expires_at` fails.
- Accept by the wrong wallet fails when restricted.
- Repay by someone who is not the borrower fails.
- Claim before `due_at` fails.
- Double-accept and double-repay fail.
- Interest math is exact for several principal and bps combinations, including large values.

## Deliverables

- Program source, tests, and IDL.
- Devnet program ID and a short README section with instruction examples.
- A script that runs the full happy path and default path from the command line, used for the demo.

## Out of scope for the hackathon

On-chain price reads, partial repayment, loan extensions, refinancing, auctions of defaulted cards, and multi-card collateral.
