import type { Policy, PolicyReasonCode, PolicyResult } from "../../types";
import { parseUsdc } from "../usdc/parse";

/**
 * Deterministic policy engine. Policy decisions NEVER use the LLM —
 * this module is pure, synchronous and independently testable.
 */

export interface PolicyEvaluationInput {
  policy: Policy;
  token: string;
  amountBaseUnits: bigint;
  recipientWallet: string;
  /** Total USDC (base units) already SETTLED by this payer today (UTC). */
  settledTodayBaseUnits: bigint;
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyResult {
  const { policy, token, amountBaseUnits, recipientWallet, settledTodayBaseUnits } = input;

  if (token !== "USDC") {
    return deny("INVALID_TOKEN", "Only USDC payments are supported.");
  }
  if (amountBaseUnits <= 0n) {
    return deny("INVALID_AMOUNT", "Payment amount must be greater than zero.");
  }

  let maxBase: bigint;
  let dailyBase: bigint;
  try {
    maxBase = parseUsdc(policy.maxPaymentAmount);
    dailyBase = parseUsdc(policy.dailyLimit);
  } catch {
    return deny("INVALID_AMOUNT", "Spending policy limits are invalid. Update your policy settings.");
  }

  if (amountBaseUnits > maxBase) {
    return deny(
      "PAYMENT_LIMIT_EXCEEDED",
      `This payment of ${policy.maxPaymentAmount && amountDisplay(input)} USDC exceeds your maximum single payment of ${policy.maxPaymentAmount} USDC.`
    );
  }
  if (settledTodayBaseUnits + amountBaseUnits > dailyBase) {
    return deny(
      "DAILY_LIMIT_EXCEEDED",
      `This payment exceeds your daily spending limit of ${policy.dailyLimit} USDC.`
    );
  }
  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipientWallet)) {
    return deny("RECIPIENT_NOT_ALLOWED", "This recipient is not on your allowed recipients list.");
  }

  return { allowed: true, reasonCode: "ALLOWED", message: "Payment allowed by policy." };
}

function amountDisplay(input: PolicyEvaluationInput): string {
  const { USDC_SCALE } = require("../usdc/parse") as typeof import("../usdc/parse");
  const whole = input.amountBaseUnits / USDC_SCALE;
  const frac = (input.amountBaseUnits % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function deny(reasonCode: PolicyReasonCode, message: string): PolicyResult {
  return { allowed: false, reasonCode, message };
}
