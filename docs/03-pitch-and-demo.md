# Workstream F: Pitch, demo script, and judging strategy

**Goal.** Turn the build into a story judges remember, and a demo that cannot fail on stage. This workstream starts on day one, because the pitch decides what the others must show.

**Hand your agent:** the whole repo, since the pitch touches every part.

## The story in one minute

1. **Problem.** Collectors hold thousands of dollars in graded cards, and tokenization made them tradable on-chain. But they cannot borrow against them, because nobody can price them for a lender. DeFi pools reject them.
2. **Solution.** A transparent credit score for collectibles. Enter a card, get a fair value, a confidence level, a recovery floor, and a safe loan limit, with reasons.
3. **Proof.** A working lending marketplace on Solana where the score sets the limit and an escrow contract enforces the loan.
4. **Market.** Lenders and protocols pay for the score. Offerbook accepts graded cards today but has no card pricing, and Collector Crypt and Courtyard hold the collateral and the sales data.
5. **Vision.** Today peer-to-peer card loans, tomorrow cards as standard DeFi collateral priced by our score, and then watches, sneakers, and comics.

## Pitch line

"We're the credit score for collectibles: one number that tells any lender how much they can safely lend against a graded card, and why."

## Demo script (target 3 minutes)

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Home page, paste a card's token address | "Anyone can check a card. No account needed." |
| 0:20 | Score page: value range, confidence, recovery floor, score gauge, explanation | "The score comes with reasons a lender can check, built from recent independent sales." |
| 0:50 | Paste a fake lookalike token | "Fakes are rejected before any score is given." |
| 1:10 | Collector wallet: collection view with borrowing power | "Here is what this collection can borrow against." |
| 1:30 | Lender creates an offer, the app warns when above the score's limit | "The score sets the guardrail, the lender decides." |
| 1:50 | Collector accepts, signs, funds arrive, card shows as locked | "One transaction: card in escrow, cash out. No one holds our keys." |
| 2:20 | Repay, card returns. Then show a seeded overdue loan and the lender claiming | "Repay and you keep the card. Miss the date and the lender takes it." |
| 2:45 | Fake-sales attack: show a pumped card's score barely moves | "We ignore linked wallets and thin evidence." |
| 3:00 | Roadmap slide | "Banks, insurers, and DeFi pools all need this number." |

## Demo safety plan

- Record a full backup video of the happy path before the live demo.
- Pre-fund wallets and keep the seed command ready to reset the world in minutes.
- Keep one fully scripted wallet path so no step depends on typing an address live. Copy addresses into a notes file.
- Test on the venue network. Have a phone hotspot ready, and a cached mock-mode fallback for the score service.
- Devnet can be slow or rate-limited. Use a paid RPC key if available, and keep a retry button on every action.

## Questions judges will ask, and answers

| Question | Answer |
| --- | --- |
| How is this different from Jupiter Offerbook? | Offerbook lets lenders judge each card themselves and has no pricing. We are the pricing and risk layer any lender can plug into, including Offerbook. |
| Where does the price data come from? | Independent sales across eBay, PSA records, and on-chain venues, with linked-wallet trades removed, and platform buyback prices as a floor. In the demo this is synthetic data and we say so. |
| What if someone fakes sales? | We drop sales with linked parties, down-weight thin single-venue evidence, lower confidence, and cap how fast value moves. We show the stress test. |
| Who pays? | Lenders and platforms pay for API access, plus a small fee per loan funded. Collectors use the app free. |
| Why would a bank use this? | Not first. We start with on-chain protocols and specialty lenders. Banks need a track record and explainable models, and we are built for both. |
| What if the vault or platform fails? | That is a real risk and we name it. The collateral depends on the platform's custody. Our score can include platform risk later. |
| Is it legal? | Consumer lending and digital collateral rules vary by region. The demo is devnet-only. Compliance is on the roadmap and we would partner with licensed lenders first. |
| What about defaults? | Fixed-term loans below the recovery floor mean a lender who claims the card gets back at least the loan in most cases. We backtest loss rates by score band. |

## Slide outline (6 to 8 slides)

1. Title and one-line pitch
2. The problem, with one striking number
3. The solution: the score, shown as a screenshot
4. How it works: card in, score out, loan on chain
5. Live demo or recorded fallback
6. Market and who pays
7. Honest risks and how we handle them
8. Roadmap and the ask

## Tasks

1. Write the one-minute story and the pitch line, and agree on the team's wording.
2. Draft the demo script and tell each workstream which screens must be flawless.
3. Build the slide deck.
4. Prepare the question-and-answer sheet and rehearse it.
5. Record the backup demo video once the happy path works.
6. Rehearse the full three minutes at least three times with a timer.

## Rules for what we claim

- Say clearly that the demo uses fake cards, synthetic data, and test money on devnet.
- Never claim real partnerships, real default rates, or real returns.
- State that this is not financial advice and compliance is future work.
- Quote market figures only with a source and date, and recheck them the day before presenting.
