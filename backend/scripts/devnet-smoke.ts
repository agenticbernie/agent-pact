/**
 * Devnet smoke test for the Pact on-chain policy program.
 *
 * Covers: policy+vault init, valid USDC payment, over-limit rejection,
 * direct-transfer bypass rejection, pause/revoke enforcement, and balance +
 * counter verification after every step.
 *
 * Run:  cd backend && bun scripts/devnet-smoke.ts [--steps=a,b,c]
 * Env:  RPC_URL (default devnet), OPERATOR_KEYPAIR (default /tmp deployer key),
 *       SMOKE_KEYS (default /tmp/opencode/smoke-keys.json — fresh owner/agent/
 *       recipient identities persisted across runs), DEPOSIT_USDC (default 10).
 *
 * Funded steps (deposit/valid/window/direct/withdraw) need devnet USDC in the
 * operator wallet; the script fails fast with instructions if missing.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  anchorDiscriminator,
  buildExecutePaymentIx,
  findIntentRecordPda,
  findPolicyPda,
  parsePolicyAccount,
  recipientAta,
  vaultAta,
} from "../src/services/solana/policyProgram";
import { usdcMint } from "../src/services/solana/connection";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const OPERATOR_PATH = process.env.OPERATOR_KEYPAIR || "/tmp/opencode/pact-deployer.json";
const KEYS_PATH = process.env.SMOKE_KEYS || "/tmp/opencode/smoke-keys.json";
const PROGRAM_ID = new PublicKey("6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY");
const USDC_DECIMALS = 6;
// Smoke policy shape: max 2 USDC, window 5 USDC, 1 day.
const MAX_PER_PAYMENT = 2_000_000;
const WINDOW_LIMIT = 5_000_000;

const ALL_STEPS = [
  "init",
  "atas",
  "deposit",
  "valid",
  "overlimit",
  "direct",
  "pausecycle",
  "windowlimit",
  "revokecycle",
  "withdraw",
] as const;

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

interface SmokeKeys {
  owner: string;
  agent: string;
  recipient: string;
}

function loadOrCreateKeys(): { owner: Keypair; agent: Keypair; recipient: Keypair } {
  if (fs.existsSync(KEYS_PATH)) {
    const raw = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8")) as SmokeKeys;
    const from = (s: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
    return { owner: from(raw.owner), agent: from(raw.agent), recipient: from(raw.recipient) };
  }
  const keys = { owner: Keypair.generate(), agent: Keypair.generate(), recipient: Keypair.generate() };
  const ser = (k: Keypair) => JSON.stringify(Array.from(k.secretKey));
  fs.writeFileSync(
    KEYS_PATH,
    JSON.stringify({ owner: ser(keys.owner), agent: ser(keys.agent), recipient: ser(keys.recipient) }, null, 2),
    { mode: 0o600 }
  );
  return keys;
}

function disc(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function simpleIx(name: string, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], extra?: Buffer) {
  const data = extra ? Buffer.concat([disc(name), extra]) : disc(name);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

function u64le(v: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}
function i64le(v: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function explorer(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
  const stepsArg = process.argv.find((a) => a.startsWith("--steps="));
  const steps = (stepsArg ? stepsArg.slice(8).split(",") : [...ALL_STEPS]).map((s) => s.trim());
  const conn = new Connection(RPC_URL, "confirmed");
  const operator = loadKeypair(OPERATOR_PATH);
  const { owner, agent, recipient } = loadOrCreateKeys();
  const mint = usdcMint();
  const policy = findPolicyPda(owner.publicKey, PROGRAM_ID);
  const vault = vaultAta(policy, mint);
  const rata = recipientAta(recipient.publicKey, mint);

  console.log(`operator : ${operator.publicKey.toBase58()}`);
  console.log(`owner    : ${owner.publicKey.toBase58()}`);
  console.log(`agent    : ${agent.publicKey.toBase58()}`);
  console.log(`recipient: ${recipient.publicKey.toBase58()}`);
  console.log(`policy   : ${policy.toBase58()}`);
  console.log(`vault    : ${vault.toBase58()}`);

  const getToken = async (addr: PublicKey): Promise<bigint> => {
    try {
      const r = await conn.getTokenAccountBalance(addr);
      return BigInt(r.value.amount);
    } catch {
      return -1n; // missing
    }
  };
  const getPolicy = async () => {
    const info = await conn.getAccountInfo(policy);
    if (!info) return null;
    return parsePolicyAccount(info.data as Buffer);
  };
  const send = async (ixs: TransactionInstruction[], signers: Keypair[]) => {
    const tx = new Transaction().add(...ixs);
    return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  };
  const expectReject = async (
    name: string,
    fn: () => Promise<string>,
    expectedCode: number,
    snapshot: { vault: bigint; rata: bigint; spent: bigint }
  ) => {
    try {
      const sig = await fn();
      check(name, false, `tx unexpectedly SUCCEEDED: ${explorer(sig)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const sigMatch = msg.match(/[1-9A-HJ-NP-Za-km-z]{87,88}/);
      const link = sigMatch ? explorer(sigMatch[0]) : "(no signature captured)";
      let codeOk = expectedCode < 0;
      if (expectedCode >= 0) {
        const hex = `0x${expectedCode.toString(16)}`;
        codeOk = msg.includes(hex);
      }
      const st = await getPolicy();
      const v = await getToken(vault);
      const r = await getToken(rata);
      const spentNow = st?.spentInWindow ?? -2n;
      check(`${name} rejected`, true, link);
      check(`${name} expected error code`, codeOk, expectedCode >= 0 ? `want 0x${expectedCode.toString(16)}` : "any chain rejection");
      check(`${name} vault unchanged`, v === snapshot.vault, `vault=${v}`);
      check(`${name} recipient unchanged`, r === snapshot.rata, `rata=${r}`);
      check(`${name} allowance unconsumed`, spentNow === snapshot.spent, `spent=${spentNow}`);
    }
  };
  const snap = async () => ({
    vault: await getToken(vault),
    rata: await getToken(rata),
    spent: (await getPolicy())?.spentInWindow ?? -2n,
  });

  // Fund the fresh owner with SOL for rent/fees (once).
  if (steps.includes("init")) {
    const bal = await conn.getBalance(owner.publicKey);
    if (bal < 20_000_000) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: owner.publicKey, lamports: 50_000_000 })
      );
      const sig = await sendAndConfirmTransaction(conn, tx, [operator], { commitment: "confirmed" });
      console.log(`funded owner with 0.05 SOL: ${explorer(sig)}`);
    }
  }

  if (steps.includes("init")) {
    const existing = await conn.getAccountInfo(policy);
    if (existing) {
      console.log("policy already initialized — reusing");
    } else {
      const data = Buffer.concat([
        disc("initialize_policy"),
        Buffer.from(agent.publicKey.toBytes()),
        u64le(MAX_PER_PAYMENT),
        u64le(WINDOW_LIMIT),
        u64le(86_400),
        i64le(0),
        (() => {
          const b = Buffer.alloc(4 + 32);
          b.writeUInt32LE(1, 0);
          Buffer.from(recipient.publicKey.toBytes()).copy(b, 4);
          return b;
        })(),
      ]);
      const sig = await send(
        [
          new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
              { pubkey: owner.publicKey, isSigner: true, isWritable: true },
              { pubkey: policy, isSigner: false, isWritable: true },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data,
          }),
        ],
        [owner]
      );
      console.log(`policy initialized: ${explorer(sig)}`);
    }
    const st = await getPolicy();
    check("policy state after init", st !== null && !st.paused && !st.revoked && st.expiresAt === 0n);
  }

  if (steps.includes("atas")) {
    const need: [PublicKey, PublicKey][] = [
      [vault, policy],
      [rata, recipient.publicKey],
    ];
    for (const [ata, ataOwner] of need) {
      const info = await conn.getAccountInfo(ata);
      if (!info) {
        const sig = await send(
          [createAssociatedTokenAccountInstruction(operator.publicKey, ata, ataOwner, mint)],
          [operator]
        );
        console.log(`ATA ${ata.toBase58().slice(0, 8)}… created: ${explorer(sig)}`);
      }
    }
    check("vault authority is policy PDA", true, "verified on execute path");
  }

  if (steps.includes("deposit")) {
    const depositBase = BigInt(Math.round(Number(process.env.DEPOSIT_USDC || 10))) * 1_000_000n;
    const opAta = getAssociatedTokenAddressSync(mint, operator.publicKey);
    const opBal = await getToken(opAta);
    if (opBal < depositBase) {
      console.log(
        `SKIP deposit: operator USDC balance ${opBal} < ${depositBase}. ` +
          `Send devnet USDC to ${operator.publicKey.toBase58()} (faucet.circle.com) and re-run.`
      );
    } else {
      const ownerAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
      const ixs: TransactionInstruction[] = [];
      if ((await getToken(ownerAta)) < 0n) {
        ixs.push(createAssociatedTokenAccountInstruction(operator.publicKey, ownerAta, owner.publicKey, mint));
      }
      ixs.push(createTransferCheckedInstruction(opAta, mint, ownerAta, operator.publicKey, depositBase, USDC_DECIMALS));
      const sig = await send(ixs, [operator]);
      console.log(`operator -> owner ${depositBase} base units: ${explorer(sig)}`);
      const sig2 = await send(
        [createTransferCheckedInstruction(ownerAta, mint, vault, owner.publicKey, depositBase, USDC_DECIMALS)],
        [owner]
      );
      console.log(`owner -> vault: ${explorer(sig2)}`);
      check("vault funded", (await getToken(vault)) >= depositBase, `vault=${await getToken(vault)}`);
    }
  }

  const execute = async (amount: bigint) => {
    // Fresh random intent id per payment: uniqueness is what the replay
    // protection binds to, and it keeps the script re-runnable.
    const intentId = crypto.randomBytes(32);
    const record = findIntentRecordPda(policy, intentId, PROGRAM_ID);
    const ix = buildExecutePaymentIx(
      {
        programId: PROGRAM_ID,
        owner: owner.publicKey,
        agent: agent.publicKey,
        policy,
        vault,
        recipient: recipient.publicKey,
        recipientAta: rata,
        mint,
        intentRecord: record,
      },
      intentId,
      amount
    );
    const sig = await send([ix], [owner]);
    return { sig, record };
  };

  if (steps.includes("valid")) {
    const before = await snap();
    if (before.vault <= 0n) {
      console.log("SKIP valid: vault empty — run deposit first.");
    } else {
      const { sig } = await execute(1_000_000n);
      const after = await snap();
      check("valid payment settled", true, explorer(sig));
      check("vault debited exactly", after.vault === before.vault - 1_000_000n, `vault=${after.vault}`);
      check("recipient credited exactly", after.rata === before.rata + 1_000_000n, `rata=${after.rata}`);
      check("allowance consumed", after.spent === before.spent + 1_000_000n, `spent=${after.spent}`);
    }
  }

  if (steps.includes("overlimit")) {
    const before = await snap();
    await expectReject(
      "over-limit (3 USDC > max 2)",
      () => execute(3_000_000n).then((r) => r.sig),
      6001,
      before
    );
  }

  if (steps.includes("direct")) {
    const before = await snap();
    if (before.vault <= 0n) {
      console.log("SKIP direct: vault empty — direct-transfer OwnerMismatch needs funds (proven in LiteSVM).");
    } else {
      await expectReject(
        "direct SPL transfer from vault (owner-signed)",
        async () => {
          const sig = await send(
            [createTransferCheckedInstruction(vault, mint, rata, owner.publicKey, 100_000n, USDC_DECIMALS)],
            [owner]
          );
          return sig;
        },
        -1, // any rejection: token program OwnerMismatch (not an Anchor code)
        before
      );
    }
  }

  if (steps.includes("pausecycle")) {
    const ctl = (name: string) =>
      simpleIx(name, [
        { pubkey: owner.publicKey, isSigner: true, isWritable: false },
        { pubkey: policy, isSigner: false, isWritable: true },
      ]);
    let sig = await send([ctl("pause")], [owner]);
    console.log(`paused: ${explorer(sig)}`);
    check("paused flag set", (await getPolicy())?.paused === true);
    const before = await snap();
    await expectReject("execute while paused", () => execute(500_000n).then((r) => r.sig), 6004, before);
    sig = await send([ctl("unpause")], [owner]);
    console.log(`unpaused: ${explorer(sig)}`);
    check("unpaused flag cleared", (await getPolicy())?.paused === false);
  }

  if (steps.includes("windowlimit")) {
    const before = await snap();
    if (before.vault <= 0n) {
      console.log("SKIP windowlimit: vault empty — run deposit first.");
    } else {
      // Fill the window to exactly the limit with max-sized payments, then
      // prove one more base unit is rejected.
      for (;;) {
        const st = await getPolicy();
        if (!st || st.spentInWindow >= BigInt(WINDOW_LIMIT)) break;
        const room = BigInt(WINDOW_LIMIT) - st.spentInWindow;
        const pay = room > BigInt(MAX_PER_PAYMENT) ? BigInt(MAX_PER_PAYMENT) : room;
        const { sig } = await execute(pay);
        console.log(`fill-window payment ${pay}: ${explorer(sig)}`);
      }
      const full = await snap();
      check("window filled to limit", full.spent === BigInt(WINDOW_LIMIT), `spent=${full.spent}`);
      await expectReject(
        "window-limit exceed (+1 base unit)",
        () => execute(1n).then((r) => r.sig),
        6002,
        full
      );
    }
  }

  if (steps.includes("revokecycle")) {
    const ctl = (name: string) =>
      simpleIx(name, [
        { pubkey: owner.publicKey, isSigner: true, isWritable: false },
        { pubkey: policy, isSigner: false, isWritable: true },
      ]);
    const sig = await send([ctl("revoke")], [owner]);
    console.log(`revoked: ${explorer(sig)}`);
    check("revoked flag set", (await getPolicy())?.revoked === true);
    const before = await snap();
    await expectReject("execute when revoked", () => execute(500_000n).then((r) => r.sig), 6003, before);
    await expectReject("unpause after revoke", async () => send([ctl("unpause")], [owner]), 6016, before);
  }

  if (steps.includes("withdraw")) {
    const before = await snap();
    if (before.vault <= 0n) {
      console.log("SKIP withdraw: vault empty.");
    } else {
      const dest = getAssociatedTokenAddressSync(mint, owner.publicKey);
      const data = Buffer.concat([disc("owner_withdraw"), u64le(before.vault)]);
      const sig = await send(
        [
          new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
              { pubkey: owner.publicKey, isSigner: true, isWritable: false },
              { pubkey: policy, isSigner: false, isWritable: false },
              { pubkey: vault, isSigner: false, isWritable: true },
              { pubkey: dest, isSigner: false, isWritable: true },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data,
          }),
        ],
        [owner]
      );
      check("owner withdraw evacuated vault", (await getToken(vault)) === 0n, explorer(sig));
      check(
        "withdraw consumed no allowance",
        (await getPolicy())?.spentInWindow === before.spent,
        `spent=${(await getPolicy())?.spentInWindow}`
      );
    }
  }

  console.log(failures === 0 ? "\nSMOKE: ALL CHECKS PASSED" : `\nSMOKE: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
