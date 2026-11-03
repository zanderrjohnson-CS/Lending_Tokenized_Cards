// Drives the real UI in Chromium with a mock Wallet Standard wallet (signs with a local keypair),
// against the LiteSVM RPC shim. Takes screenshots along the way.
//   node scripts/ui-e2e.cjs http://localhost:3100 http://localhost:8899 <outDir>
const { chromium } = require("playwright");
const { Keypair, Transaction, Connection } = require("@solana/web3.js");
const nacl = require("tweetnacl");
const [BASE, RPC, OUT] = process.argv.slice(2);
const conn = new Connection(RPC, "confirmed");

async function walletPage(browser, kp, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  await page.exposeFunction("__signMessage", (b64) =>
    Buffer.from(nacl.sign.detached(Buffer.from(b64, "base64"), kp.secretKey)).toString("base64"));
  await page.exposeFunction("__signTx", (b64) => {
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    tx.partialSign(kp);
    return tx.serialize({ requireAllSignatures: false }).toString("base64");
  });
  await page.addInitScript(({ address, pk, name }) => {
    const b64 = (u8) => btoa(String.fromCharCode(...u8));
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const account = { address, publicKey: new Uint8Array(pk), chains: ["solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"] };
    const wallet = {
      version: "1.0.0", name, chains: ["solana:devnet"], accounts: [],
      icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#ab9ff2"/></svg>'),
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) =>
          Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: unb64(await window.__signMessage(b64(i.message))) }))) },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs) =>
          Promise.all(inputs.map(async (i) => ({ signedTransaction: unb64(await window.__signTx(b64(i.transaction))) }))) },
      },
    };
    const register = ({ register }) => register(wallet);
    window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  }, { address: kp.publicKey.toBase58(), pk: Array.from(kp.publicKey.toBytes()), name });
  return page;
}

const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

async function connectAndSignIn(page) {
  await page.getByRole("button", { name: /Select Wallet/i }).first().click();
  await page.locator(".wallet-adapter-modal-list button", { hasText: "Mock Wallet" }).click();
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

let b, l;
(async () => {
  const browser = await chromium.launch();
  const borrower = Keypair.generate(), lender = Keypair.generate();
  await conn.requestAirdrop(borrower.publicKey, 2e9);
  await conn.requestAirdrop(lender.publicKey, 20e9);

  b = await walletPage(browser, borrower, "Mock Wallet");
  await b.goto(BASE + "/");
  await b.waitForSelector(".sb-row");
  await shot(b, "01-landing");
  await connectAndSignIn(b);
  await b.getByText("I want to borrow").waitFor();
  await shot(b, "02-choose-role");
  await b.getByText("I want to borrow").click();
  await b.waitForURL("**/borrow");
  await b.getByRole("button", { name: "+ Tokenize a card" }).click();
  await b.locator(".pick", { hasText: "Charizard" }).first().click();
  await b.waitForTimeout(400);
  await shot(b, "03-tokenize");
  await b.getByRole("button", { name: "Issue card token" }).click();
  await b.locator(".tcard").first().waitFor({ timeout: 30000 });
  await b.waitForTimeout(800);
  await shot(b, "04-my-cards");
  await b.getByRole("button", { name: "Get a loan quote" }).click();
  await b.getByRole("button", { name: "5 min (demo)" }).click();
  await b.waitForTimeout(300);
  await shot(b, "05-quote");
  await b.getByRole("button", { name: "List loan and deposit card" }).click();
  await b.getByText("Your loan is now visible to lenders").waitFor({ timeout: 30000 });
  await shot(b, "06-listed-steps");
  await b.waitForTimeout(1500);
  await b.locator(".pill", { hasText: "Open for lenders" }).first().waitFor();
  await shot(b, "07-borrower-listed");

  l = await walletPage(browser, lender, "Mock Wallet");
  await l.goto(BASE + "/lend");
  await connectAndSignIn(l);
  await l.locator(".mcard").first().waitFor();
  await shot(l, "08-marketplace");
  await l.getByRole("button", { name: "Fund loan" }).first().click();
  await l.getByRole("button", { name: /^Fund .* SOL$/ }).click();
  await l.getByText("Loan starts; due date set").waitFor();
  await l.getByRole("button", { name: "Done" }).waitFor({ timeout: 30000 });
  await shot(l, "09-funded");
  await l.getByRole("button", { name: "Done" }).click();
  await l.locator(".loan .pill", { hasText: "Active" }).waitFor();
  await shot(l, "10-lender-active");

  await b.reload();
  await b.getByRole("button", { name: /^Repay / }).click();
  await b.locator(".pill", { hasText: "Repaid" }).first().waitFor({ timeout: 30000 });
  await shot(b, "11-repaid");
  await b.locator(".loan a").first().click();
  await b.getByText("Timeline").waitFor();
  await b.waitForTimeout(500);
  await b.screenshot({ path: `${OUT}/12-loan-detail.png`, fullPage: true });

  // a wallet with no devnet SOL gets a clear message instead of a wallet "failed to simulate" warning
  const broke = await walletPage(browser, Keypair.generate(), "Mock Wallet");
  await broke.goto(BASE + "/borrow");
  await connectAndSignIn(broke);
  await broke.getByRole("button", { name: "+ Tokenize a card" }).click();
  await broke.locator(".pick").first().click();
  await broke.getByRole("button", { name: "Issue card token" }).click();
  await broke.getByText(/no devnet SOL/).waitFor({ timeout: 15000 });
  await broke.screenshot({ path: `${OUT}/14-no-sol-message.png` });

  // phone layout
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + "/"); await m.waitForSelector(".sb-row");
  await m.screenshot({ path: `${OUT}/13-mobile.png`, fullPage: false });
  console.log("UI flow completed");
  await browser.close();
})().catch(async (e) => {
  console.error("UI E2E FAILED:", e.message);
  for (const [n, p] of [["b", b], ["l", l]]) if (p) await p.screenshot({ path: `${OUT}/fail-${n}.png` }).catch(() => {});
  process.exit(1);
});
