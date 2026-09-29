import crypto from "node:crypto";
import { Transaction } from "@solana/web3.js";
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
