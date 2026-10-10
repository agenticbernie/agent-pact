import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  anchorDiscriminator,
  buildControlIx,
  buildExecutePaymentIx,
  buildInitializePolicyIx,
  findIntentRecordPda,
  findPolicyPda,
  intentId32,
  INTENT_SEED,
  parsePolicyAccount,
  POLICY_SEED,
  recipientAta,
  vaultAta,
} from "../src/services/solana/policyProgram";

const PROGRAM_ID = new PublicKey("6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY");
const MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const OWNER = new PublicKey("11111111111111111111111111111111");

describe("on-chain policy program parity (backend builder vs program)", () => {
  it("uses the documented PDA seeds", () => {
    expect(POLICY_SEED.toString()).toBe("pact-policy");
    expect(INTENT_SEED.toString()).toBe("pact-intent");
  });

  it("derives deterministic PDAs", () => {
    const p1 = findPolicyPda(OWNER, PROGRAM_ID);
    const p2 = findPolicyPda(OWNER, PROGRAM_ID);
    expect(p1.equals(p2)).toBe(true);
    const r1 = findIntentRecordPda(p1, intentId32("00".repeat(16)), PROGRAM_ID);
    const r2 = findIntentRecordPda(p1, intentId32("00".repeat(16)), PROGRAM_ID);
    expect(r1.equals(r2)).toBe(true);
    expect(r1.equals(p1)).toBe(false);
  });

  it("derives intent ids as sha256(nonce), 32 bytes", () => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const id = intentId32(nonce);
    expect(id.length).toBe(32);
    expect(id.equals(crypto.createHash("sha256").update(Buffer.from(nonce, "hex")).digest())).toBe(
      true
    );
  });

  it("derives the vault at the canonical ATA of the policy PDA (off-curve owner)", () => {
    const policy = findPolicyPda(OWNER, PROGRAM_ID);
    const vault = vaultAta(policy, MINT);
    // Throws without allowOwnerOffCurve for a PDA owner — must not throw here.
    expect(vault.toBase58().length).toBeGreaterThan(30);
    expect(recipientAta(OWNER, MINT).toBase58().length).toBeGreaterThan(30);
  });

  it("serializes execute_payment as discriminator + intent_id + u64 amount", () => {
    const policy = findPolicyPda(OWNER, PROGRAM_ID);
    const intentId = intentId32("ab".repeat(16));
    const ix = buildExecutePaymentIx(
      {
        programId: PROGRAM_ID,
        owner: OWNER,
        agent: OWNER,
        policy,
        vault: vaultAta(policy, MINT),
        recipient: OWNER,
        recipientAta: recipientAta(OWNER, MINT),
        mint: MINT,
        intentRecord: findIntentRecordPda(policy, intentId, PROGRAM_ID),
      },
      intentId,
      3_250_000n
    );
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(8 + 32 + 8);
    expect(ix.data.subarray(0, 8).equals(anchorDiscriminator("execute_payment"))).toBe(true);
    expect(ix.data.subarray(8, 40).equals(intentId)).toBe(true);
    expect(ix.data.readBigUInt64LE(40)).toBe(3_250_000n);
    // Account order per onchain/SPEC.md §2.7.
    const [o, a, p, v, r, ra, m, rec, tp, sp] = ix.keys;
    expect(o.pubkey.equals(OWNER) && o.isSigner && o.isWritable).toBe(true);
    expect(a.isSigner).toBe(false);
    expect(p.pubkey.equals(policy) && p.isWritable).toBe(true);
    expect(v.isWritable).toBe(true);
    expect(r.isSigner || r.isWritable).toBe(false);
    expect(ra.isWritable).toBe(true);
    expect(m.isSigner || m.isWritable).toBe(false);
    expect(rec.isWritable).toBe(true);
    expect(tp.pubkey.toBase58()).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(sp.pubkey.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("serializes initialize_policy as discriminator + Borsh args", () => {
    const policy = findPolicyPda(OWNER, PROGRAM_ID);
    const r1 = Keypair.generate().publicKey;
    const r2 = Keypair.generate().publicKey;
    const ix = buildInitializePolicyIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      agent: OWNER,
      mint: MINT,
      policy,
      maxPerPayment: 10_000_000n,
      windowLimit: 50_000_000n,
      windowSeconds: 86_400n,
      expiresAt: 0n,
      allowedRecipients: [r1, r2],
    });
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(8 + 32 + 8 + 8 + 8 + 8 + 4 + 64);
    expect(ix.data.subarray(0, 8).equals(anchorDiscriminator("initialize_policy"))).toBe(true);
    expect(new PublicKey(ix.data.subarray(8, 40)).equals(OWNER)).toBe(true);
    expect(ix.data.readBigUInt64LE(40)).toBe(10_000_000n);
    expect(ix.data.readBigUInt64LE(48)).toBe(50_000_000n);
    expect(ix.data.readBigUInt64LE(56)).toBe(86_400n);
    expect(ix.data.readBigInt64LE(64)).toBe(0n);
    expect(ix.data.readUInt32LE(72)).toBe(2);
    expect(new PublicKey(ix.data.subarray(76, 108)).equals(r1)).toBe(true);
    expect(new PublicKey(ix.data.subarray(108, 140)).equals(r2)).toBe(true);
    const [o, p, m, s] = ix.keys;
    expect(o.pubkey.equals(OWNER) && o.isSigner && o.isWritable).toBe(true);
    expect(p.pubkey.equals(policy) && !p.isSigner && p.isWritable).toBe(true);
    expect(m.pubkey.equals(MINT) && !m.isSigner && !m.isWritable).toBe(true);
    expect(s.pubkey.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("rejects oversized allowlists and non-positive limits client-side", () => {
    const policy = findPolicyPda(OWNER, PROGRAM_ID);
    const base = {
      programId: PROGRAM_ID,
      owner: OWNER,
      agent: OWNER,
      mint: MINT,
      policy,
      maxPerPayment: 10_000_000n,
      windowLimit: 50_000_000n,
      windowSeconds: 86_400n,
      expiresAt: 0n,
      allowedRecipients: [] as import("@solana/web3.js").PublicKey[],
    };
    expect(() => buildInitializePolicyIx({ ...base, maxPerPayment: 0n })).toThrow();
    expect(() =>
      buildInitializePolicyIx({
        ...base,
        allowedRecipients: Array.from({ length: 17 }, () => Keypair.generate().publicKey),
      })
    ).toThrow();
  });

  it("builds pause/unpause/revoke as discriminator-only instructions", () => {
    const policy = findPolicyPda(OWNER, PROGRAM_ID);
    for (const name of ["pause", "unpause", "revoke"] as const) {
      const ix = buildControlIx(name, PROGRAM_ID, OWNER, policy);
      expect(ix.data.equals(anchorDiscriminator(name))).toBe(true);
      const [o, p] = ix.keys;
      expect(o.pubkey.equals(OWNER) && o.isSigner && !o.isWritable).toBe(true);
      expect(p.pubkey.equals(policy) && p.isWritable).toBe(true);
    }
  });
  it("matches the generated program IDL discriminators", () => {
    const idlPath = path.resolve(__dirname, "../../onchain/target/idl/pact_policy.json");
    if (!fs.existsSync(idlPath)) {
      console.warn("skipping IDL parity: run `anchor build` in onchain/ first");
      return;
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as {
      instructions: { name: string; discriminator: number[] }[];
      address: string;
    };
    expect(idl.address).toBe(PROGRAM_ID.toBase58());
    for (const name of ["execute_payment", "initialize_policy", "pause", "revoke"]) {
      const ix = idl.instructions.find((i) => i.name === name);
      expect(ix).toBeDefined();
      expect(Buffer.from(ix!.discriminator).equals(anchorDiscriminator(name))).toBe(true);
    }
  });

  it("parses the on-chain PolicyAccount layout (agent, flags, expiry)", () => {
    const agent = Keypair.generate().publicKey;
    const r1 = Keypair.generate().publicKey;
    // discriminator(8) + owner/agent/mint(96) + 5xu64(40) + vec + expires(8) + paused + revoked + version(8) + bump
    const buf = Buffer.alloc(8 + 96 + 40 + 4 + 32 + 8 + 1 + 1 + 8 + 1);
    let o = 8 + 32; // skip discriminator + owner
    Buffer.from(agent.toBytes()).copy(buf, o);
    o += 32 + 32 + 40; // agent + mint + 5xu64
    buf.writeUInt32LE(1, o); // 1 recipient
    Buffer.from(r1.toBytes()).copy(buf, o + 4);
    o += 4 + 32;
    buf.writeBigInt64LE(1_800_000_000n, o); // expires_at
    buf[o + 8] = 1; // paused
    buf[o + 9] = 0; // revoked
    const parsed = parsePolicyAccount(buf);
    expect(parsed.agent.equals(agent)).toBe(true);
    expect(parsed.paused).toBe(true);
    expect(parsed.revoked).toBe(false);
    expect(parsed.expiresAt).toBe(1_800_000_000n);
  });
});
