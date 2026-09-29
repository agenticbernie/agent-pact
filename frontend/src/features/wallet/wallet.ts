import { PublicKey, Transaction } from "@solana/web3.js";

/**
 * Injected Solana wallet provider (Phantom first, any compatible provider
 * as fallback). Pact NEVER sees or stores private keys — signing always
 * happens inside the wallet.
 */
export interface SolanaProvider {
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<unknown>;
  signTransaction<T extends Transaction | unknown>(transaction: T): Promise<T>;
  isPhantom?: boolean;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

export function getWalletProvider(): SolanaProvider | null {
  const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider };
  return w.phantom?.solana ?? w.solana ?? null;
}

export function isWalletRejection(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  return e?.code === 4001 || /reject|cancel|denied/i.test(e?.message ?? "");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
