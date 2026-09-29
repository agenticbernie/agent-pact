import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { AMOUNT_RE, formatBase, networkName, percentOf, toBaseUnits } from "../lib/format";
import { settledTodayBase } from "../lib/usage";
import { useSettings } from "../lib/useSettings";
import { Button, Card, ErrorNote, Icon, ProgressBar, Spinner } from "../components/ui";
import type { Policy, Recipient } from "../types";

type Mode = "everyone" | "saved";

export default function PolicyPage() {
  const { address } = useWallet();
  const settings = useSettings();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [usedToday, setUsedToday] = useState<bigint>(0n);
  const [maxAmount, setMaxAmount] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [mode, setMode] = useState<Mode>("everyone");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPolicy(p: Policy) {
    setPolicy(p);
    setMaxAmount(p.maxPaymentAmount);
    setDailyLimit(p.dailyLimit);
    setMode(p.allowedRecipients.length > 0 ? "saved" : "everyone");
  }

  useEffect(() => {
    if (!address) return;
    Promise.all([api.getPolicy(address), api.listRecipients(address), api.listIntents(address)])
      .then(([p, r, i]) => {
        applyPolicy(p.policy);
        setRecipients(r.recipients);
        setUsedToday(settledTodayBase(i.intents));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your payment rules."));
  }, [address]);

  if (!address) {
    return (
      <>
        <h1 className="page-title">Payment controls</h1>
        <Card>
          <p className="empty">Connect your wallet to configure your payment rules.</p>
        </Card>
      </>
    );
  }

  if (!policy) {
    return (
      <>
        <h1 className="page-title">Payment controls</h1>
        <Spinner label="Loading payment rules…" />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </>
    );
  }

  const initialMode: Mode = policy.allowedRecipients.length > 0 ? "saved" : "everyone";
  const dirty = maxAmount !== policy.maxPaymentAmount || dailyLimit !== policy.dailyLimit || mode !== initialMode;

  const validDaily = AMOUNT_RE.test(dailyLimit);
  const dailyBase = validDaily ? toBaseUnits(dailyLimit) : 0n;
  const remaining = dailyBase > usedToday ? dailyBase - usedToday : 0n;

  async function save() {
    setError(null);
    setSaved(false);
    if (!AMOUNT_RE.test(maxAmount) || !AMOUNT_RE.test(dailyLimit)) {
      setError("Limits must be USDC amounts with up to 6 decimal places.");
      return;
    }
    if (mode === "saved" && recipients.length === 0) {
      setError("Save at least one recipient before restricting payments to saved recipients.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updatePolicy({
        ownerWallet: address!,
        maxPaymentAmount: maxAmount,
        dailyLimit,
        allowedRecipients: mode === "saved" ? recipients.map((r) => r.walletAddress) : [],
        requireConfirmation: true,
      });
      applyPolicy(res.policy);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your payment rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div>
        <h1 className="page-title">Payment controls</h1>
        <p className="page-sub">Pact checks every payment against these rules before asking for your approval.</p>
      </div>

      <section className="card low">
        <div className="rule-title">
          <span className="rule-icon">
            <Icon name="shield" />
          </span>
          <div>
            <h2 className="card-title">Payment rules</h2>
            <p className="micro">Limits and recipients Pact enforces on every payment.</p>
          </div>
        </div>
      </section>

      {/* Rule 1 */}
      <section className="card">
        <div className="rule-title">
          <span className="rule-icon">
            <Icon name="payments" />
          </span>
          <div>
            <h2 className="card-title">Per-payment limit</h2>
            <p className="micro">Maximum amount per transaction</p>
          </div>
        </div>
        <div className="rule-value">
          <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="decimal" aria-label="Per-payment limit" />
          <span className="unit">USDC</span>
        </div>
      </section>

      {/* Rule 2 */}
      <section className="card">
        <div className="rule-title">
          <span className="rule-icon">
            <Icon name="calendar_today" />
          </span>
          <div>
            <h2 className="card-title">Daily spending limit</h2>
            <p className="micro">Maximum amount you can spend per day</p>
          </div>
        </div>
        <div className="rule-value">
          <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} inputMode="decimal" aria-label="Daily spending limit" />
          <span className="unit">USDC</span>
        </div>
        <ProgressBar percent={percentOf(usedToday, dailyBase)} />
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <div className="micro">Used today</div>
            <strong className="num">{formatBase(usedToday)} USDC</strong>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="micro">Remaining today</div>
            <strong className="num cyan">{formatBase(remaining)} USDC</strong>
          </div>
        </div>
      </section>

      {/* Rule 3 */}
      <section className="card">
        <div className="rule-title">
          <span className="rule-icon">
            <Icon name="group" />
          </span>
          <div>
            <h2 className="card-title">Allowed recipients</h2>
            <p className="micro">Who Pact can send payments to</p>
          </div>
        </div>
        <div className="segmented" role="tablist">
          <button type="button" className={`seg ${mode === "everyone" ? "on" : ""}`} onClick={() => setMode("everyone")}>
            <Icon name="public" /> Everyone
          </button>
          <button type="button" className={`seg ${mode === "saved" ? "on" : ""}`} onClick={() => setMode("saved")}>
            <Icon name="bookmark" /> Saved recipients only
          </button>
        </div>
        <p className="micro">
          {mode === "everyone"
            ? "Anyone with a valid Solana recipient address may receive a payment."
            : "Only recipients saved in Pact can receive payments."}{" "}
          <Link to="/recipients" className="link">
            Manage recipients
          </Link>
        </p>
      </section>

      {/* Rule 4 */}
      <section className="immutable">
        <div className="row">
          <div className="rule-title">
            <span className="rule-icon">
              <Icon name="fingerprint" />
            </span>
            <div>
              <h2 className="card-title">Require confirmation</h2>
              <p className="micro">Explicit approval required · Immutable</p>
            </div>
          </div>
          <span className="pill-on">
            <Icon name="lock" /> Always On
          </span>
        </div>
        <div className="inset" style={{ marginTop: 12 }}>
          <p className="micro" style={{ color: "var(--text-2)" }}>
            Every Pact payment requires your explicit approval. AI agents can never sign on your behalf. This
            setting cannot be disabled.
          </p>
        </div>
      </section>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {saved ? <p className="micro ok">Payment rules saved.</p> : null}
      <Button block onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save changes"}
      </Button>

      <section className="card low">
        <h2 className="date-head">System status</h2>
        <div className="status-grid">
          <div>
            <div className="k">Parser</div>
            <div className="v">OpenRouter / Nemotron</div>
          </div>
          <div>
            <div className="k">Execution</div>
            <div className="v">{networkName(settings?.network)} · Non-custodial</div>
          </div>
        </div>
      </section>
    </>
  );
}
