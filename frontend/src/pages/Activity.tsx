import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { explorerTxUrl, prettyAmount, timeAgo } from "../lib/format";
import { Card, ErrorNote, Spinner, StatusBadge } from "../components/ui";
import type { AppSettings, PaymentIntent } from "../types";

export default function Activity() {
  const { address } = useWallet();
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [res, cfg] = await Promise.all([api.listIntents(address), api.settings()]);
      setIntents(res.intents);
      setSettings(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (!address) {
    return (
      <Card>
        <h1 className="page-title">Activity</h1>
        <p className="empty">Connect your wallet to see your payment history.</p>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="card-head">
        <h1 className="page-title">Activity</h1>
        <button className="link" onClick={load} type="button">Refresh</button>
      </div>
      {loading && intents.length === 0 ? <Spinner /> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {intents.length === 0 && !loading ? (
        <Card>
          <p className="empty">No payments yet. Your confirmed and settled payments will appear here.</p>
        </Card>
      ) : (
        <ul className="tx-list card">
          {intents.map((intent) => (
            <li key={intent.id} className="tx-row">
              <div className="tx-main">
                <span className="tx-name">{intent.recipientName}</span>
                <span className="tx-sub">
                  −{prettyAmount(intent.amountDisplay)} USDC
                  {intent.memo ? ` · ${intent.memo}` : ""}
                </span>
                {intent.status === "SETTLED" && intent.transactionSignature ? (
                  <a
                    className="tx-link"
                    href={explorerTxUrl(intent.transactionSignature, settings?.network ?? "devnet")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Solana Explorer ↗
                  </a>
                ) : intent.status === "REJECTED" && intent.policyResult ? (
                  <span className="tx-sub">{intent.policyResult.message}</span>
                ) : intent.status === "FAILED" && intent.failureReason ? (
                  <span className="tx-sub">{intent.failureReason}</span>
                ) : null}
              </div>
              <div className="tx-side">
                <StatusBadge status={intent.status} />
                <span className="tx-time">{timeAgo(intent.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
