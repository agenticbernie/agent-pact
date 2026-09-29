import { Icon } from "./ui";

const STEPS = [
  "Payment confirmed",
  "Wallet signed",
  "Submitting to Solana",
  "Waiting for confirmation",
];

/**
 * Rendered only after the server confirmed the intent and the wallet returned a
 * real signature, while the API submits and polls Solana. "Settled" is never
 * shown here — only the server-confirmed result screen can show it.
 */
export default function PaymentProgress() {
  const active = 2;
  return (
    <div className="steps" aria-live="polite">
      {STEPS.map((label, i) => {
        const done = i < active;
        return (
          <div key={label} className={`step ${done ? "done" : ""} ${i === active ? "active" : ""}`}>
            <span className="step-mark">{done ? <Icon name="check" /> : null}</span>
            {label}
          </div>
        );
      })}
    </div>
  );
}
