import { describe, expect, it } from "vitest";
import { formatUsdc, formatUsdcDisplay, parseUsdc, UsdcParseError } from "../src/lib/usdc/parse";

describe("parseUsdc", () => {
  it("parses valid amounts into integer base units", () => {
    expect(parseUsdc("1")).toBe(1000000n);
    expect(parseUsdc("1.5")).toBe(1500000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("3.25")).toBe(3250000n);
    expect(parseUsdc("3.000000")).toBe(3000000n);
    expect(parseUsdc("10")).toBe(10000000n);
  });

  it("rejects invalid amounts", () => {
    const bad = ["0", "-1", "abc", "1.0000001", "NaN", "Infinity", "", "1e3", "1.2.3", "3.25.1", ".5", "5."];
    for (const value of bad) {
      expect(() => parseUsdc(value), `expected reject: ${value}`).toThrow(UsdcParseError);
    }
  });
});

describe("formatUsdc", () => {
  it("formats base units as minimal amount strings", () => {
    expect(formatUsdc(3250000n)).toBe("3.25");
    expect(formatUsdc(3000000n)).toBe("3");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(1500000n)).toBe("1.5");
  });

  it("formatUsdcDisplay pads to at least 2 decimals", () => {
    expect(formatUsdcDisplay(3000000n)).toBe("3.00");
    expect(formatUsdcDisplay(3250000n)).toBe("3.25");
    expect(formatUsdcDisplay(1n)).toBe("0.000001");
  });
});
