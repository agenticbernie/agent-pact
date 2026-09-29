import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isTerminal } from "../src/lib/payments/stateMachine";

describe("payment intent state machine", () => {
  it("allows the happy path transitions", () => {
    expect(() => assertTransition("PROPOSED", "AWAITING_CONFIRMATION")).not.toThrow();
    expect(() => assertTransition("AWAITING_CONFIRMATION", "CONFIRMED")).not.toThrow();
    expect(() => assertTransition("CONFIRMED", "EXECUTING")).not.toThrow();
    expect(() => assertTransition("EXECUTING", "SETTLED")).not.toThrow();
  });

  it("allows policy rejection and cancellation paths", () => {
    expect(canTransition("PROPOSED", "REJECTED")).toBe(true);
    expect(canTransition("AWAITING_CONFIRMATION", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "FAILED")).toBe(true);
    expect(canTransition("EXECUTING", "FAILED")).toBe(true);
  });

  it("rejects invalid transitions from terminal states", () => {
    expect(() => assertTransition("SETTLED", "EXECUTING")).toThrow();
    expect(() => assertTransition("REJECTED", "CONFIRMED")).toThrow();
    expect(() => assertTransition("EXPIRED", "EXECUTING")).toThrow();
    expect(() => assertTransition("CANCELLED", "CONFIRMED")).toThrow();
    expect(() => assertTransition("FAILED", "EXECUTING")).toThrow();
  });

  it("rejects skipping states", () => {
    expect(canTransition("AWAITING_CONFIRMATION", "EXECUTING")).toBe(false);
    expect(canTransition("PROPOSED", "SETTLED")).toBe(false);
    expect(canTransition("PROPOSED", "CONFIRMED")).toBe(false);
  });

  it("marks terminal states", () => {
    expect(isTerminal("SETTLED")).toBe(true);
    expect(isTerminal("REJECTED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("CONFIRMED")).toBe(false);
  });
});
