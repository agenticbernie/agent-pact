/** Pad an amount display string to at least 2 decimals: "3" -> "3.00", "3.25" -> "3.25". */
export function prettyAmount(display: string): string {
  const [whole, frac = ""] = display.split(".");
  if (frac.length >= 2) return display;
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/** Display-only helpers for USDC base units (6 decimals). Authoritative math lives on the server. */
const USDC_UNIT = 1_000_000n;

export function toBaseUnits(display: string): bigint {
  const [whole, frac = ""] = display.split(".");
  return BigInt(whole || "0") * USDC_UNIT + BigInt((frac + "000000").slice(0, 6));
}

export function formatBase(units: bigint): string {
  const whole = units / USDC_UNIT;
  const frac = (units % USDC_UNIT).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
}

export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Math.min(100, Number((part * 10000n) / whole) / 100);
}

export function explorerTxUrl(signature: string, network: string): string {
  const cluster =
    network === "mainnet-beta" ? "" : network === "devnet" ? "?cluster=devnet" : `?cluster=${network}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

export function networkName(network?: string | null): string {
  if (!network) return "Solana";
  if (network === "mainnet-beta") return "Solana Mainnet";
  return `Solana ${network.charAt(0).toUpperCase()}${network.slice(1)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Today" / "Yesterday" / local date — used to group activity. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
