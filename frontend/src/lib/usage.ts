import type { PaymentIntent } from "../types";
import { toBaseUnits } from "./format";

/** Display-only: USDC (base units) already SETTLED today (UTC), mirroring the server's daily window. */
export function settledTodayBase(intents: PaymentIntent[]): bigint {
  const today = new Date().toISOString().slice(0, 10);
  return intents
    .filter((i) => i.status === "SETTLED" && (i.settledAt ?? i.createdAt).slice(0, 10) === today)
    .reduce((sum, i) => sum + BigInt(i.amountBaseUnits ?? toBaseUnits(i.amountDisplay)), 0n);
}
