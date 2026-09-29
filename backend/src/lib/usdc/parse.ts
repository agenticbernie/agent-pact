/**
 * USDC amounts use 6 decimal places. Internally everything is handled as
 * integer base units via BigInt. No floating-point arithmetic is ever used
 * for transfer-critical processing.
 *
 *   1 USDC        = 1,000,000 base units
 *   0.5 USDC      =   500,000 base units
 *   0.000001 USDC =        1 base unit
 */

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 1_000_000n;

export class UsdcParseError extends Error {
  constructor(message = "Invalid USDC amount") {
    super(message);
    this.name = "UsdcParseError";
  }
}

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

export function isUsdcAmountString(value: string): boolean {
  return AMOUNT_RE.test(value);
}

/** Parse a human USDC amount string into integer base units. Throws UsdcParseError on invalid input. */
export function parseUsdc(input: string): bigint {
  const s = typeof input === "string" ? input.trim() : "";
  if (!AMOUNT_RE.test(s)) {
    throw new UsdcParseError("Amount must be a non-negative decimal string with at most 6 decimal places");
  }
  const [whole, frac = ""] = s.split(".");
  const baseUnits = BigInt(whole) * USDC_SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
  if (baseUnits <= 0n) {
    throw new UsdcParseError("Amount must be greater than zero");
  }
  return baseUnits;
}

/** Format integer base units as a minimal USDC amount string: 3250000n -> "3.25", 3000000n -> "3". */
export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / USDC_SCALE;
  const frac = (baseUnits % USDC_SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Like formatUsdc but always shows at least 2 decimal places for display: 3000000n -> "3.00". */
export function formatUsdcDisplay(baseUnits: bigint): string {
  const whole = baseUnits / USDC_SCALE;
  let frac = (baseUnits % USDC_SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${whole}.${frac}`;
}
