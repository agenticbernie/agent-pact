import { useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import WalletPill from "./WalletButton";
import { Icon } from "./ui";

export default function PactHeader() {
  const { available, address } = useWallet();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span>Pact</span>
          <span className="status-dot" />
        </div>
        <div className="header-right">
          <WalletPill onError={setError} />
          <Link to="/settings" className="avatar-btn" aria-label="Profile and settings">
            <Icon name="person" fill />
          </Link>
        </div>
      </header>
      {error ? <p className="wallet-hint">{error}</p> : null}
      {!address && !available ? (
        <p className="wallet-hint">
          No wallet detected in this window.{" "}
          <a href={window.location.href} target="_blank" rel="noreferrer">
            Open Pact in a full browser tab
          </a>{" "}
          where your wallet extension is available.
        </p>
      ) : null}
    </>
  );
}
