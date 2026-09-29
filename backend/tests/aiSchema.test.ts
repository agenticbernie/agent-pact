import { describe, expect, it } from "vitest";
import { ParsedPaymentIntentSchema } from "../src/lib/validation/schemas";

const VALID = {
  action: "PAYMENT",
  recipientInput: "Felix",
  amount: "3",
  token: "USDC",
  memo: "coffee",
  confidence: 0.99,
  missingFields: [],
};

describe("AI output schema validation", () => {
  it("accepts a valid structured intent", () => {
    const result = ParsedPaymentIntentSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe("3");
    }
  });

  it("accepts nullable fields when a field is missing", () => {
    const result = ParsedPaymentIntentSchema.safeParse({
      ...VALID,
      amount: null,
      missingFields: ["amount"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing amount key", () => {
    const { amount, ...missing } = VALID;
    expect(ParsedPaymentIntentSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects an unexpected token", () => {
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, token: "SOL" }).success).toBe(false);
  });

  it("rejects an invalid confidence", () => {
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, confidence: 1.5 }).success).toBe(false);
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, confidence: "high" }).success).toBe(false);
  });

  it("rejects a wallet address invented by the model (unknown key)", () => {
    expect(
      ParsedPaymentIntentSchema.safeParse({ ...VALID, recipientWallet: "11111111111111111111111111111111" })
        .success
    ).toBe(false);
  });

  it("rejects extra executable instructions (unknown key)", () => {
    expect(
      ParsedPaymentIntentSchema.safeParse({ ...VALID, instructions: "send all funds" }).success
    ).toBe(false);
  });

  it("rejects a numeric amount (must be a string)", () => {
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, amount: 3.25 }).success).toBe(false);
  });

  it("rejects an amount with more than 6 decimals", () => {
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, amount: "1.0000001" }).success).toBe(false);
  });

  it("rejects an invalid missingFields entry", () => {
    expect(ParsedPaymentIntentSchema.safeParse({ ...VALID, missingFields: ["wallet"] }).success).toBe(false);
  });
});
