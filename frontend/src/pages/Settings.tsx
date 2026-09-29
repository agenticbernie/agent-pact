import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, ErrorNote } from "../components/ui";
import type { AppSettings } from "../types";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load settings."));
  }, []);

  return (
    <Card className="stack-sm">
      <h1 className="page-title">Settings</h1>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {settings ? (
        <div className="detail-stack">
          <div className="detail-row"><span className="detail-label">Network</span><span className="detail-value">Solana {settings.network}</span></div>
          <div className="detail-row"><span className="detail-label">RPC</span><span className="detail-value mono">{settings.rpcUrl}</span></div>
          <div className="detail-row"><span className="detail-label">USDC mint</span><span className="detail-value mono">{settings.usdcMint}</span></div>
          <div className="detail-row"><span className="detail-label">Intent parser</span><span className="detail-value">{settings.model}</span></div>
          <div className="detail-row">
            <span className="detail-label">AI parsing</span>
            <span className={`badge ${settings.aiConfigured ? "badge-green" : "badge-amber"}`}>
              {settings.aiConfigured ? "Configured" : "Not configured — manual payment still works"}
            </span>
          </div>
        </div>
      ) : null}
      <p className="micro">
        To test on devnet, fund your wallet with devnet USDC at faucet.circle.com (Solana devnet) and
        SOL at faucet.solana.com. Pact never stores private keys or seed phrases — signing always
        happens in your own wallet.
      </p>
    </Card>
  );
}
