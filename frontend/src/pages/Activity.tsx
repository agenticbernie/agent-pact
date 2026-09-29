import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { dayLabel, explorerTxUrl } from "../lib/format";
import { useSettings } from "../lib/useSettings";
import TransactionRow from "../components/TransactionRow";
import { Card, ErrorNote, Spinner } from "../components/ui";
import type { PaymentIntent } from "../types";

export default function Activity() {
  const { address } = useWallet();
  const settings = useSettings();
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listIntents(address);
      setIntents(res.intents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, PaymentIntent[]>();
    for (const i of intents) {
      const key = dayLabel(i.createdAt);
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()];
  }, [intents]);

  if (!address) {
    return (
      <Card>
        <h1 className="section-title">Activity</h1>
        <p className="empty" style={{ marginTop: 8 }}>Connect your wallet to see your payment history.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="row">
        <h1 className="page-title">Activity</h1>
        <button className="link" onClick={load} type="button">
          Refresh
        </button>
      </div>
      {loading && intents.length === 0 ? <Spinner /> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {intents.length === 0 && !loading ? (
        <p className="empty">No payments yet. Your payments will appear here.</p>
      ) : (
        groups.map(([label, items]) => (
          <section key={label}>
            <h2 className="date-head">{label}</h2>
            <div className="card flush">
              {items.map((intent, i) => (
                <div key={intent.id}>
                  {i > 0 ? <div className="hairline" /> : null}
                  <TransactionRow intent={intent} />
                  <ActivityNote intent={intent} network={settings?.network ?? "devnet"} />
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function ActivityNote({ intent, network }: { intent: PaymentIntent; network: string }) {
  if (intent.status === "SETTLED" && intent.transactionSignature) {
    return (
      <div className="tx-note">
        <a className="link" href={explorerTxUrl(intent.transactionSignature, network)} target="_blank" rel="noreferrer">
          View on Solana Explorer ↗
        </a>
      </div>
    );
  }
  if (intent.status === "AWAITING_CONFIRMATION" || intent.status === "CONFIRMED") {
    return (
      <div className="tx-note">
        <Link className="link" to={`/confirm/${intent.id}`}>
          Review payment →
        </Link>
      </div>
    );
  }
  if (intent.status === "REJECTED" && intent.policyResult) {
    return <div className="tx-note">{intent.policyResult.message}</div>;
  }
  if (intent.status === "FAILED" && intent.failureReason) {
    return <div className="tx-note">{intent.failureReason}</div>;
  }
  return null;
}
