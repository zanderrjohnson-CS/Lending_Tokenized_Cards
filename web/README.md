# Workstream C: Frontend web app

**Goal.** A clear, trustworthy web app where a collector sees what their cards are worth and how much they can borrow, and a lender browses loan requests with the score on each one. It must look finished in a two-minute demo.

**Hand your agent:** the root [README](../README.md), [`docs/02-architecture.md`](../docs/02-architecture.md) (shared names and APIs), and this file.

## Principles

- **The wallet is the login.** No username and password. Connect a Solana wallet (Phantom, Solflare) and the address is the account.
- **The score is the hero.** Every card and every listing shows its loan score, its tier, and one line of plain-English reasoning.
- **Say what is happening.** Every transaction shows a plain description before the user signs ("You will lock this card and receive 500 USDC. Repay 525 USDC by Nov 24.").
- **Demo-safe.** A visible banner says "Devnet demo, no real money, not financial advice."
- **Build against mock mode first.** Use the score service's mock responses and a stubbed loan list so you are never blocked by other workstreams.

## Pages

| Page | Who uses it | Contents |
| --- | --- | --- |
| Home | Everyone | One-line pitch, "Check a card" box (paste a token address), link to marketplace, wallet connect |
| Score page `/card/{token_mint}` | Everyone | Card image and details, fair value with range, confidence, liquidity, recovery floor, loan score gauge, recommended terms, explanation list, "Borrow against this card" button |
| My collection `/me` | Collectors | Grid of the wallet's cards with value and borrowing power each, total collection value, total borrowing power |
| Marketplace `/market` | Lenders and collectors | List of open offers: card, loan score, amount, term, interest, expiry. Filters by score tier, amount, term. Sort by interest or score |
| Create offer `/lend` | Lenders | Pick a card or request, enter amount, term, interest. Shows the score's suggested limit and warns when the offer is above it |
| Loan detail `/loan/{id}` | Borrower and lender | State, countdown to due date, amounts, actions available to the viewer: accept, repay, claim, cancel |
| Profile `/u/{wallet}` | Everyone | Username, avatar, loans repaid, defaulted, total volume |
| Notifications | Signed-in users | Due-date reminders, offer accepted, loan repaid |

## Key components

- **Score gauge:** a 0 to 1000 meter with tier colors and the number large.
- **Evidence panel:** the `explanation` strings as a short list, plus the value range as a bar showing low, fair, and high.
- **Card tile:** image, name, grade badge, value, score chip.
- **Loan terms summary:** amount, interest in dollars and as a percent, term, due date, total to repay.
- **Transaction modal:** plain-language summary, wallet signing step, success and error states.
- **Countdown:** time to due date, turns red under 24 hours.

## Flows to build and polish

1. **Check a card.** Paste a token address, see the score page with no wallet needed.
2. **Borrow.** Connect wallet, open a card, see the maximum loan, browse open offers on it or request one, accept an offer, sign, see funds arrive.
3. **Lend.** Connect wallet, browse the marketplace or a request, create an offer sized within the score's suggestion, sign, see the offer listed.
4. **Repay.** Open the loan, press repay, sign, see the card returned.
5. **Default.** Lender opens an overdue loan, presses claim, signs, sees the card in their wallet.

## Data and integration

- Score and cards: backend REST API from [`docs/02-architecture.md`](../docs/02-architecture.md).
- Loan actions: call the contract through the generated IDL (from workstream A) with the Anchor TypeScript client.
- Reading wallet cards: use token accounts filtered to the demo collection (the mint list in `devnet/addresses.json`, from workstream E).
- Amounts: convert between dollars and USDC base units in one helper, tested. `$500 = 500000000` base units.

## Empty, loading, and error states

Show a skeleton while the score loads. Show a clear message when a token is not verified ("This token is not from a supported collection"), when confidence is too low to lend, and when a wallet has no cards. Show the transaction error in plain words.

## Tasks

1. Scaffold the app with wallet connect and a layout containing the demo banner.
2. Build the score page against mock data.
3. Build the card tile, score gauge, and evidence panel as reusable components.
4. Build My collection and Marketplace with stubbed data.
5. Wire the backend API as it becomes available.
6. Wire the contract: create offer, accept, repay, claim.
7. Build Profile and Notifications.
8. Polish: loading states, errors, mobile layout, copy.

## Acceptance checks

- A new visitor can paste a token and see a full score page in under five seconds on the demo data.
- All five flows complete end to end on devnet.
- No page shows raw base units or addresses without a short label.
- Works at phone width.
- The demo banner appears on every page.

## Stretch

Email or Google sign-in through an embedded wallet service, a lender "auto-offer" that proposes terms from the score, a portfolio view that scores a whole collection together, and push or email reminders.
