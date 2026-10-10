import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { api } from "../lib/api";
import { base64ToBytes, bytesToBase64, getWalletProvider } from "../features/wallet/wallet";
import { formatBase, shortAddress } from "../lib/format";
import { Button, Card, DetailRow, ErrorNote, Icon, Spinner } from "./ui";
import type { OnchainPolicyStatus, Policy } from "../types";

/**
 * On-chain enforcement card: shows the live policy-program state for the
 * connected wallet and offers one-tap initialization (wallet signs).
 * Rendered only when the backend is configured with a program id.
 */
export default function OnchainPolicyCard({
  address,
  policy,
  recipientWallets,
}: {
  address: string;
  policy: Policy;
  recipientWallets: string[];
}) {
  const [status, setStatus] = useState<OnchainPolicyStatus | null>(null);
  const [agent, setAgent] = useState(address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.getOnchainPolicy(address));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load on-chain policy.");
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  async function enable() {
    setError(null);
    setNotice(null);
    if (recipientWallets.length > 16) {
      setError("The on-chain allowlist fits at most 16 recipients. Remove some first.");
      return;
    }
    const provider = getWalletProvider();
    if (!provider) {
      setError("No Solana wallet detected. Install Phantom and reload.");
      return;
    }
    setBusy(true);
    try {
      const built = await api.buildOnchainInit({
        ownerWallet: address,
        agent: agent.trim() || address,
        maxPaymentAmount: policy.maxPaymentAmount,
        dailyLimit: policy.dailyLimit,
        allowedRecipients: recipientWallets.slice(0, 16),
      });
      const signed = await provider.signTransaction(
        Transaction.from(base64ToBytes(built.transactionBase64))
      );
      const res = await api.submitOnchainTx(bytesToBase64(signed.serialize()));
      setNotice(
        res.confirmed
          ? "On-chain policy active. Fund the vault to start paying through the program."
          : "Transaction submitted but not yet confirmed. Refresh in a moment."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable on-chain enforcement.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <section className="card">
        <Spinner label="Loading on-chain policy…" />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </section>
    );
  }

  const tone = !status.initialized ? "gray" : status.revoked ? "red" : status.paused ? "amber" : "green";
  const stateLabel = !status.initialized
    ? "Not enabled"
    : status.revoked
      ? "Revoked"
      : status.paused
        ? "Paused"
        : "Active";

  return (
    <section className="card">
      <div className="row">
        <h2 className="card-title">On-chain enforcement</h2>
        <span className={`badge badge-${tone}`}>{stateLabel}</span>
      </div>
      <p className="micro">
        Vault USDC can only move through the Pact policy program — a compromised agent or backend
        cannot bypass these limits with a direct transfer.
      </p>
      <DetailRow label="Program" mono value={shortAddress(status.programId ?? "", 6)} />
      {status.policy ? <DetailRow label="Policy" mono value={shortAddress(status.policy, 6)} /> : null}
      {status.vault ? <DetailRow label="Vault" mono value={shortAddress(status.vault, 6)} /> : null}

      {status.initialized ? (
        <>
          <DetailRow label="Agent" mono value={shortAddress(status.agent ?? "", 6)} />
          <DetailRow
            label="Spent in window"
            value={`${formatBase(BigInt(status.spentInWindow ?? "0"))} / ${formatBase(BigInt(status.windowLimit ?? "0"))} USDC`}
          />
          <DetailRow
            label="Vault balance"
            value={`${formatBase(BigInt(status.vaultBalanceBaseUnits ?? "0"))} USDC`}
          />
          <p className="micro">
            Fund the vault with a plain USDC transfer to the address above (devnet USDC:
            faucet.circle.com). Payments draw from the vault, never from your personal balance.
          </p>
        </>
      ) : (
        <>
          <div className="rule-value">
            <input
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              aria-label="Authorized agent address"
              spellCheck={false}
            />
            <span className="unit">agent</span>
          </div>
          <p className="micro">
            Initializes an on-chain policy from your current rules ({policy.maxPaymentAmount} USDC
            max, {policy.dailyLimit} USDC/day). Defaults to your own wallet as the agent.
          </p>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {notice ? <p className="micro ok">{notice}</p> : null}
          <Button block onClick={enable} disabled={busy}>
            <Icon name="shield_lock" /> {busy ? "Waiting for wallet…" : "Enable on-chain policy"}
          </Button>
        </>
      )}
    </section>
  );
}
