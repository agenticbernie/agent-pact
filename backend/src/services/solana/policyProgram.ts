import crypto from "node:crypto";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConfig } from "../../config/env";
import { getConnection, usdcMint } from "./connection";
import { awaitConfirmation, submitSignedTransaction } from "./usdc";

/**
 * Pact on-chain policy program integration (vault custody model).
 *
 * When `PACT_POLICY_PROGRAM_ID` is configured, payments settle through the
 * `pact-policy` program instead of a direct SPL transfer:
 *
 *   vault ATA (authority = policy PDA) --execute_payment--> recipient ATA
 *
 * The program independently validates owner signature, agent identity,
 * per-payment max, window limit, allowlist, mint, expiry and replay — the
 * backend only *builds* the transaction; it is never trusted for enforcement.
 * See `onchain/SPEC.md` and `onchain/THREAT_MODEL.md`.
 *
 * When unconfigured, the legacy direct-SPL path is used (self-custody,
 * off-chain policy only).
 */

export const POLICY_SEED = Buffer.from("pact-policy");
export const INTENT_SEED = Buffer.from("pact-intent");

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
export function anchorDiscriminator(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

export function policyProgramId(): PublicKey | null {
  const id = getConfig().policyProgramId;
  if (!id) return null;
  return new PublicKey(id);
}

export function isPolicyProgramEnabled(): boolean {
  return policyProgramId() !== null;
}

export function findPolicyPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([POLICY_SEED, owner.toBuffer()], programId)[0];
}

/**
 * 32-byte on-chain intent id, derived deterministically from the backend
 * intent nonce (16 random bytes, hex). No schema migration needed and every
 * payment maps to a unique intent-record PDA.
 */
export function intentId32(nonceHex: string): Buffer {
  return crypto.createHash("sha256").update(Buffer.from(nonceHex, "hex")).digest();
}

export function findIntentRecordPda(
  policy: PublicKey,
  intentId: Buffer,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [INTENT_SEED, policy.toBuffer(), intentId],
    programId
  )[0];
}

/** Vault ATA: canonical ATA of the policy PDA (off-curve owner). */
export function vaultAta(policy: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, policy, true);
}

export function recipientAta(recipient: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, recipient);
}

export interface ExecutePaymentAccounts {
  programId: PublicKey;
  owner: PublicKey;
  /** Must equal the on-chain policy's `agent` (read from the policy account). */
  agent: PublicKey;
  policy: PublicKey;
  vault: PublicKey;
  recipient: PublicKey;
  recipientAta: PublicKey;
  mint: PublicKey;
  intentRecord: PublicKey;
}

/** Account metas in IDL order for `execute_payment`. */
export function buildExecutePaymentIx(
  accounts: ExecutePaymentAccounts,
  intentId: Buffer,
  amountBaseUnits: bigint
): TransactionInstruction {
  if (intentId.length !== 32) throw new Error("intentId must be 32 bytes");
  const data = Buffer.alloc(8 + 32 + 8);
  anchorDiscriminator("execute_payment").copy(data, 0);
  intentId.copy(data, 8);
  data.writeBigUInt64LE(amountBaseUnits, 40);
  return new TransactionInstruction({
    programId: accounts.programId,
    keys: [
      { pubkey: accounts.owner, isSigner: true, isWritable: true },
      { pubkey: accounts.agent, isSigner: false, isWritable: false },
      { pubkey: accounts.policy, isSigner: false, isWritable: true },
      { pubkey: accounts.vault, isSigner: false, isWritable: true },
      { pubkey: accounts.recipient, isSigner: false, isWritable: false },
      { pubkey: accounts.recipientAta, isSigner: false, isWritable: true },
      { pubkey: accounts.mint, isSigner: false, isWritable: false },
      { pubkey: accounts.intentRecord, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface OnchainPolicyState {
  agent: PublicKey;
  paused: boolean;
  revoked: boolean;
  expiresAt: bigint;
  maxPerPayment: bigint;
  windowLimit: bigint;
  spentInWindow: bigint;
}

/**
 * Minimal parse of the on-chain PolicyAccount (Anchor header + borsh):
 * owner(32) agent(32) mint(32) max(8) window(8) windowSecs(8) windowStart(8)
 * spent(8) vec(recipients) expiresAt(8) paused(1) revoked(1) version(8) bump(1).
 * Used for fail-fast UX errors only — the program re-validates everything.
 */
export function parsePolicyAccount(data: Buffer): OnchainPolicyState {
  if (data.length < 8 + 32 * 3 + 8 * 5) throw new Error("policy account too short");
  let o = 8;
  o += 32; // owner
  const agent = new PublicKey(data.subarray(o, o + 32));
  o += 32; // agent
  o += 32; // mint
  const maxPerPayment = data.readBigUInt64LE(o);
  const windowLimit = data.readBigUInt64LE(o + 8);
  o += 8 * 3; // max, window, windowSecs
  o += 8; // windowStart
  const spentInWindow = data.readBigUInt64LE(o);
  o += 8; // spent
  const recipientCount = data.readUInt32LE(o);
  o += 4 + recipientCount * 32;
  const expiresAt = data.readBigInt64LE(o);
  const paused = data[o + 8] === 1;
  const revoked = data[o + 9] === 1;
  return { agent, paused, revoked, expiresAt, maxPerPayment, windowLimit, spentInWindow };
}

export async function fetchOnchainPolicy(policy: PublicKey): Promise<OnchainPolicyState | null> {
  const info = await getConnection().getAccountInfo(policy);
  if (!info || info.data.length === 0) return null;
  return parsePolicyAccount(info.data as Buffer);
}

export async function vaultBalanceBaseUnits(vault: PublicKey): Promise<bigint | null> {
  try {
    const res = await getConnection().getTokenAccountBalance(vault);
    if (!res?.value?.amount) return null;
    return BigInt(res.value.amount);
  } catch {
    return null; // account missing or unparsable
  }
}

/** Vault + policy addresses for a payer (used by the deposit UX / API). */
export function vaultInfoForOwner(ownerWallet: string): {
  programId: string;
  policy: string;
  vault: string;
  mint: string;
} | null {
  const programId = policyProgramId();
  if (!programId) return null;
  const owner = new PublicKey(ownerWallet);
  const mint = usdcMint();
  const policy = findPolicyPda(owner, programId);
  return {
    programId: programId.toBase58(),
    policy: policy.toBase58(),
    vault: vaultAta(policy, mint).toBase58(),
    mint: mint.toBase58(),
  };
}

const U64_MAX = (1n << 64n) - 1n;

function assertU64(value: bigint, field: string): void {
  if (value <= 0n || value > U64_MAX) {
    throw new Error(`${field} must be > 0 and fit in u64`);
  }
}

export interface InitPolicyParams {
  programId: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  policy: PublicKey;
  maxPerPayment: bigint;
  windowLimit: bigint;
  /** Seconds; the program defaults 0 to one day, but the API always sends explicit. */
  windowSeconds: bigint;
  /** Unix seconds; 0 = never expires. */
  expiresAt: bigint;
  allowedRecipients: PublicKey[];
}

/** Instruction data + metas in IDL order for `initialize_policy`. */
export function buildInitializePolicyIx(params: InitPolicyParams): TransactionInstruction {
  assertU64(params.maxPerPayment, "maxPerPayment");
  assertU64(params.windowLimit, "windowLimit");
  assertU64(params.windowSeconds, "windowSeconds");
  if (params.expiresAt < 0n || params.expiresAt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expiresAt must be 0 or a unix timestamp in seconds");
  }
  if (params.allowedRecipients.length > 16) {
    throw new Error("at most 16 allowlisted recipients fit in a policy account");
  }
  const head = Buffer.alloc(8 + 32 + 8 + 8 + 8 + 8 + 4);
  anchorDiscriminator("initialize_policy").copy(head, 0);
  Buffer.from(params.agent.toBytes()).copy(head, 8);
  head.writeBigUInt64LE(params.maxPerPayment, 40);
  head.writeBigUInt64LE(params.windowLimit, 48);
  head.writeBigUInt64LE(params.windowSeconds, 56);
  head.writeBigInt64LE(params.expiresAt, 64);
  head.writeUInt32LE(params.allowedRecipients.length, 72);
  const tail = Buffer.concat(params.allowedRecipients.map((r) => Buffer.from(r.toBytes())));
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.policy, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([head, tail]),
  });
}

/** No-argument control instructions (`pause` / `unpause` / `revoke`). */
export function buildControlIx(
  name: "pause" | "unpause" | "revoke",
  programId: PublicKey,
  owner: PublicKey,
  policy: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: true },
    ],
    data: anchorDiscriminator(name),
  });
}

/** Assemble an unsigned legacy transaction (wallet signs; backend never holds keys). */
export async function buildUnsignedTransaction(
  feePayer: PublicKey,
  instructions: TransactionInstruction[]
): Promise<string> {
  const tx = new Transaction();
  tx.add(...instructions);
  const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/**
 * Submit a wallet-signed policy transaction (init / pause / revoke / …).
 * Returns the signature and whether the network confirmed it.
 */
export async function submitSignedPolicyTransaction(
  signedTransactionBase64: string
): Promise<{ signature: string; confirmed: boolean }> {
  const signature = await submitSignedTransaction(signedTransactionBase64);
  const result = await awaitConfirmation(signature);
  return { signature, confirmed: result === "confirmed" };
}
