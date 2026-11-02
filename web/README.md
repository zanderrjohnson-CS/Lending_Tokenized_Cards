# HoloLend: borrow against tokenized Pokémon cards (Solana devnet demo)

Next.js 14 app. Sign in with a Solana wallet, choose borrower or lender, pledge a card token, get
loan terms, and let an escrow hold the card token until the loan is repaid or defaults.

## Loan model: price and safety are separate

- **Suggested price** (shown to both sides): what the card should sell for now. Recent sales count most, adjusted
  for the overall market trend. A card that sold for $5 three months ago and $15 last week, in a rising market, is
  priced close to $15.
- **Loan size** comes from the price: borrow up to **90% of the suggested price**, for every card. No tiers, no
  minimum-trading cutoff.
- **Safety score** (0 to 100, trading frequency weighted heavily) sets **only the interest rate**. The question it
  answers: if the borrower defaults, can the lender sell the card quickly for at least the loan amount? Card trades
  often at a steady price → high score → low rate. Valuable but rarely traded → still a big loan, but a high rate to
  cover the lender's default risk. Stand-in curve until the model supplies `apr_pct`: APR = 8% + 0.012 × (100 − score)²,
  so 90 → 9.2%, 75 → 15.5%, 50 → 38%, 25 → 75.5%.
- Example: suggested price $15, score 88 → borrow up to $13.50 at 9.7%.

**Live now:** `data/web_cards.json` from the ML model (`drawdown-gbm-v0.2`, 500 cards incl. our 10 starters; copy of
`../output/ml/web_cards.json`). Its APRs run from about 25% for the safest cards to 200% for the riskiest, and the
risk part is meant to be charged as an upfront fee (see ML_MODEL.md); the site shows the all-in APR as simple interest.
Search in "Tokenize a card" reaches every card in the file. To refresh, copy the newer file over it.

Fallback if that file is missing: the stand-in suggested price is built by `scripts/build-prices.ts` from the
PriceCharting sales in `data/` (recency-weighted median, 14-day half-life, plus half the market-wide 30-day trend).
The stand-in score is the factor composite from `compute_factors.py`. Both get replaced by the ML model's output as soon as
`data/web_cards.json` exists (see "Plugging in the ML model").

```bash
npm install          # .npmrc sets legacy-peer-deps (wallet-adapter pulls in react-native peers otherwise)
cp .env.example .env.local
npm run dev          # http://localhost:3000
```
Put Phantom (or Solflare/Backpack) on **devnet**: Phantom → Settings → Developer Settings → Testnet Mode → Solana Devnet.
Get devnet SOL from the "+ airdrop" button in the top bar or https://faucet.solana.com. To demo both sides,
use two wallet accounts (or two browsers): one borrows, one lends.

## UX flow

1. **Sign in.** Connect a wallet (Wallet Standard: Phantom, Solflare, Backpack are detected automatically), then sign a
   one-time message. No transaction, no fee. The server checks the ed25519 signature and sets an HttpOnly session cookie.
2. **Choose a side.** "I want to borrow" or "I want to lend". Switchable any time from the top nav.
3. **Borrower**
   - *Tokenize a card*: pick the card and grade (Raw or PSA 10 + cert number). The vault issues a 1-of-1 token to your wallet
     (supply 1, decimals 0, mint authority burned in the same transaction).
   - *Get a loan quote*: suggested price and how it was worked out, the safety score and its breakdown, then "borrow up
     to" (90% of price) and the APR from the score. Slide the amount, pick a term from 7 to 90 days (plus a 5-minute demo
     term so a default can be shown live).
   - *List loan and deposit card*: one wallet approval moves the token into escrow; the loan appears to lenders.
   - *Repay*: one transaction pays the lender principal + interest **and** returns the token. *Cancel* any time before funding.
4. **Lender**
   - *Marketplace*: each loan shows the suggested price, how much of it is being lent, score and APR. Filter by
     card/set, min APR, min score, max term; sort by safest, highest APR, largest, shortest.
   - *Fund loan*: SOL goes straight to the borrower; the due date starts.
   - *Claim collateral*: after the due date, if unpaid, the escrow releases the card token to the lender.
5. **Loan page** (`/loans/[id]`): terms, score at listing, parties, and a timeline with an Explorer link for every transaction.

## Escrow: which one we chose

**Demo-grade custodial escrow, not an on-chain program.** A platform `ESCROW` keypair owns the token account that holds
pledged card tokens. It only co-signs transactions the server builds, and the server only builds a release when the
loan's state allows it:

| Release | Who signs | Allowed when |
|---|---|---|
| Repay | borrower + escrow | loan active. Payment to lender and token back to borrower are in **one atomic tx** |
| Claim | lender + escrow | loan active and past `dueAt` |
| Cancel | borrower + escrow | loan listed and no lender is mid-funding |

Before any status change the server reads the chain (escrow token balance, the funding transfer in the tx, who holds the
token now). It never takes the browser's word. Signatures can't be replayed, and funding/cancel take a 2-minute lock so a
lender's SOL can't land on a loan that's being cancelled.

Why not an Anchor program for the hackathon: it needs the Solana/Anchor toolchain and a devnet deploy, and it moves the
state machine into Rust. The custodial version shows the same UX and the same atomic repay. **What it gives up:** users must
trust the platform's escrow key (a stolen key could move pledged tokens) and the server's clock for defaults. The upgrade
path is an Anchor program with a PDA vault per loan, where `repay` and `claim` are program instructions and the due date
is checked against the on-chain `Clock`. The API routes and UI wouldn't change shape.

## What the chain does not protect (raise with judges/users)

The blockchain secures the **token**, not the **card**:
- **Authenticity**: a token is only as good as the check on the physical card. Fakes and resealed slabs are real. PSA cert
  lookup (see `../src/fetch_psa.py`) helps for slabs; raw cards need in-hand grading.
- **Custody**: the vault holding the card needs insurance, audits and proof-of-reserve. If the vault loses or swaps the card, the token is worthless.
- **Redemption**: a lender who claims a defaulted token needs a way to get the physical card shipped, with fees and KYC.
- **Price oracle**: card values come from off-chain sold listings. They can lag, be thin, or be wash-traded to inflate a
  card before borrowing against it. Recency weighting makes this easier to game, so the 10% haircut and the score's liquidity/spread factors matter; they reduce this but don't remove it.
- Also: SOL price risk (loans are in SOL, collateral is priced in USD; a stablecoin like USDC would fix this), and in the
  demo there's no liquidation before the due date if the card's price drops.

## Code map

| Path | What |
|---|---|
| `lib/score/provider.ts` | **`ScoreProvider` interface**: returns score, suggested price (+ how it was worked out), and optional model APR / max loan / default probability |
| `lib/score/mlFileProvider.ts` | Reads the ML output file `data/web_cards.json` (or `ML_CARDS_FILE`). Used automatically when the file exists |
| `lib/score/factorsProvider.ts` | Stand-in: `data/factors.json` score + `data/prices.json` suggested price |
| `lib/score/httpProvider.ts` | Set `SCORE_API_URL` to use an ML service instead (`GET /catalog`, `GET /score?card=&grade=`) |
| `lib/terms.ts` | **`TermsPolicy`** `price-based-v2`: max loan = 90% of suggested price (or the model's `max_loan_usd`); APR from score (or the model's `apr_pct`); terms 7 to 90 days; minimum interest 1% |
| `scripts/build-prices.ts` | Builds the stand-in `data/prices.json` |
| `lib/server/txbuild.ts` | All transaction builders (mint, deposit, fund, repay, claim, cancel) |
| `lib/server/chain.ts` | On-chain checks the server runs before each status change |
| `lib/server/session.ts` | Sign-in-with-Solana message, signature check, session cookie |
| `lib/server/db.ts` | JSON-file store in `.data/` (swap for Postgres before anything real) |
| `app/api/...` | `auth/*`, `catalog`, `cards`, `loans`, `loans/[id]` (`{action, phase: "build" | "confirm"}`) |
| `app/{page,borrow,lend,loans/[id]}` | Pages |

## Plugging in the ML model

Copy the model's `output/ml/web_cards.json` to `web/data/web_cards.json` (or set `ML_CARDS_FILE` to its path). The site picks it
up on the next request. Format (sample in `scripts/fixtures/web_cards.sample.json`):

```json
{ "asof": "2026-11-02", "model": "ml-v2", "cards": [ {
  "card_key": "base-charizard", "name": "Charizard", "set": "Base Set (Unlimited)", "number": "4/102", "image_url": "...",
  "score": 41.0, "factors": { "liquidity": 30, "stability": 55 },
  "suggested_price_usd": 350.0, "suggested_price_psa10_usd": 20000,
  "price_basis": { "n_sales": 12, "half_life_days": 21, "last_sale_usd": 362, "last_sale_date": "2026-10-30", "market_adj_pct": 1.5 },
  "max_loan_usd": 315.0, "apr_pct": 48.0, "default_prob_90d": 0.12 } ] }
```
Only `card_key`, `name`, `set`, `score` and `suggested_price_usd` are required. Missing `max_loan_usd` → 90% of price;
missing `apr_pct` → the stand-in curve above.

## Tests

The cloud sandbox this was built in can't reach devnet, so everything was tested against
[LiteSVM](https://github.com/LiteSVM/litesvm), a real Solana runtime that runs in-process:

- `npm run test:escrow`: the real tx builders. Mint is 1-of-1, deposit, fund, atomic repay, underfunded repay leaves
  collateral in escrow, default claim, cancel, forged release without the escrow key fails. (10 checks)
- `scripts/rpc-shim.ts` + `scripts/e2e-api.ts`: a small JSON-RPC server over LiteSVM, and the full API flow through it in
  `repay`, `default` and `cancel` modes, including auth and permission checks, borrowing over 90% of price rejected, replayed signatures and
  the funding lock. (46 checks)
- `scripts/ui-e2e.cjs`: Playwright drives the real UI with a mock Wallet Standard wallet against the shim: connect, sign
  in, pick role, tokenize, quote, list, fund from a second wallet, repay, loan page.

To run the API/UI tests: `npx tsx scripts/rpc-shim.ts 8899`, then build and start the app with
`NEXT_PUBLIC_RPC_URL=http://localhost:8899 RPC_URL_SERVER=http://localhost:8899`, then
`npx tsx scripts/e2e-api.ts http://localhost:3000 http://localhost:8899 repay` (set `DATA_DIR` for the `default` mode).

Not yet tested against live devnet with a real Phantom wallet. Expect to check that first.
