import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Transaction } from "@solana/web3.js";
import { useWallet } from "../features/wallet/WalletContext";
import {
  base64ToBytes,
  bytesToBase64,
  getWalletProvider,
  isWalletRejection,
} from "../features/wallet/wallet";
import { api } from "../lib/api";
import { explorerTxUrl, prettyAmount, shortAddress } from "../lib/format";
import { Button, Card, DetailRow, ErrorNote, Spinner } from "../components/ui";
import type { AppSettings, PaymentIntent } from "../types";

export default function Confirm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [phase, setPhase] = useState<"loading" | "review" | "signing" | "settling" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, cfg] = await Promise.all([api.getIntent(id!), api.settings()]);
      setIntent(res.intent);
      setSettings(cfg);
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

  async function confirmAndSign() {
    if (!intent) return;
    setError(null);
    setPhase("signing");
    try {
      // 1. Explicit confirmation (idempotent) — deterministic pipeline only.
      await api.confirmIntent(intent.id);
      // 2. Backend builds the exact USDC transferChecked transaction.
      const built = await api.buildTransaction(intent.id);
      // 3. Wallet signature — client-side only, never automatic.
      const provider = getWalletProvider();
      if (!provider) throw new Error("No Solana wallet detected. Install Phantom and reload.");
      const tx = Transaction.from(base64ToBytes(built.transactionBase64));
      const signed = await provider.signTransaction(tx);
      // 4. Backend submits and waits for real Solana confirmation.
      setPhase("settling");
      const res = await api.executeIntent(intent.id, bytesToBase64(signed.serialize()));
      setIntent(res.intent);
      setPhase("done");
    } catch (e) {
      const rejected = isWalletRejection(e);
      setError(
        rejected
          ? "You rejected the signature request. The payment was not sent."
          : e instanceof Error
            ? e.message
            : "Something went wrong."
      );
      setPhase("review");
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

  // Policy rejection
  if (intent.status === "REJECTED") {
    return (
      <Card className="stack-sm">
        <h1 className="page-title">Payment rejected</h1>
        <ErrorNote>{intent.policyResult?.message ?? "This payment was rejected by your spending policy."}</ErrorNote>
        <p className="micro">Reason code: {intent.policyResult?.reasonCode}</p>
        <div className="btn-row">
          <Button variant="secondary" onClick={() => navigate("/policy")}>Review policy</Button>
          <Button onClick={() => navigate("/pay")}>New payment</Button>
        </div>
      </Card>
    );
  }

  if (intent.status === "EXPIRED" || intent.status === "CANCELLED") {
    return (
      <Card className="stack-sm">
        <h1 className="page-title">{intent.status === "EXPIRED" ? "This payment expired" : "Payment cancelled"}</h1>
        <p className="empty">
          {intent.status === "EXPIRED"
            ? "Payment intents expire after 5 minutes. Create a new one if you still want to pay."
            : "This payment intent was cancelled. Nothing was sent."}
        </p>
        <Button block onClick={() => navigate("/pay")}>Create a new payment</Button>
      </Card>
    );
  }

  // Terminal result
  if (phase === "done") {
    if (intent.status === "SETTLED") {
      return (
        <Card className="stack-sm">
          <div className="success-icon" aria-hidden>✓</div>
          <h1 className="page-title centered">Payment settled</h1>
          <p className="hero-amount">
            {prettyAmount(intent.amountDisplay)} USDC<br />
            <span className="hero-recipient">to {intent.recipientName}</span>
          </p>
          {intent.transactionSignature ? (
            <a
              className="link centered"
              href={explorerTxUrl(intent.transactionSignature, settings?.network ?? "devnet")}
              target="_blank"
              rel="noreferrer"
            >
              View on Solana Explorer ↗
            </a>
          ) : null}
          <Button block onClick={() => navigate("/activity")}>Done</Button>
        </Card>
      );
    }
    if (intent.status === "FAILED") {
      return (
        <Card className="stack-sm">
          <h1 className="page-title">Payment failed</h1>
          <ErrorNote>{intent.failureReason ?? "The transaction failed."}</ErrorNote>
          <Button block onClick={() => navigate("/pay")}>Create a new payment</Button>
        </Card>
      );
    }
  }

  if (phase === "signing") return <Spinner label="Waiting for your wallet signature…" />;
  if (phase === "settling") return <Spinner label="Settling on Solana…" />;

  // Confirmation screen (security-critical)
  return (
    <Card className="stack-sm">
      <h1 className="page-title">Confirm payment</h1>
      <div className="detail-stack">
        <DetailRow label="Recipient" value={intent.recipientName} />
        <DetailRow label="Wallet" value={shortAddress(intent.recipientWallet)} mono />
        <DetailRow label="Amount" value={<strong>{prettyAmount(intent.amountDisplay)} USDC</strong>} />
        <DetailRow label="Memo" value={intent.memo ?? "—"} />
        <DetailRow label="Network" value={`Solana (${settings?.network ?? "devnet"})`} />
        <DetailRow label="Estimated network fee" value={intent.recipientWallet ? "≈0.000005 SOL" : "—"} />
      </div>
      <p className="micro">Pact never sees your private keys. Signing happens in your wallet.</p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="btn-row">
        <Button variant="secondary" onClick={cancel}>Cancel</Button>
        <Button onClick={confirmAndSign}>Confirm &amp; Sign</Button>
      </div>
    </Card>
  );
}
