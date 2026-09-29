import { Icon } from "./ui";

const SEED = "Pay Felix 3 USDC for coffee";

export default function AskPactInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section>
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" }}>Ask Pact</span>
        <span className="micro">Natural language intent</span>
      </div>
      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="ask-input-row">
          <span className="icon-tile">
            <Icon name="auto_awesome" />
          </span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Pay someone with Pact..."
            aria-label="Describe a payment"
            maxLength={500}
          />
          <button type="submit" className="icon-tile primary" disabled={!value.trim()} aria-label="Interpret request">
            <Icon name="arrow_forward" />
          </button>
        </div>
        <div className="ask-seed">
          <button type="button" className="seed-btn" onClick={() => onChange(SEED)}>
            Try: “{SEED}”
          </button>
        </div>
      </form>
      <div className="invariant">
        <Icon name="verified_user" />
        AI interprets. You confirm. Your wallet signs.
      </div>
    </section>
  );
}
