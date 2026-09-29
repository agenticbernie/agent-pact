import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { prettyAmount, timeAgo } from "../lib/format";
import { Card, ErrorNote, Spinner, StatusBadge } from "../components/ui";
import type { PaymentIntent, UsdcBalanceInfo } from "../types";

export default function Home() {
  const { address } = useWallet();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<UsdcBalanceInfo | null>(null);
  const [recent, setRecent] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [bal, intents] = await Promise.all([
        api.getBalance(address),
        api.listIntents(address),
      ]);
      setBalance(bal.balance);
      setRecent(intents.intents.slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your account.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setBalance(null);
    setRecent([]);
    refresh();
  }, [refresh]);

  return (
    <div className="stack">
      <section className="balance-card">
        <p className="balance-label">USDC Balance</p>
        {address ? (
          loading && !balance ? (
            <Spinner />
          ) : (
            <p className="balance-value">{balance ? prettyAmount(balance.display) : "—"} <span>USDC</span></p>
          )
        ) : (
          <p className="balance-muted">Connect your wallet to see your balance</p>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </section>

      <Link to="/pay" className="pay-cta">Pay</Link>

      <Card>
        <h2 className="card-title">Ask Pact</h2>
        <form
          className="ask-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask.trim()) return;
            navigate(`/pay?ask=${encodeURIComponent(ask.trim())}`);
          }}
        >
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Pay Felix 3 USDC for coffee"
            aria-label="Describe a payment"
          />
          <button type="submit" className="btn btn-primary" disabled={!ask.trim()}>
            Ask
          </button>
        </form>
        <p className="micro">AI interprets your intent. You confirm. Your wallet signs.</p>
      </Card>

      <Card>
        <div className="card-head">
          <h2 className="card-title">Recent Activity</h2>
          <Link to="/activity" className="link">View all</Link>
        </div>
        {!address ? (
          <p className="empty">Connect your wallet to see activity.</p>
        ) : recent.length === 0 ? (
          <p className="empty">No payments yet.</p>
        ) : (
          <ul className="tx-list">
            {recent.map((intent) => (
              <li key={intent.id} className="tx-row">
                <div className="tx-main">
                  <span className="tx-name">{intent.recipientName}</span>
                  <span className="tx-sub">
                    −{prettyAmount(intent.amountDisplay)} USDC
                    {intent.memo ? ` · ${intent.memo}` : ""}
                  </span>
                </div>
                <div className="tx-side">
                  <StatusBadge status={intent.status} />
                  <span className="tx-time">{timeAgo(intent.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
