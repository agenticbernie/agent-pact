import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { store } from "../db/store";
import { parseUsdc } from "../lib/usdc/parse";
import {
  base58Address,
  ExecuteIntentSchema,
  InitOnchainPolicySchema,
  UpdatePolicySchema,
} from "../lib/validation/schemas";
import {
  buildInitializePolicyIx,
  buildUnsignedTransaction,
  fetchOnchainPolicy,
  findPolicyPda,
  isPolicyProgramEnabled,
  policyProgramId,
  submitSignedPolicyTransaction,
  vaultBalanceBaseUnits,
  vaultInfoForOwner,
} from "../services/solana/policyProgram";
import { usdcMint } from "../services/solana/connection";
import { wrap } from "./ai";

export const policyRouter = Router();

policyRouter.get(
  "/",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    res.json({ policy: store.getPolicy(owner) });
  })
);

/**
 * On-chain vault addresses for the policy program path.
 * 200 with `programId: null` when the program is not configured.
 */
policyRouter.get(
  "/vault",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    const info = vaultInfoForOwner(owner);
    if (!info) {
      res.json({ programId: null });
      return;
    }
    res.json(info);
  })
);

/**
 * On-chain policy status: derived addresses plus live chain state.
 * `{ initialized: false }` when the owner has no policy account yet.
 */
policyRouter.get(
  "/onchain",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    const info = vaultInfoForOwner(owner);
    if (!info) {
      res.status(501).json({ error: "PROGRAM_NOT_CONFIGURED", message: "On-chain policy program is not configured." });
      return;
    }
    const programId = policyProgramId();
    if (!programId) {
      res.status(501).json({ error: "PROGRAM_NOT_CONFIGURED", message: "On-chain policy program is not configured." });
      return;
    }
    const policy = new PublicKey(info.policy);
    const state = await fetchOnchainPolicy(policy);
    if (!state) {
      res.json({ ...info, initialized: false as const });
      return;
    }
    const vaultBalance = await vaultBalanceBaseUnits(new PublicKey(info.vault));
    res.json({
      ...info,
      initialized: true as const,
      agent: state.agent.toBase58(),
      paused: state.paused,
      revoked: state.revoked,
      expiresAt: state.expiresAt.toString(),
      maxPerPayment: state.maxPerPayment.toString(),
      windowLimit: state.windowLimit.toString(),
      spentInWindow: state.spentInWindow.toString(),
      vaultBalanceBaseUnits: vaultBalance === null ? null : vaultBalance.toString(),
    });
  })
);

/**
 * Build the unsigned `initialize_policy` transaction. The wallet signs;
 * submit via POST /onchain/submit. Prefill from the backend policy or send
 * explicit values.
 */
policyRouter.post(
  "/onchain/initialize",
  wrap(async (req, res) => {
    const input = InitOnchainPolicySchema.parse(req.body);
    const programId = policyProgramId();
    if (!programId || !isPolicyProgramEnabled()) {
      res.status(501).json({ error: "PROGRAM_NOT_CONFIGURED", message: "On-chain policy program is not configured." });
      return;
    }
    const owner = new PublicKey(input.ownerWallet);
    const policy = findPolicyPda(owner, programId);
    if (await fetchOnchainPolicy(policy)) {
      res.status(409).json({ error: "POLICY_ALREADY_EXISTS", message: "An on-chain policy already exists for this wallet." });
      return;
    }
    const expiresAt = BigInt(input.expiresAt ?? 0);
    if (expiresAt !== 0n && expiresAt * 1000n <= BigInt(Date.now())) {
      res.status(400).json({ error: "INVALID_EXPIRY", message: "Expiry must be 0 (never) or a future unix timestamp." });
      return;
    }
    let maxPerPayment: bigint;
    let windowLimit: bigint;
    try {
      maxPerPayment = parseUsdc(input.maxPaymentAmount);
      windowLimit = parseUsdc(input.dailyLimit);
    } catch {
      res.status(400).json({ error: "INVALID_AMOUNT", message: "Limits must be greater than zero." });
      return;
    }
    const ix = buildInitializePolicyIx({
      programId,
      owner,
      agent: new PublicKey(input.agent),
      mint: usdcMint(),
      policy,
      maxPerPayment,
      windowLimit,
      windowSeconds: BigInt(input.windowSeconds ?? 86_400),
      expiresAt,
      allowedRecipients: (input.allowedRecipients ?? []).map((a) => new PublicKey(a)),
    });
    const transactionBase64 = await buildUnsignedTransaction(owner, [ix]);
    res.status(201).json({ transactionBase64, policy: policy.toBase58() });
  })
);

/**
 * Submit a wallet-signed policy transaction (initialize / pause / revoke).
 * Returns the signature and whether the network confirmed it.
 */
policyRouter.post(
  "/onchain/submit",
  wrap(async (req, res) => {
    if (!isPolicyProgramEnabled()) {
      res.status(501).json({ error: "PROGRAM_NOT_CONFIGURED", message: "On-chain policy program is not configured." });
      return;
    }
    const { signedTransactionBase64 } = ExecuteIntentSchema.parse(req.body);
    res.json(await submitSignedPolicyTransaction(signedTransactionBase64));
  })
);

policyRouter.put(
  "/",
  wrap(async (req, res) => {
    const { ownerWallet, ...policy } = UpdatePolicySchema.parse(req.body);
    store.setPolicy(ownerWallet, policy);
    res.json({ policy: store.getPolicy(ownerWallet) });
  })
);
