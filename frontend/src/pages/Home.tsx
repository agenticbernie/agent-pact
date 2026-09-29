import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { networkName, prettyAmount } from "../lib/format";
import { useSettings } from "../lib/useSettings";
import AskPactInput from "../components/AskPactInput";
import BalanceDisplay from "../components/BalanceDisplay";
import TransactionRow from "../components/TransactionRow";
import { Button, ErrorNote, Icon } from "../components/ui";
import type { PaymentIntent, UsdcBalanceInfo } from "../types";

export default function Home() {
  const { address } = useWallet();
  const settings = useSettings();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<UsdcBalanceInfo | null>(null);
  const [recent, setRecent] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [bal, intents] = await Promise.all([api.getBalance(address), api.listIntents(address)]);
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

  const balanceText = !address ? "—" : balance ? prettyAmount(balance.display) : loading ? "…" : "—";

  return (
    <>
      <BalanceDisplay amount={balanceText} network={networkName(settings?.network)} address={address} />
      {!address ? <p className="micro centered">Connect your wallet to see your balance.</p> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <AskPactInput
        value={ask}
        onChange={setAsk}
        onSubmit={() => {
          if (ask.trim()) navigate(`/pay?ask=${encodeURIComponent(ask.trim())}`);
        }}
      />

      <div className="quick-actions">
        <Link to="/pay" className="btn">
          <Icon name="north_east" /> Send
        </Link>
        <Button onClick={() => setReceiveOpen(true)}>
          <Icon name="south_west" /> Receive
        </Button>
      </div>

      <section>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="section-title">Recent Activity</h2>
          <Link to="/activity" className="link">
            View all
          </Link>
        </div>
        {!address ? (
          <p className="empty">Connect your wallet to see activity.</p>
        ) : recent.length === 0 ? (
          <p className="empty">No payments yet.</p>
        ) : (
          <div className="card flush">
            {recent.map((intent, i) => (
              <div key={intent.id}>
                {i > 0 ? <div className="hairline" /> : null}
                <TransactionRow intent={intent} />
              </div>
            ))}
          </div>
        )}
      </section>

      {receiveOpen ? <ReceiveSheet address={address} onClose={() => setReceiveOpen(false)} /> : null}
    </>
  );
}

function ReceiveSheet({ address, onClose }: { address: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Receive USDC" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="centered">
          <h2 className="section-title">Receive USDC</h2>
          <p className="page-sub">Share your wallet address to receive USDC on Solana.</p>
        </div>
        {address ? (
          <>
            <div className="inset mono" style={{ wordBreak: "break-all", fontSize: 12 }}>
              {address}
            </div>
            <Button
              variant="tonal"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(address)
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              <Icon name={copied ? "check" : "content_copy"} /> {copied ? "Copied" : "Copy address"}
            </Button>
          </>
        ) : (
          <p className="empty centered">Connect your wallet to see your address.</p>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
