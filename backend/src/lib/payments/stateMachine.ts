import type { PaymentStatus } from "../../types";

/**
 * Payment intent state machine. Transitions are exhaustive and explicit —
 * arbitrary state changes are never allowed.
 *
 * PROPOSED -> AWAITING_CONFIRMATION | REJECTED | EXPIRED
 * AWAITING_CONFIRMATION -> CONFIRMED | CANCELLED | EXPIRED
 * CONFIRMED -> EXECUTING | CANCELLED | EXPIRED | FAILED
 * EXECUTING -> SETTLED | FAILED
 */
export const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PROPOSED: ["AWAITING_CONFIRMATION", "REJECTED", "EXPIRED"],
  AWAITING_CONFIRMATION: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["EXECUTING", "CANCELLED", "EXPIRED", "FAILED"],
  EXECUTING: ["SETTLED", "FAILED"],
  SETTLED: [],
  REJECTED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(public from: PaymentStatus, public to: PaymentStatus) {
    super(`Invalid payment intent transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return (ALLOWED_TRANSITIONS[status] ?? []).length === 0;
}
