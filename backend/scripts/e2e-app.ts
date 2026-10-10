/**
 * App-level end-to-end test: boots an isolated backend server and drives the
 * whole product flow — recipients, policy, intents lifecycle, on-chain
 * onboarding (real devnet policy init), program-path build-transaction, and
 * the execute verification gates.
 *
 * Run:  cd backend && bun scripts/e2e-app.ts
 * Env:  RPC_URL (default devnet), OPERATOR_KEYPAIR (funds the e2e payer with
 *       SOL for the on-chain init step), PACT_POLICY_PROGRAM_ID optional.
 *
 * Uses a fresh payer + isolated DATA_DIR every run, so it is repeatable.
 * The on-chain init performs one real devnet transaction (~0.01 SOL).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const OPERATOR_PATH = process.env.OPERATOR_KEYPAIR || "/tmp/opencode/pact-deployer.json";
const PROGRAM_ID = process.env.PACT_POLICY_PROGRAM_ID || "6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY";
const PORT = Number(process.env.E2E_PORT || 4130);
const DATA_DIR = process.env.E2E_DATA_DIR || "/tmp/opencode/e2e-data";
const BASE = `http://localhost:${PORT}/api`;

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function waitForHealth(proc: ChildProcess) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* booting */
    }
    if (proc.exitCode !== null) throw new Error(`server exited early with ${proc.exitCode}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("server did not become healthy in time");
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const server = spawn("bun", ["src/server.ts"], {
    cwd: new URL(".", import.meta.url).pathname.replace(/\/scripts\/?$/, ""),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      RPC_URL,
      PACT_POLICY_PROGRAM_ID: PROGRAM_ID,
    },
    stdio: "ignore",
  });
  try {
    await waitForHealth(server);

    // 1. Health + settings expose the program id.
    let r = await req("GET", "/health");
    check("health ok", r.status === 200 && (r.json as { ok: boolean }).ok === true);
    r = await req("GET", "/settings");
    check(
      "settings exposes program id",
      r.status === 200 && (r.json as { policyProgramId: string }).policyProgramId === PROGRAM_ID
    );

    // 2. AI parse endpoint responds (fallback shape without a key is fine).
    r = await req("POST", "/ai/parse-payment", { message: "Pay Felix 3 USDC for coffee" });
    const ai = r.json as Record<string, unknown>;
    check(
      "ai parse responds",
      (r.status === 200 && ai.ok === true) || (r.status === 503 && "fallback" in ai),
      `status=${r.status}`
    );

    // 3. Recipients CRUD with a unique name (repeatable runs). Keep the payer
    // secret: it signs the on-chain init transaction later.
    const payerKp = Keypair.generate();
    const payer = payerKp.publicKey.toBase58();
    const dest = Keypair.generate().publicKey.toBase58();
    const name = `e2e-${Date.now().toString(36)}`;
    r = await req("POST", "/recipients", { ownerWallet: payer, name, walletAddress: dest });
    check("recipient created", r.status === 201);
    const recipientId = (r.json as { recipient: { id: string } }).recipient?.id ?? "";
    check("recipient id returned", recipientId.length > 0);
    r = await req("POST", "/recipients", { ownerWallet: payer, name, walletAddress: dest });
    check("duplicate recipient rejected", r.status === 409);
    r = await req("GET", `/recipients?owner=${payer}`);
    check(
      "recipient listed",
      r.status === 200 && ((r.json as { recipients: unknown[] }).recipients ?? []).length === 1
    );

    // 4. Policy get/update round-trip.
    r = await req("GET", `/policy?owner=${payer}`);
    check("default policy", r.status === 200);
    r = await req("PUT", "/policy", {
      ownerWallet: payer,
      maxPaymentAmount: "10",
      dailyLimit: "50",
      allowedRecipients: [dest],
      requireConfirmation: true,
    });
    check(
      "policy updated",
      r.status === 200 &&
        (r.json as { policy: { maxPaymentAmount: string } }).policy?.maxPaymentAmount === "10"
    );

    // 5. Intent lifecycle: unknown recipient, over-limit reject, valid create.
    r = await req("POST", "/payment-intents", { payerWallet: payer, recipientId: "nope", amount: "1" });
    check("unknown recipient 404", r.status === 404);
    r = await req("POST", "/payment-intents", { payerWallet: payer, recipientId, amount: "999" });
    check(
      "over-limit intent rejected",
      r.status === 201 && (r.json as { intent: { status: string } }).intent?.status === "REJECTED"
    );
    r = await req("POST", "/payment-intents", { payerWallet: payer, recipientId, amount: "1" });
    const intent = r.json as { intent: { id: string; status: string } };
    const intentId = intent?.intent?.id ?? "";
    check("valid intent awaiting confirmation", r.status === 201 && intent?.intent?.status === "AWAITING_CONFIRMATION");

    // 6. Confirm (idempotent) then build: no on-chain policy yet for a fresh wallet.
    r = await req("POST", `/payment-intents/${intentId}/confirm`);
    check("intent confirmed", r.status === 200);
    r = await req("POST", `/payment-intents/${intentId}/confirm`);
    check("confirm idempotent", r.status === 200);
    r = await req("POST", `/payment-intents/${intentId}/build-transaction`);
    check(
      "program path requires on-chain policy",
      r.status === 404 && (r.json as { error: string }).error === "PROGRAM_POLICY_NOT_FOUND"
    );

    // 7. On-chain onboarding end-to-end: fund payer, init policy, submit, verify.
    const operator = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(OPERATOR_PATH, "utf8")))
    );
    const conn = new Connection(RPC_URL, "confirmed");
    {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: operator.publicKey,
          toPubkey: payerKp.publicKey,
          lamports: 50_000_000,
        })
      );
      await sendAndConfirmTransaction(conn, tx, [operator], { commitment: "confirmed" });
    }
    r = await req("GET", `/policy/onchain?owner=${payer}`);
    check(
      "onchain status uninitialized",
      r.status === 200 && (r.json as { initialized: boolean }).initialized === false
    );
    r = await req("POST", "/policy/onchain/initialize", {
      ownerWallet: payer,
      agent: payer,
      maxPaymentAmount: "10",
      dailyLimit: "50",
      allowedRecipients: [dest],
    });
    const initTx = (r.json as { transactionBase64: string }).transactionBase64 ?? "";
    check("init tx built", r.status === 201 && initTx.length > 100);
    {
      const tx = Transaction.from(Buffer.from(initTx, "base64"));
      tx.partialSign(payerKp);
      const signedB64 = Buffer.from(tx.serialize()).toString("base64");
      const s = await req("POST", "/policy/onchain/submit", { signedTransactionBase64: signedB64 });
      check(
        "init tx submitted + confirmed",
        s.status === 200 && (s.json as { confirmed: boolean }).confirmed === true,
        JSON.stringify(s.json).slice(0, 120)
      );
    }
    r = await req("GET", `/policy/onchain?owner=${payer}`);
    check(
      "onchain status initialized",
      r.status === 200 && (r.json as { initialized: boolean }).initialized === true
    );

    // 8. Vault is unfunded, so the program path must refuse with an explicit
    // vault-balance error (the funded build + settle path is proven by the
    // devnet smoke test with real USDC).
    r = await req("POST", `/payment-intents/${intentId}/build-transaction`);
    check(
      "unfunded vault refused with vault error",
      r.status === 402 && (r.json as { error: string }).error === "INSUFFICIENT_BALANCE",
      JSON.stringify(r.json).slice(0, 140)
    );

    // 9. Execute gates: wrong signer and garbage are rejected; intent survives.
    {
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const wrong = Keypair.generate();
      const tx = new Transaction({ feePayer: wrong.publicKey, recentBlockhash: blockhash });
      tx.partialSign(wrong);
      const s = await req("POST", `/payment-intents/${intentId}/execute`, {
        signedTransactionBase64: Buffer.from(tx.serialize()).toString("base64"),
      });
      check(
        "wrong-signer execute rejected",
        s.status === 400 && (s.json as { error: string }).error === "PAYER_MISMATCH"
      );
    }
    {
      const s = await req("POST", `/payment-intents/${intentId}/execute`, {
        signedTransactionBase64: Buffer.from("not-a-transaction").toString("base64"),
      });
      check(
        "garbage execute rejected",
        s.status === 400 && (s.json as { error: string }).error === "INVALID_TRANSACTION"
      );
    }
    r = await req("GET", `/payment-intents/${intentId}`);
    check(
      "intent still confirmed after rejections",
      (r.json as { intent: { status: string } }).intent?.status === "CONFIRMED"
    );

    // 10. Cancel closes the lifecycle; onchain submit validates input.
    r = await req("POST", `/payment-intents/${intentId}/cancel`);
    check("intent cancelled", r.status === 200);
    r = await req("POST", `/payment-intents/${intentId}/build-transaction`);
    check("build after cancel rejected", r.status === 409);
    r = await req("POST", "/policy/onchain/submit", { signedTransactionBase64: "" });
    check("submit validates input", r.status === 400);

    console.log(failures === 0 ? "\nE2E: ALL CHECKS PASSED" : `\nE2E: ${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error("E2E ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
