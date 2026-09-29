import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDC_DECIMALS, formatUsdc } from "../../lib/usdc/parse";
import { getConnection, usdcMint } from "./connection";

/**
 * Solana/USDC service. Uses the SPL Token Program, Associated Token Account
 * Program and the configured USDC mint (6 decimals). Never trusts an
 * arbitrary destination token account — the destination is always the
 * recipient's canonical ATA derived from the USDC mint.
 */

export interface UsdcBalance {
  baseUnits: string;
  display: string;
  hasTokenAccount: boolean;
}

/** Read the payer's USDC balance directly from their SPL token accounts. */
export async function getUsdcBalance(owner: string): Promise<UsdcBalance> {
  const conn = getConnection();
  const mintStr = usdcMint().toBase58();
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: usdcMint(),
  });
  let total = 0n;
  let hasTokenAccount = false;
  for (const { account } of res.value) {
    const info = (
      account.data as {
        parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } };
      }
    ).parsed?.info;
    if (!info || info.mint !== mintStr) continue;
    if (info.tokenAmount?.decimals !== USDC_DECIMALS) {
      throw new Error("USDC mint decimals mismatch — refusing to read balance");
    }
    hasTokenAccount = true;
    total += BigInt(info.tokenAmount.amount ?? "0");
  }
  return { baseUnits: total.toString(), display: formatUsdc(total), hasTokenAccount };
}

export interface BuiltTransaction {
  transactionBase64: string;
  createsRecipientAta: boolean;
}

/**
 * Build an unsigned USDC `transferChecked` transaction:
 *   payer USDC ATA -> recipient canonical USDC ATA
 * creating the recipient ATA if it does not exist yet.
 */
export async function buildUsdcTransfer(
  payer: string,
  recipient: string,
  amountBaseUnits: bigint
): Promise<BuiltTransaction> {
  const conn = getConnection();
  const mint = usdcMint();
  const payerKey = new PublicKey(payer);
  const recipientKey = new PublicKey(recipient);

  const sourceAta = getAssociatedTokenAddressSync(mint, payerKey);
  const destAta = getAssociatedTokenAddressSync(mint, recipientKey);

  const destInfo = await conn.getAccountInfo(destAta);
  const createsRecipientAta = destInfo === null;

  const tx = new Transaction();
  if (createsRecipientAta) {
    tx.add(createAssociatedTokenAccountInstruction(payerKey, destAta, recipientKey, mint));
  }
  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      payerKey,
      amountBaseUnits,
      USDC_DECIMALS
    )
  );

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerKey;

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { transactionBase64: serialized.toString("base64"), createsRecipientAta };
}

/** Submit a wallet-signed transaction. Returns the on-chain signature. */
export async function submitSignedTransaction(signedBase64: string): Promise<string> {
  const conn = getConnection();
  const buf = Buffer.from(signedBase64, "base64");
  return conn.sendRawTransaction(buf, { skipPreflight: false });
}

export type ConfirmationResult = "confirmed" | "failed" | "timeout";

/** Poll Solana for real confirmation of the transaction. Never settle from frontend state alone. */
export async function awaitConfirmation(
  signature: string,
  timeoutMs = 45_000
): Promise<ConfirmationResult> {
  const conn = getConnection();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = res?.value?.[0];
      if (status?.err) return "failed";
      if (
        status &&
        (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
      ) {
        return "confirmed";
      }
    } catch {
      // transient RPC error — keep polling
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return "timeout";
}
