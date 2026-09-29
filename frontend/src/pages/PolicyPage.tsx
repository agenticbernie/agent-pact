import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { AMOUNT_RE } from "../lib/format";
import { Button, Card, ErrorNote, Field, Spinner } from "../components/ui";
import type { Policy, Recipient } from "../types";

export default function PolicyPage() {
  const { address } = useWallet();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [maxAmount, setMaxAmount] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    Promise.all([api.getPolicy(address), api.listRecipients(address)])
      .then(([p, r]) => {
        setPolicy(p.policy);
        setMaxAmount(p.policy.maxPaymentAmount);
        setDailyLimit(p.policy.dailyLimit);
        setAllowed(p.policy.allowedRecipients);
        setRecipients(r.recipients);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your policy."));
  }, [address]);

  if (!address) {
    return (
      <Card>
        <h1 className="page-title">Payment policy</h1>
        <p className="empty">Connect your wallet to configure your spending policy.</p>
      </Card>
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    if (!AMOUNT_RE.test(maxAmount) || !AMOUNT_RE.test(dailyLimit)) {
      setError("Limits must be USDC amounts with up to 6 decimal places.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updatePolicy({
        ownerWallet: address,
        maxPaymentAmount: maxAmount,
        dailyLimit,
        allowedRecipients: allowed,
        requireConfirmation: true,
      });
      setPolicy(res.policy);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your policy.");
    } finally {
      setSaving(false);
    }
  }

  if (!policy) {
    return (
      <Card>
        <Spinner label="Loading policy…" />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Card>
    );
  }

  return (
    <Card className="stack-sm">
      <h1 className="page-title">Payment policy</h1>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Maximum single payment (USDC)">
          <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Daily spending limit (USDC)" hint="Sum of settled payments per UTC day">
          <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Allowed recipients">
          {recipients.length === 0 ? (
            <p className="empty">
              No saved recipients. <Link to="/recipients" className="link">Manage recipients</Link>.<br />
              With no selection, payments to any saved recipient are allowed.
            </p>
          ) : (
            <div className="check-list">
              {recipients.map((r) => (
                <label key={r.id} className="check-item">
                  <input
                    type="checkbox"
                    checked={allowed.includes(r.walletAddress)}
                    onChange={(e) =>
                      setAllowed((prev) =>
                        e.target.checked
                          ? [...prev, r.walletAddress]
                          : prev.filter((a) => a !== r.walletAddress)
                      )
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
          )}
        </Field>
        <div className="confirm-toggle">
          <div>
            <span className="field-label">Require confirmation</span>
            <p className="micro">Every Pact payment requires your explicit confirmation. This cannot be disabled.</p>
          </div>
          <span className="badge badge-green">ON</span>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {saved ? <p className="micro ok">Policy saved.</p> : null}
        <Button block disabled={saving}>{saving ? "Saving…" : "Save policy"}</Button>
      </form>
    </Card>
  );
}
