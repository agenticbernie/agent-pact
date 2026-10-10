import crypto from "node:crypto";
import { PublicKey, Transaction } from "@solana/web3.js";
import { store, StoreError } from "../../db/store";
import { getConfig } from "../../config/env";
import { evaluatePolicy } from "../../lib/policy/engine";
import { parseUsdc, formatUsdc } from "../../lib/usdc/parse";
import { logEvent } from "../../lib/logger";
import type { PaymentIntent, PaymentStatus } from "../../types";
import {
  awaitConfirmation,
  buildUsdcTransfer,
  getUsdcBalance,
  submitSignedTransaction,
} from "../solana/usdc";
import { getConnection, usdcMint } from "../solana/connection";
import {
  anchorDiscriminator,
  buildExecutePaymentIx,
  fetchOnchainPolicy,
  findIntentRecordPda,
  findPolicyPda,
  intentId32,
  isPolicyProgramEnabled,
  policyProgramId,
  recipientAta,
  vaultAta,
  vaultBalanceBaseUnits,
} from "../solana/policyProgram";

export const INTENT_TTL_MS = 5 * 60 * 1000; // Payment intents expire after 5 minutes.

const EXPIRABLE: PaymentStatus[] = ["PROPOSED", "AWAITING_CONFIRMATION", "CONFIRMED"];

export class IntentError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
    this.name = "IntentError";
  }
}

export interface CreateIntentInput {
  payerWallet: string;
  recipientId: string;
  amount: string;
  memo?: string | null;
  aiSource?: { originalPrompt: string; confidence: number };
}

function expireIfNeeded(intent: PaymentIntent): PaymentIntent {
  if (!EXPIRABLE.includes(intent.status)) return intent;
  if (Date.now() > Date.parse(intent.expiresAt)) {
    const updated = store.updateIntent(intent.id, intent.status, "EXPIRED", {});
    logEvent("PAYMENT_INTENT_EXPIRED", { intentId: intent.id });
    return updated;
  }
  return intent;
}

export function getIntent(id: string): PaymentIntent {
  const intent = store.getIntent(id);
  if (!intent) throw new IntentError("INTENT_NOT_FOUND", "Payment intent not found.", 404);
  return expireIfNeeded(intent);
}

export function listIntents(payerWallet: string): PaymentIntent[] {
  return store.listIntents(payerWallet).map(expireIfNeeded);
}

/**
 * Create a payment intent and run the deterministic policy evaluation.
 * AI and manual payments enter the exact same pipeline — there is no
 * second execution path.
 */
export function createIntent(input: CreateIntentInput): PaymentIntent {
  const recipient = store
    .listRecipients(input.payerWallet)
    .find((r) => r.id === input.recipientId);
  if (!recipient) {
    throw new IntentError("RECIPIENT_NOT_FOUND", "Recipient not found. Save the recipient first.", 404);
  }

  let amountBase: bigint;
  try {
    amountBase = parseUsdc(input.amount);
  } catch {
    throw new IntentError("INVALID_AMOUNT", "Invalid USDC amount. Use up to 6 decimal places, greater than zero.");
  }

  const policy = store.getPolicy(input.payerWallet);
  const policyResult = evaluatePolicy({
    policy,
    token: "USDC",
    amountBaseUnits: amountBase,
    recipientWallet: recipient.walletAddress,
    settledTodayBaseUnits: store.settleTodayTotal(input.payerWallet),
  });

  const now = new Date().toISOString();
  const intent: PaymentIntent = {
    id: crypto.randomUUID(),
    nonce: crypto.randomBytes(16).toString("hex"),
    payerWallet: input.payerWallet,
    recipientId: recipient.id,
    recipientName: recipient.name,
    recipientWallet: recipient.walletAddress,
    amountBaseUnits: amountBase.toString(),
    amountDisplay: formatUsdc(amountBase),
    token: "USDC",
    memo: input.memo?.trim() ? input.memo.trim() : null,
    status: policyResult.allowed ? "AWAITING_CONFIRMATION" : "REJECTED",
    aiSource: input.aiSource
      ? { ...input.aiSource, model: getConfig().llm.model }
      : null,
    policyResult,
    transactionSignature: null,
    failureReason: null,
    createdAt: now,
    confirmedAt: null,
    settledAt: null,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
  };

  store.createIntent(intent);
  logEvent("PAYMENT_INTENT_CREATED", {
    intentId: intent.id,
    payer: intent.payerWallet,
    amountBaseUnits: intent.amountBaseUnits,
  });
  logEvent(policyResult.allowed ? "PAYMENT_POLICY_ALLOWED" : "PAYMENT_POLICY_REJECTED", {
    intentId: intent.id,
    reasonCode: policyResult.reasonCode,
  });
  return intent;
}

/** Idempotent: confirming an already-confirmed intent is a no-op. */
export function confirmIntent(id: string): PaymentIntent {
  const intent = getIntent(id);
  if (intent.status === "CONFIRMED") return intent;
  if (intent.status !== "AWAITING_CONFIRMATION") {
    throw new IntentError(
      `INVALID_STATE_${intent.status}`,
      `Cannot confirm a payment in status ${intent.status}.`,
      409
    );
  }
  const updated = store.updateIntent(id, "AWAITING_CONFIRMATION", "CONFIRMED", {
    confirmedAt: new Date().toISOString(),
  });
  logEvent("PAYMENT_CONFIRMED", { intentId: id });
  return updated;
}

export function cancelIntent(id: string): PaymentIntent {
  const intent = getIntent(id);
  if (intent.status !== "AWAITING_CONFIRMATION" && intent.status !== "CONFIRMED") {
    throw new IntentError(
      `INVALID_STATE_${intent.status}`,
      `Cannot cancel a payment in status ${intent.status}.`,
      409
    );
  }
  const updated = store.updateIntent(id, intent.status, "CANCELLED", {});
  logEvent("PAYMENT_CANCELLED", { intentId: id });
  return updated;
}

/** Build the unsigned USDC transfer for a CONFIRMED intent (after balance check). */
export async function buildIntentTransaction(id: string) {
  const intent = getIntent(id);
  if (intent.status !== "CONFIRMED") {
    throw new IntentError(
      `INVALID_STATE_${intent.status}`,
      `Cannot build a transaction for a payment in status ${intent.status}.`,
      409
    );
  }
  if (isPolicyProgramEnabled()) {
    return buildPolicyProgramTransaction(intent);
  }
  const balance = await getUsdcBalance(intent.payerWallet);
  if (!balance.hasTokenAccount || BigInt(balance.baseUnits) < BigInt(intent.amountBaseUnits)) {
    throw new IntentError(
      "INSUFFICIENT_BALANCE",
      "Insufficient USDC balance for this payment.",
      402
    );
  }
  return buildUsdcTransfer(intent.payerWallet, intent.recipientWallet, BigInt(intent.amountBaseUnits));
}

/**
 * Vault-custody path: build the `execute_payment` instruction for the
 * on-chain policy program. The backend derives every address and reads the
 * on-chain agent identity, but enforcement happens in the program — a
 * malicious response here cannot move funds outside policy (the wallet shows
 * the user exactly what they sign, and the program re-validates everything).
 */
async function buildPolicyProgramTransaction(intent: PaymentIntent) {
  const programId = policyProgramId();
  if (!programId) throw new IntentError("PROGRAM_NOT_CONFIGURED", "On-chain policy program is not configured.", 500);
  const owner = new PublicKey(intent.payerWallet);
  const mint = usdcMint();
  const policy = findPolicyPda(owner, programId);

  const onchain = await fetchOnchainPolicy(policy);
  if (!onchain) {
    throw new IntentError(
      "PROGRAM_POLICY_NOT_FOUND",
      "No on-chain spending policy exists for this wallet. Initialize the policy and fund the vault first.",
      404
    );
  }
  if (onchain.revoked) {
    throw new IntentError("PROGRAM_POLICY_REVOKED", "The on-chain spending policy has been revoked.", 409);
  }
  if (onchain.paused) {
    throw new IntentError("PROGRAM_POLICY_PAUSED", "The on-chain spending policy is paused.", 409);
  }

  const vault = vaultAta(policy, mint);
  const balance = await vaultBalanceBaseUnits(vault);
  if (balance === null || balance < BigInt(intent.amountBaseUnits)) {
    throw new IntentError(
      "INSUFFICIENT_BALANCE",
      "Insufficient USDC in the policy vault for this payment. Deposit first.",
      402
    );
  }

  const recipient = new PublicKey(intent.recipientWallet);
  const destination = recipientAta(recipient, mint);
  const intentId = intentId32(intent.nonce);
  const record = findIntentRecordPda(policy, intentId, programId);
  const ix = buildExecutePaymentIx(
    {
      programId,
      owner,
      agent: onchain.agent,
      policy,
      vault,
      recipient,
      recipientAta: destination,
      mint,
      intentRecord: record,
    },
    intentId,
    BigInt(intent.amountBaseUnits)
  );

  const conn = getConnection();
  const destInfo = await conn.getAccountInfo(destination);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transactionBase64: serialized.toString("base64"),
    createsRecipientAta: destInfo === null,
    policyProgram: {
      programId: programId.toBase58(),
      policy: policy.toBase58(),
      vault: vault.toBase58(),
      intentRecord: record.toBase58(),
      intentIdHex: intentId.toString("hex"),
    },
  };
}

/**
 * Defense-in-depth check on the wallet-signed transaction when the program
 * path is enabled: the submitted transaction must contain the expected
 * `execute_payment` instruction (program id, discriminator, intent id,
 * amount, owner as first account). The program itself is authoritative;
 * this catches backend bugs and tampered responses early.
 */
function verifyPolicyProgramTransaction(intent: PaymentIntent, tx: Transaction): void {
  const programId = policyProgramId();
  if (!programId) return;
  const intentId = intentId32(intent.nonce);
  const expectedDisc = anchorDiscriminator("execute_payment");
  const found = tx.instructions.some((ix) => {
    if (!ix.programId.equals(programId)) return false;
    if (ix.data.length !== 8 + 32 + 8) return false;
    if (!ix.data.subarray(0, 8).equals(expectedDisc)) return false;
    if (!ix.data.subarray(8, 40).equals(intentId)) return false;
    if (ix.data.readBigUInt64LE(40) !== BigInt(intent.amountBaseUnits)) return false;
    if (ix.keys.length < 1) return false;
    return ix.keys[0].pubkey.toBase58() === intent.payerWallet;
  });
  if (!found) {
    throw new IntentError(
      "INVALID_TRANSACTION",
      "The signed transaction does not contain the expected policy-program payment.",
      400
    );
  }
}

/**
 * Execute a wallet-signed transaction for a CONFIRMED intent.
 *
 * Idempotent (spec §29): calling this multiple times never creates multiple
 * payments. If the intent is already EXECUTING/SETTLED its chain status is
 * checked instead of resubmitting. The CONFIRMED -> EXECUTING transition acts
 * as an exactly-once lock before anything is broadcast.
 */
export async function executeIntent(id: string, signedTransactionBase64: string): Promise<PaymentIntent> {
  let intent = getIntent(id);

  if (intent.status === "EXECUTING") {
    // Crashed/retried mid-flight: check the chain rather than resubmitting.
    if (intent.transactionSignature) {
      const status = await awaitConfirmation(intent.transactionSignature, 5_000);
      if (status === "confirmed") {
        intent = store.updateIntent(id, "EXECUTING", "SETTLED", {
          settledAt: new Date().toISOString(),
        });
        logEvent("TRANSACTION_SETTLED", { intentId: id, signature: intent.transactionSignature });
      }
    }
    return store.getIntent(id) as PaymentIntent;
  }
  if (intent.status === "SETTLED") {
    return intent; // already settled — never resubmit
  }
  if (intent.status !== "CONFIRMED") {
    throw new IntentError(
      `INVALID_STATE_${intent.status}`,
      `Cannot execute a payment in status ${intent.status}.`,
      409
    );
  }

  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(signedTransactionBase64, "base64"));
  } catch {
    throw new IntentError("INVALID_TRANSACTION", "The signed transaction could not be read.", 400);
  }
  if (!tx.feePayer || tx.feePayer.toBase58() !== intent.payerWallet) {
    throw new IntentError(
      "PAYER_MISMATCH",
      "The signed transaction payer does not match the payment intent.",
      400
    );
  }
  verifyPolicyProgramTransaction(intent, tx);

  // Exactly-once lock: CONFIRMED -> EXECUTING before submitting anything.
  store.updateIntent(id, "CONFIRMED", "EXECUTING", {});

  try {
    const signature = await submitSignedTransaction(signedTransactionBase64);
    logEvent("TRANSACTION_SUBMITTED", { intentId: id, signature });
    store.patchIntent(id, { transactionSignature: signature });

    const result = await awaitConfirmation(signature);
    if (result === "confirmed") {
      const updated = store.updateIntent(id, "EXECUTING", "SETTLED", {
        settledAt: new Date().toISOString(),
      });
      logEvent("TRANSACTION_SETTLED", { intentId: id, signature });
      return updated;
    }
    const reason =
      result === "failed"
        ? "The Solana transaction failed on chain."
        : "Timed out waiting for Solana confirmation.";
    const updated = store.updateIntent(id, "EXECUTING", "FAILED", { failureReason: reason });
    logEvent("TRANSACTION_FAILED", { intentId: id, signature, reason: result });
    return updated;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Transaction submission failed.";
    const updated = store.updateIntent(id, "EXECUTING", "FAILED", { failureReason: reason });
    logEvent("TRANSACTION_FAILED", { intentId: id, reason: "SUBMIT_ERROR", detail: reason });
    return updated;
  }
}

export { StoreError };
