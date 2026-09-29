import { Link } from "react-router-dom";
import { useWallet } from "../features/wallet/WalletContext";
import { networkName, shortAddress } from "../lib/format";
import { useSettings } from "../lib/useSettings";
import { DetailRow, Icon } from "../components/ui";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="date-head">{title}</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {children}
      </div>
    </section>
  );
}

export default function Settings() {
  const { address } = useWallet();
  const settings = useSettings();

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <Group title="Wallet">
        <DetailRow label="Connected wallet" value={address ? shortAddress(address, 3) : "Not connected"} mono />
        <DetailRow label="Network" value={networkName(settings?.network)} />
        <div className="detail-row">
          <span className="detail-label">
            <Icon name="group" /> Saved recipients
          </span>
          <Link to="/recipients" className="link">
            Manage
          </Link>
        </div>
      </Group>

      <Group title="AI">
        <DetailRow label="Provider" value="OpenRouter" />
        <DetailRow label="Model" value="Nemotron" />
        <DetailRow
          label="Status"
          value={
            <span className={`badge ${settings?.aiConfigured ? "badge-green" : "badge-amber"}`}>
              {settings ? (settings.aiConfigured ? "Ready" : "Unavailable") : "…"}
            </span>
          }
        />
      </Group>

      <Group title="Security">
        <DetailRow label="Payment confirmation" value="Always required" />
      </Group>

      <p className="micro">
        Pact never stores private keys or seed phrases. Signing always happens in your own wallet.
      </p>
    </>
  );
}
