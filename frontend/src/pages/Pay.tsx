import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "../features/wallet/WalletContext";
import { api, type CreateIntentInput } from "../lib/api";
import { AMOUNT_RE } from "../lib/format";
import { Button, Card, ErrorNote, Field, InfoNote, Spinner } from "../components/ui";
import type { ParsedPaymentIntent, Recipient } from "../types";

export default function Pay() {
  const { address } = useWallet();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialAsk = params.get("ask");
  const [tab, setTab] = useState<"ask" | "manual">(initialAsk ? "ask" : "manual");

  // Clear the query param so refresh doesn't re-trigger parsing.
  useEffect(() => {
    if (initialAsk) navigate("/pay", { replace: true });
  }, [initialAsk, navigate]);

  if (!address) {
    return (
      <Card>
        <h1 className="page-title">Pay</h1>
        <p className="empty">Connect your Solana wallet to make a payment.</p>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "ask"}
          className={`tab ${tab === "ask" ? "tab-active" : ""}`}
          onClick={() => setTab("ask")}
        >
          Ask Pact
        </button>
        <button
          role="tab"
          aria-selected={tab === "manual"}
          className={`tab ${tab === "manual" ? "tab-active" : ""}`}
          onClick={() => setTab("manual")}
        >
          Manual
        </button>
      </div>
      {tab === "ask" ? <AskFlow address={address} initialMessage={initialAsk ?? ""} /> : <ManualFlow address={address} />}
    </div>
  );
}

/* ------------------------------ Ask Pact ------------------------------ */

type AskStep =
  | { kind: "input" }
  | { kind: "parsing" }
  | { kind: "failed"; message: string }
  | { kind: "unsupported" }
  | { kind: "clarify"; parsed: ParsedPaymentIntent; field: "amount" | "recipient"; value: string }
  | { kind: "no-recipient"; parsed: ParsedPaymentIntent; name: string }
  | { kind: "ambiguous"; parsed: ParsedPaymentIntent; candidates: Recipient[] }
  | { kind: "preview"; parsed: ParsedPaymentIntent; recipient: Recipient }
  | { kind: "creating" };

function AskFlow({ address, initialMessage }: { address: string; initialMessage: string }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState(initialMessage);
  const [step, setStep] = useState<AskStep>({ kind: "input" });
  const startedRef = useRef(false);

  useEffect(() => {
    if (initialMessage && !startedRef.current) {
      startedRef.current = true;
      runParse(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runParse(text: string) {
    setStep({ kind: "parsing" });
    try {
      const { intent: parsed } = await api.parsePayment(text);
      await advance(parsed, text);
    } catch (e) {
      setStep({ kind: "failed", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  async function advance(parsed: ParsedPaymentIntent, prompt: string) {
    if (parsed.action !== "PAYMENT") {
      setStep({
        kind: "failed",
        message: 'I couldn\'t understand that payment request. Try something like "Pay Felix 3 USDC for coffee".',
      });
      return;
    }
    if (parsed.token !== "USDC" || parsed.missingFields.includes("token")) {
      setStep({ kind: "unsupported" });
      return;
    }
    if (parsed.amount == null || parsed.missingFields.includes("amount")) {
      setStep({ kind: "clarify", parsed, field: "amount", value: "" });
      return;
    }
    if (parsed.recipientInput == null || parsed.missingFields.includes("recipient")) {
      setStep({ kind: "clarify", parsed, field: "recipient", value: "" });
      return;
    }
    await resolveRecipient(parsed, prompt);
  }

  async function resolveRecipient(parsed: ParsedPaymentIntent, prompt: string, listOverride?: Recipient[]) {
    const { recipients } = await api.listRecipients(address);
    const list = listOverride ?? recipients;
    const q = (parsed.recipientInput ?? "").toLowerCase();
    const exact = list.filter((r) => r.name.toLowerCase() === q);
    const prefix = list.filter((r) => r.name.toLowerCase().startsWith(q));
    const candidates = exact.length ? exact : prefix;
    if (candidates.length === 0) {
      setStep({ kind: "no-recipient", parsed, name: parsed.recipientInput ?? q });
      return;
    }
    if (candidates.length > 1) {
      setStep({ kind: "ambiguous", parsed, candidates });
      return;
    }
    setStep({ kind: "preview", parsed, recipient: candidates[0] });
  }

  async function createAndGo(parsed: ParsedPaymentIntent, recipient: Recipient, prompt: string) {
    setStep({ kind: "creating" });
    const input: CreateIntentInput = {
      payerWallet: address,
      recipientId: recipient.id,
      amount: parsed.amount!,
      memo: parsed.memo,
      aiSource: { originalPrompt: prompt, confidence: parsed.confidence },
    };
    try {
      const { intent } = await api.createIntent(input);
      navigate(`/confirm/${intent.id}`);
    } catch (e) {
      setStep({ kind: "failed", message: e instanceof Error ? e.message : "Could not create the payment." });
    }
  }

  if (step.kind === "parsing") return <Spinner label="Understanding your request…" />;
  if (step.kind === "creating") return <Spinner label="Creating payment…" />;

  if (step.kind === "failed") {
    return (
      <Card className="stack-sm">
        <ErrorNote>{step.message}</ErrorNote>
        <Button variant="secondary" onClick={() => setStep({ kind: "input" })}>Try again</Button>
      </Card>
    );
  }

  if (step.kind === "unsupported") {
    return (
      <Card className="stack-sm">
        <ErrorNote>Only USDC payments are supported. Ask Pact does not convert currencies.</ErrorNote>
        <Button variant="secondary" onClick={() => setStep({ kind: "input" })}>Start over</Button>
      </Card>
    );
  }

  if (step.kind === "clarify") {
    return (
      <ClarifyStep
        step={step}
        onAmount={(value) => {
          const parsed = { ...step.parsed, amount: value, missingFields: step.parsed.missingFields.filter((f) => f !== "amount") };
          advance(parsed, message);
        }}
        onRecipient={(recipient) => {
          const parsed = { ...step.parsed, recipientInput: recipient.name, missingFields: step.parsed.missingFields.filter((f) => f !== "recipient") };
          resolveRecipient(parsed, message);
        }}
        address={address}
      />
    );
  }

  if (step.kind === "no-recipient") {
    return (
      <NoRecipientStep
        name={step.name}
        address={address}
        onSaved={(list, savedName) => {
          const parsed = { ...step.parsed, recipientInput: savedName };
          resolveRecipient(parsed, message, list);
        }}
      />
    );
  }

  if (step.kind === "ambiguous") {
    return (
      <Card className="stack-sm">
        <h2 className="card-title">Which {step.parsed.recipientInput} do you mean?</h2>
        {step.candidates.map((c) => (
          <Button key={c.id} variant="secondary" block onClick={() => setStep({ kind: "preview", parsed: step.parsed, recipient: c })}>
            {c.name}
          </Button>
        ))}
      </Card>
    );
  }

  if (step.kind === "preview") {
    return (
      <Card className="stack-sm">
        <h2 className="card-title">I understood:</h2>
        <div className="detail-stack">
          <div className="detail-row"><span className="detail-label">Recipient</span><span className="detail-value">{step.recipient.name}</span></div>
          <div className="detail-row"><span className="detail-label">Amount</span><span className="detail-value">{step.parsed.amount} USDC</span></div>
          <div className="detail-row"><span className="detail-label">For</span><span className="detail-value">{step.parsed.memo ?? "—"}</span></div>
        </div>
        {step.parsed.confidence < 0.5 ? <InfoNote>Low confidence — please double-check these details.</InfoNote> : null}
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setStep({ kind: "input" })}>Back</Button>
          <Button onClick={() => createAndGo(step.parsed, step.recipient, message)}>Continue</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="stack-sm">
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) runParse(message.trim());
        }}
      >
        <Field label="What do you want to pay?">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Pay Felix 3 USDC for coffee"
            rows={3}
            maxLength={500}
          />
        </Field>
        <Button block disabled={!message.trim()}>Continue</Button>
      </form>
      <p className="micro">AI parses intent only. Nothing is sent without your explicit confirmation.</p>
    </Card>
  );
}

function ClarifyStep({
  step,
  onAmount,
  onRecipient,
  address,
}: {
  step: Extract<AskStep, { kind: "clarify" }>;
  onAmount: (value: string) => void;
  onRecipient: (recipient: Recipient) => void;
  address: string;
}) {
  const [value, setValue] = useState(step.value);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step.field === "recipient") {
      api.listRecipients(address).then((r) => setRecipients(r.recipients)).catch(() => {});
    }
  }, [step.field, address]);

  const amountInvalid = step.field === "amount" && value.length > 0 && !AMOUNT_RE.test(value);

  return (
    <Card className="stack-sm">
      {step.field === "amount" ? (
        <>
          <h2 className="card-title">
            How much USDC do you want to send{step.parsed.recipientInput ? ` to ${step.parsed.recipientInput}` : ""}?
          </h2>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!AMOUNT_RE.test(value)) {
                setError("Enter an amount with up to 6 decimal places.");
                return;
              }
              onAmount(value);
            }}
          >
            <Field label="Amount (USDC)">
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="3" autoFocus />
            </Field>
            {amountInvalid ? <ErrorNote>Up to 6 decimal places, e.g. 3.25</ErrorNote> : null}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <Button block>Continue</Button>
          </form>
        </>
      ) : (
        <>
          <h2 className="card-title">Who do you want to pay?</h2>
          {recipients.length === 0 ? (
            <p className="empty">No saved recipients yet — add one on the Recipients screen.</p>
          ) : (
            recipients.map((r) => (
              <Button key={r.id} variant="secondary" block onClick={() => onRecipient(r)}>
                {r.name}
              </Button>
            ))
          )}
        </>
      )}
    </Card>
  );
}

function NoRecipientStep({
  name,
  address,
  onSaved,
}: {
  name: string;
  address: string;
  onSaved: (list: Recipient[], savedName: string) => void;
}) {
  const [wallet, setWallet] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
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
        ownerWallet: address,
        name,
        walletAddress: pubkey.toBase58(),
      });
      const list = await api.listRecipients(address);
      onSaved(list.recipients, recipient.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the recipient.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="stack-sm">
      <ErrorNote>I don&apos;t have a wallet saved for {name}. Add their Solana wallet address to continue.</ErrorNote>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label={`Wallet address for ${name}`}>
          <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Solana wallet address" autoFocus />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button block disabled={saving || !wallet.trim()}>
          {saving ? "Saving…" : `Save ${name} and continue`}
        </Button>
      </form>
    </Card>
  );
}

/* ------------------------------ Manual ------------------------------ */

function ManualFlow({ address }: { address: string }) {
  const navigate = useNavigate();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRecipients(address)
      .then((r) => {
        setRecipients(r.recipients);
        if (r.recipients.length === 1) setRecipientId(r.recipients[0].id);
      })
      .catch(() => {});
  }, [address]);

  async function submit() {
    setError(null);
    if (!recipientId) return setError("Choose a recipient.");
    if (!AMOUNT_RE.test(amount)) return setError("Enter an amount with up to 6 decimal places, e.g. 3.25.");
    setSubmitting(true);
    try {
      const { intent } = await api.createIntent({
        payerWallet: address,
        recipientId,
        amount,
        memo: memo.trim() || null,
      });
      navigate(`/confirm/${intent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="stack-sm">
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Recipient">
          {recipients.length === 0 ? (
            <p className="empty">
              No saved recipients yet. <a href="/recipients" className="link">Add a recipient</a> to start paying.
            </p>
          ) : (
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
              <option value="">Choose a recipient…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Amount (USDC)" hint="Up to 6 decimal places">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="3.00" />
        </Field>
        <Field label="Memo (optional)">
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={140} placeholder="Coffee" />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button block disabled={submitting || !recipientId || !amount}>
          {submitting ? "Creating…" : "Continue to confirmation"}
        </Button>
      </form>
      <p className="micro">Token is fixed: USDC on Solana.</p>
    </Card>
  );
}
