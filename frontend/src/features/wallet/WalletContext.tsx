import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getWalletProvider } from "./wallet";

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  available: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "pact.wallet.address";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(Boolean(getWalletProvider()));
  }, []);

  const connect = useCallback(async () => {
    const provider = getWalletProvider();
    if (!provider) {
      throw new Error(
        "No Solana wallet detected. Install the Phantom browser extension, or open Pact in a browser with your wallet."
      );
    }
    setConnecting(true);
    try {
      const { publicKey } = await provider.connect();
      const addr = publicKey.toBase58();
      localStorage.setItem(STORAGE_KEY, addr);
      setAddress(addr);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await getWalletProvider()?.disconnect();
    } catch {
      // ignore
    }
    localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
  }, []);

  return (
    <WalletContext.Provider value={{ address, connecting, available, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
