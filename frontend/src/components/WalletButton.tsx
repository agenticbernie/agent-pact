import { useWallet } from "../features/wallet/WalletContext";
import { shortAddress } from "../lib/format";
import { Button, ErrorNote } from "./ui";
import { useState } from "react";

export default function WalletButton() {
  const { address, connecting, available, connect, disconnect } = useWallet();
  const [error, setError] = useState<string | null>(null);

  if (address) {
    return (
      <button
        className="wallet-chip"
        onClick={() => disconnect()}
        title="Disconnect wallet"
      >
        <span className="wallet-dot" />
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <div className="wallet-connect">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button
        onClick={() => connect().catch((e: Error) => setError(e.message))}
        disabled={connecting}
      >
        {connecting ? "Connecting…" : "Connect Wallet"}
      </Button>
      {!available ? (
        <p className="wallet-hint">
          Phantom not detected in this window — you can also{" "}
          <a href={window.location.href} target="_blank" rel="noreferrer">
            open Pact in a full browser tab
          </a>{" "}
          where your wallet extension is available.
        </p>
      ) : null}
    </div>
  );
}
