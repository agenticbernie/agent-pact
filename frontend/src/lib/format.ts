/** Pad an amount display string to at least 2 decimals: "3" -> "3.00", "3.25" -> "3.25". */
export function prettyAmount(display: string): string {
  const [whole, frac = ""] = display.split(".");
  if (frac.length >= 2) return display;
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function explorerTxUrl(signature: string, network: string): string {
  const cluster =
    network === "mainnet-beta" ? "" : network === "devnet" ? "?cluster=devnet" : `?cluster=${network}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
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

export const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
