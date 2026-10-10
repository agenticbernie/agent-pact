import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Transaction } from "@solana/web3.js";
import { useWallet } from "../features/wallet/WalletContext";
import {
  base64ToBytes,
  bytesToBase64,
  getWalletProvider,
  isWalletRejection,
} from "../features/wallet/wallet";
import { api } from "../lib/api";
import {
  explorerTxUrl,
  formatBase,
  networkName,
  percentOf,
  prettyAmount,
  shortAddress,
  toBaseUnits,
} from "../lib/format";
import { settledTodayBase } from "../lib/usage";
import PaymentProgress from "../components/PaymentProgress";
import WalletSigningModal from "../components/WalletSigningModal";
import { Button, Card, DetailRow, ErrorNote, Icon, PaymentCheckRow, Spinner, StatusBadge } from "../components/ui";
import type { AppSettings, PaymentIntent, Policy } from "../types";

const WALLET_TIMEOUT_MS = 120_000;

class WalletTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new WalletTimeoutError()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

type Phase = "loading" | "review" | "preparing" | "wallet" | "submitting" | "done";

export default function Confirm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address } = useWallet();
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [settledToday, setSettledToday] = useState<bigint>(0n);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Incremented whenever an attempt is dismissed/timed out so late wallet results are ignored.
  const attemptRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const [res, cfg] = await Promise.all([api.getIntent(id!), api.settings()]);
      setIntent(res.intent);
      setSettings(cfg);
      // Policy context for the payment checks (display only — the server already decided).
      api.getPolicy(res.intent.payerWallet).then((p) => setPolicy(p.policy)).catch(() => {});
      api
        .listIntents(res.intent.payerWallet)
        .then((r) => setSettledToday(settledTodayBase(r.intents)))
        .catch(() => {});
      if (res.intent.status === "SETTLED" || res.intent.status === "FAILED") setPhase("done");
      else setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the payment.");
      setPhase("review");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Wallet disconnected while the signature request is open.
  useEffect(() => {
    if (phase === "wallet" && !address) {
      attemptRef.current++;
      setError("Your wallet was disconnected. The payment was not sent.");
      load();
    }
  }, [address, phase, load]);

  async function cancel() {
    if (!intent) return;
    try {
      await api.cancelIntent(intent.id);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
      load();
    }
  }

  function dismissWalletRequest() {
    attemptRef.current++;
    setError("Signature request dismissed. The payment was not sent.");
    load();
  }

  async function confirmAndSign() {
    if (!intent) return;
    const attempt = ++attemptRef.current;
    const stale = () => attemptRef.current !== attempt;
    setError(null);
    setPhase("preparing");
    try {
      // 1. Explicit confirmation (idempotent) — deterministic pipeline only.
      await api.confirmIntent(intent.id);
      // 2. Backend builds the exact USDC transferChecked transaction.
      const built = await api.buildTransaction(intent.id);
      // 3. Wallet signature — client-side only, only after the user tapped Confirm & Sign.
      const provider = getWalletProvider();
      if (!provider) throw new Error("No Solana wallet detected. Install Phantom and reload.");
      const tx = Transaction.from(base64ToBytes(built.transactionBase64));
      if (stale()) return;
      setPhase("wallet");
      const signed = await withTimeout(provider.signTransaction(tx), WALLET_TIMEOUT_MS);
      if (stale()) return; // dismissed or wallet disconnected: never submit
      // 4. Backend submits and waits for real Solana confirmation.
      setPhase("submitting");
      const res = await api.executeIntent(intent.id, bytesToBase64(signed.serialize()));
      setIntent(res.intent);
      setPhase("done");
    } catch (e) {
      if (stale()) return;
      attemptRef.current++;
      setError(
        e instanceof WalletTimeoutError
          ? "Your wallet did not respond in time. The payment was not sent."
          : isWalletRejection(e)
            ? "You rejected the signature request. The payment was not sent."
            : e instanceof Error
              ? e.message
              : "Something went wrong."
      );
      load(); // refresh intent status (it may now be CONFIRMED)
    }
  }

  if (phase === "loading") return <Spinner label="Loading payment…" />;

  if (!intent) {
    return (
      <Card className="stack-sm">
        <ErrorNote>{error ?? "Payment not found."}</ErrorNote>
        <Button variant="secondary" onClick={() => navigate("/")}>Back home</Button>
      </Card>
    );
  }

  const network = networkName(settings?.network);
  const amountBase = toBaseUnits(intent.amountDisplay);
  const paymentId = (
    <div className="micro mono centered" style={{ wordBreak: "break-all" }}>
      Payment ID · {intent.id}
    </div>
  );

  // Policy rejection
  if (intent.status === "REJECTED") {
    return (
      <>
        <h1 className="page-title">Payment rejected</h1>
        <Card className="stack-sm">
          <ErrorNote>{intent.policyResult?.message ?? "This payment was rejected by your spending policy."}</ErrorNote>
          <p className="micro">Reason code: {intent.policyResult?.reasonCode}</p>
          <div className="btn-row">
            <Button variant="secondary" onClick={() => navigate("/policy")}>Review rules</Button>
            <Button onClick={() => navigate("/pay")}>New payment</Button>
          </div>
        </Card>
      </>
    );
  }

  if (intent.status === "EXPIRED" || intent.status === "CANCELLED") {
    return (
      <>
        <h1 className="page-title">{intent.status === "EXPIRED" ? "This payment expired" : "Payment cancelled"}</h1>
        <Card className="stack-sm">
          <p className="empty">
            {intent.status === "EXPIRED"
              ? "Payments expire after 5 minutes. Create a new one if you still want to pay."
              : "This payment was cancelled. Nothing was sent."}
          </p>
          <Button block onClick={() => navigate("/pay")}>Create a new payment</Button>
        </Card>
      </>
    );
  }

  // Terminal result
  if (phase === "done") {
    if (intent.status === "SETTLED") {
      return (
        <>
          <div className="hero">
            <div className="success-icon">
              <Icon name="check" />
            </div>
            <span className="eyebrow">Paid</span>
            <div className="hero-amount">
              <span className="amt">{prettyAmount(intent.amountDisplay)}</span>
              <span className="unit">USDC</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>to {intent.recipientName}</div>
            {intent.memo ? <div className="page-sub">“{intent.memo}”</div> : null}
          </div>
          <Card>
            <DetailRow label="Status" value={<StatusBadge status={intent.status} />} />
            <DetailRow label="Network" value={network} />
            {intent.transactionSignature ? (
              <DetailRow
                label="Transaction signature"
                value={<span className="mono" style={{ fontSize: 11 }}>{intent.transactionSignature}</span>}
              />
            ) : null}
            <DetailRow label="Payment ID" value={<span className="mono" style={{ fontSize: 11 }}>{intent.id}</span>} />
          </Card>
          <div className="stack-sm">
            {intent.transactionSignature ? (
              <a
                className="btn btn-tonal btn-block"
                href={explorerTxUrl(intent.transactionSignature, settings?.network ?? "devnet")}
                target="_blank"
                rel="noreferrer"
              >
                View on Solana Explorer <Icon name="open_in_new" />
              </a>
            ) : null}
            <Button block onClick={() => navigate("/activity")}>Done</Button>
          </div>
        </>
      );
    }
    if (intent.status === "FAILED") {
      return (
        <>
          <h1 className="page-title">Payment failed</h1>
          <Card className="stack-sm">
            <ErrorNote>{intent.failureReason ?? "The transaction failed."}</ErrorNote>
            <Button block onClick={() => navigate("/pay")}>Create a new payment</Button>
          </Card>
        </>
      );
    }
  }

  if (phase === "submitting") {
    return (
      <>
        <h1 className="page-title">Processing payment</h1>
        <Card className="stack-sm">
          <PaymentProgress />
        </Card>
        <p className="micro centered">
          This is marked Settled only after Solana confirms the transaction.
        </p>
      </>
    );
  }

  const busy = phase === "preparing" || phase === "wallet";
  const maxBase = policy ? toBaseUnits(policy.maxPaymentAmount) : 0n;
  const dailyBase = policy ? toBaseUnits(policy.dailyLimit) : 0n;

  // Confirmation screen (security-critical)
  return (
    <>
      <h1 className="section-title">Payment Confirmation</h1>

      <section className="card hero">
        <span className="chip tint">Payment review</span>
        <div className="hero-amount">
          <span className="amt">{prettyAmount(intent.amountDisplay)}</span>
          <span className="unit">USDC</span>
        </div>
        <div style={{ color: "var(--text-2)" }}>
          To: <strong style={{ color: "var(--text)" }}>{intent.recipientName}</strong>
        </div>
      </section>

      <section className="card">
        <span className="eyebrow">Recipient</span>
        <div className="row" style={{ margin: "12px 0" }}>
          <div className="tx-left">
            <div className="avatar">{intent.recipientName.charAt(0).toUpperCase()}</div>
            <div className="tx-main">
              <span className="tx-name">{intent.recipientName}</span>
              <span className="tx-sub mono">{shortAddress(intent.recipientWallet, 5)}</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-tile"
            aria-label="Copy recipient address"
            onClick={() =>
              navigator.clipboard
                ?.writeText(intent.recipientWallet)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            <Icon name={copied ? "check" : "content_copy"} />
          </button>
        </div>
        <div className="inset" style={{ padding: "0 12px" }}>
          <DetailRow icon="notes" label="Memo" value={intent.memo ? `“${intent.memo}”` : "—"} />
          <DetailRow icon="hub" label="Network" value={network} />
        </div>
      </section>

      <section className="card stack-sm">
        <div className="row">
          <h2 className="card-title">Payment checks</h2>
          <span className="badge badge-green">Checks passed</span>
        </div>
        <p className="micro">Pact verified this payment against your spending rules.</p>
        {policy ? (
          <>
            <PaymentCheckRow
              title="Per-payment limit"
              detail={`${formatBase(amountBase)} / ${formatBase(maxBase)} USDC`}
              percent={percentOf(amountBase, maxBase)}
            />
            <PaymentCheckRow
              title="Daily spending limit"
              detail={`${formatBase(settledToday)} / ${formatBase(dailyBase)} USDC used today`}
              percent={percentOf(settledToday, dailyBase)}
            />
            <PaymentCheckRow title="Allowed recipient" detail="Recipient allowed" />
          </>
        ) : (
          <p className="micro">{intent.policyResult?.message ?? "Payment allowed by policy."}</p>
        )}
      </section>

      <section className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <DetailRow label="Network" value={network} />
        <DetailRow label="Estimated network fee" value="≈ 0.000005 SOL" />
        <DetailRow
          label="On-chain program"
          value={
            settings?.policyProgramId
              ? `Pact Policy · ${shortAddress(settings.policyProgramId, 4)}`
              : "SPL Token Program"
          }
        />
      </section>

      <div className="banner">
        <Icon name="shield_lock" />
        <div>
          <strong>Your wallet signs</strong>
          <p>
            Your wallet will ask you to approve this transaction after you tap Confirm &amp; Sign. AI has no
            authority to sign.
          </p>
        </div>
      </div>

      {paymentId}

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="stack-sm">
        <Button block onClick={confirmAndSign} disabled={busy}>
          <Icon name="key" /> {phase === "preparing" ? "Preparing…" : "Confirm & Sign"}
        </Button>
        <Button variant="secondary" block onClick={cancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      {phase === "wallet" ? <WalletSigningModal onDismiss={dismissWalletRequest} /> : null}
    </>
  );
}
