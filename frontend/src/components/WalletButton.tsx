import { useWallet } from "../features/wallet/WalletContext";
import { shortAddress } from "../lib/format";

/** Connected wallet pill (or a Connect action when no wallet is connected). */
export default function WalletPill({ onError }: { onError?: (message: string | null) => void }) {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button className="wallet-pill" onClick={() => disconnect()} title="Disconnect wallet">
        <span className="live-dot" />
        {shortAddress(address, 3)}
      </button>
    );
  }

  return (
    <button
      className="wallet-pill connect"
      disabled={connecting}
      onClick={() => {
        onError?.(null);
        connect().catch((e: Error) => onError?.(e.message));
      }}
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
