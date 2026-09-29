import { shortAddress } from "../lib/format";

export default function BalanceDisplay({
  amount,
  network,
  address,
}: {
  amount: string;
  network: string;
  address: string | null;
}) {
  return (
    <section className="balance">
      <span className="eyebrow">Available USDC</span>
      <div className="balance-value">
        <span className="amt">{amount}</span>
        <span className="unit">USDC</span>
      </div>
      <span className="chip">
        <span className="dot" />
        {network}
        {address ? ` • ${shortAddress(address, 3)}` : ""}
      </span>
    </section>
  );
}
