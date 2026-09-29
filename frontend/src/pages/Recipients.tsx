import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "../features/wallet/WalletContext";
import { api } from "../lib/api";
import { shortAddress } from "../lib/format";
import { Button, Card, ErrorNote, Field, Spinner } from "../components/ui";
import type { Recipient } from "../types";

export default function Recipients() {
  const { address } = useWallet();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    api
      .listRecipients(address)
      .then((r) => setRecipients(r.recipients))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load recipients."))
      .finally(() => setLoading(false));
  }, [address]);

  async function add() {
    setError(null);
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(wallet.trim());
    } catch {
      setError("Enter a valid Solana wallet address.");
      return;
    }
    setSaving(true);
    try {
      const { recipient } = await api.addRecipient({
        ownerWallet: address!,
        name: name.trim(),
        walletAddress: pubkey.toBase58(),
      });
      setRecipients((prev) => [...prev, recipient]);
      setName("");
      setWallet("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the recipient.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(recipient: Recipient) {
    try {
      await api.deleteRecipient(address!, recipient.id);
      setRecipients((prev) => prev.filter((r) => r.id !== recipient.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the recipient.");
    }
  }

  if (!address) {
    return (
      <Card>
        <h1 className="page-title">Recipients</h1>
        <p className="empty">Connect your wallet to manage recipients.</p>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card className="stack-sm">
        <h1 className="page-title">Recipients</h1>
        {loading ? <Spinner /> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {!loading && recipients.length === 0 ? <p className="empty">No saved recipients yet.</p> : null}
        <ul className="tx-list">
          {recipients.map((r) => (
            <li key={r.id} className="tx-row">
              <div className="tx-main">
                <span className="tx-name">{r.name}</span>
                <span className="tx-sub mono">{shortAddress(r.walletAddress)}</span>
              </div>
              <button className="link danger" onClick={() => remove(r)} type="button">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="stack-sm">
        <h2 className="card-title">Add recipient</h2>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && wallet.trim()) add();
          }}
        >
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="Felix" />
          </Field>
          <Field label="Solana wallet address">
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="7xA…" />
          </Field>
          <Button block disabled={saving || !name.trim() || !wallet.trim()}>
            {saving ? "Saving…" : "Add recipient"}
          </Button>
        </form>
        <p className="micro">Pact only resolves recipients you saved. AI can never invent a wallet address.</p>
      </Card>
    </div>
  );
}
