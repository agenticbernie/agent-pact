import { prettyAmount, timeAgo } from "../lib/format";
import { StatusBadge } from "./ui";
import type { PaymentIntent } from "../types";

export default function TransactionRow({ intent }: { intent: PaymentIntent }) {
  const dim = intent.status !== "SETTLED";
  return (
    <div className="tx-row">
      <div className="tx-left">
        <div className="avatar">{(intent.recipientName || "?").charAt(0).toUpperCase()}</div>
        <div className="tx-main">
          <div className="tx-name-row">
            <span className="tx-name">{intent.recipientName}</span>
            <StatusBadge status={intent.status} />
          </div>
          <span className="tx-sub">{intent.memo ? `“${intent.memo}”` : "No memo"}</span>
        </div>
      </div>
      <div className="tx-side" style={dim ? { opacity: 0.75 } : undefined}>
        <span className="tx-amount">
          -{prettyAmount(intent.amountDisplay)} <small>USDC</small>
        </span>
        <span className="tx-time">{timeAgo(intent.createdAt)}</span>
      </div>
    </div>
  );
}
