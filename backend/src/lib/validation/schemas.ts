import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { isUsdcAmountString } from "../usdc/parse";

/** Strict base58 Solana wallet address. */
export const base58Address = z
  .string()
  .min(32)
  .max(44)
  .refine((v) => isSolanaAddress(v), { message: "Invalid Solana wallet address" });

function isSolanaAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export const usdcAmountString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Amount must be a decimal string with at most 6 decimal places (e.g. 3.25)");

/**
 * Strict schema for LLM output. strictObject: unknown keys (e.g. a wallet
 * address invented by the model) fail validation entirely — AI output is
 * always untrusted input.
 */
export const ParsedPaymentIntentSchema = z.strictObject({
  action: z.enum(["PAYMENT", "UNKNOWN"]),
  recipientInput: z.string().min(1).max(100).nullable(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).nullable(),
  token: z.literal("USDC").nullable(),
  memo: z.string().max(140).nullable(),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.enum(["recipient", "amount", "token"])),
});

export const ParsePaymentRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(500),
});

export const CreateRecipientSchema = z.strictObject({
  ownerWallet: base58Address,
  name: z.string().trim().min(1).max(50),
  walletAddress: base58Address,
});

export const UpdatePolicySchema = z.strictObject({
  ownerWallet: base58Address,
  maxPaymentAmount: usdcAmountString,
  dailyLimit: usdcAmountString,
  allowedRecipients: z.array(base58Address).max(200),
  requireConfirmation: z.literal(true, { message: "Every Pact payment requires explicit confirmation" }),
});

export const CreatePaymentIntentSchema = z.strictObject({
  payerWallet: base58Address,
  recipientId: z.string().min(1),
  amount: usdcAmountString,
  memo: z.string().trim().max(140).nullish(),
  aiSource: z
    .strictObject({
      originalPrompt: z.string().min(1).max(500),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
});

export const ExecuteIntentSchema = z.strictObject({
  signedTransactionBase64: z.string().min(1).max(5000),
});

/**
 * On-chain policy initialization. Amounts reuse the strict USDC decimal
 * format; the allowlist cap (16) is the program account limit, not the
 * backend contact-book limit (200).
 */
export const InitOnchainPolicySchema = z.strictObject({
  ownerWallet: base58Address,
  agent: base58Address,
  maxPaymentAmount: usdcAmountString,
  dailyLimit: usdcAmountString,
  windowSeconds: z.number().int().min(1).max(31_536_000).optional(),
  expiresAt: z.number().int().min(0).optional(),
  allowedRecipients: z.array(base58Address).max(16).optional(),
});
