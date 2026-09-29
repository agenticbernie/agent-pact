import { Button, Icon } from "./ui";

/** Shown while the wallet's own approval prompt is open. Never fakes an approval. */
export default function WalletSigningModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Waiting for wallet">
      <div className="sheet">
        <div className="sheet-icon">
          <Icon name="account_balance_wallet" />
        </div>
        <div className="centered">
          <h2 className="section-title">Waiting for wallet</h2>
          <p className="page-sub">Check your connected wallet to approve the transaction.</p>
        </div>
        <div className="spinner-wrap" style={{ padding: 0 }}>
          <span className="spinner" />
        </div>
        <p className="micro centered">
          Dismissing stops Pact from submitting this payment, even if you approve in your wallet later.
        </p>
        <Button variant="secondary" block onClick={onDismiss}>
          Dismiss request
        </Button>
      </div>
    </div>
  );
}
