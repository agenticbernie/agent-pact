import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/lib/policy/engine";
import type { Policy } from "../src/types";

const policy: Policy = {
  maxPaymentAmount: "10",
  dailyLimit: "50",
  allowedRecipients: [],
  requireConfirmation: true,
};

const RECIPIENT = "So11111111111111111111111111111111111111112";

function evalAmount(amountBaseUnits: bigint, extra: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) {
  return evaluatePolicy({
    policy,
    token: "USDC",
    amountBaseUnits,
    recipientWallet: RECIPIENT,
    settledTodayBaseUnits: 0n,
    ...extra,
  });
}

describe("policy engine", () => {
  it("allows a payment within all limits", () => {
    const result = evalAmount(3_000_000n);
    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBe("ALLOWED");
  });

  it("rejects a payment above the max single payment", () => {
    const result = evalAmount(11_000_000n);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("PAYMENT_LIMIT_EXCEEDED");
  });

  it("rejects a payment that exceeds the daily limit including today's settled total", () => {
    const result = evalAmount(5_000_000n, { settledTodayBaseUnits: 46_000_000n });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("DAILY_LIMIT_EXCEEDED");
  });

  it("allows a payment exactly at the daily limit boundary", () => {
    const result = evalAmount(4_000_000n, { settledTodayBaseUnits: 46_000_000n });
    expect(result.allowed).toBe(true);
  });

  it("rejects a recipient not on the allowlist", () => {
    const result = evalAmount(3_000_000n, {
      policy: { ...policy, allowedRecipients: ["11111111111111111111111111111111"] },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("RECIPIENT_NOT_ALLOWED");
  });

  it("allows a recipient on the allowlist", () => {
    const result = evalAmount(3_000_000n, {
      policy: { ...policy, allowedRecipients: [RECIPIENT] },
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects a non-USDC token", () => {
    const result = evalAmount(3_000_000n, { token: "SOL" });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("INVALID_TOKEN");
  });

  it("rejects a zero amount", () => {
    const result = evalAmount(0n);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("INVALID_AMOUNT");
  });
});
