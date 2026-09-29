import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getConfig } from "../config/env";
import type { PaymentIntent, PaymentStatus, Policy, Recipient } from "../types";
import { assertTransition } from "../lib/payments/stateMachine";

interface PactData {
  version: 1;
  recipients: Recipient[];
  policies: Record<string, Policy>;
  intents: PaymentIntent[];
}

const DEFAULT_MAX_PAYMENT = "10";
const DEFAULT_DAILY_LIMIT = "50";

export class StoreError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/**
 * Simple JSON-file persistence (atomic writes). Single-process, synchronous —
 * adequate for the MVP. Never stores private keys or secrets, only
 * application state.
 */
export class PactStore {
  private data: PactData;
  private readonly file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "pact-store.json");
    this.data = this.load();
  }

  private load(): PactData {
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const parsed = JSON.parse(raw) as PactData;
      if (
        parsed &&
        parsed.version === 1 &&
        Array.isArray(parsed.recipients) &&
        Array.isArray(parsed.intents) &&
        typeof parsed.policies === "object"
      ) {
        return parsed;
      }
    } catch {
      // fresh store
    }
    return { version: 1, recipients: [], policies: {}, intents: [] };
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // ----- Recipients -----

  listRecipients(ownerWallet: string): Recipient[] {
    return this.data.recipients.filter((r) => r.ownerWallet === ownerWallet);
  }

  addRecipient(ownerWallet: string, name: string, walletAddress: string): Recipient {
    const exists = this.data.recipients.some(
      (r) => r.ownerWallet === ownerWallet && r.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      throw new StoreError("RECIPIENT_EXISTS", "A recipient with this name already exists.");
    }
    const recipient: Recipient = {
      id: crypto.randomUUID(),
      ownerWallet,
      name,
      walletAddress,
      createdAt: new Date().toISOString(),
    };
    this.data.recipients.push(recipient);
    this.save();
    return recipient;
  }

  deleteRecipient(ownerWallet: string, id: string): boolean {
    const before = this.data.recipients.length;
    this.data.recipients = this.data.recipients.filter(
      (r) => !(r.id === id && r.ownerWallet === ownerWallet)
    );
    if (this.data.recipients.length === before) return false;
    this.save();
    return true;
  }

  // ----- Policy -----

  getPolicy(ownerWallet: string): Policy {
    return (
      this.data.policies[ownerWallet] ?? {
        maxPaymentAmount: DEFAULT_MAX_PAYMENT,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        allowedRecipients: [],
        requireConfirmation: true,
      }
    );
  }

  setPolicy(ownerWallet: string, policy: Policy): void {
    this.data.policies[ownerWallet] = policy;
    this.save();
  }

  // ----- Payment intents -----

  createIntent(intent: PaymentIntent): void {
    this.data.intents.unshift(intent);
    this.save();
  }

  getIntent(id: string): PaymentIntent | undefined {
    return this.data.intents.find((i) => i.id === id);
  }

  listIntents(payerWallet: string): PaymentIntent[] {
    return this.data.intents.filter((i) => i.payerWallet === payerWallet);
  }

  /** Status transition with optimistic concurrency: fails if status changed since read. */
  updateIntent(id: string, from: PaymentStatus, to: PaymentStatus, patch: Partial<PaymentIntent>): PaymentIntent {
    const intent = this.getIntent(id);
    if (!intent) throw new StoreError("INTENT_NOT_FOUND", "Payment intent not found.");
    if (intent.status !== from) throw new StoreError("INTENT_STATUS_CHANGED", "Payment intent state changed. Refresh and try again.");
    assertTransition(from, to);
    const updated: PaymentIntent = { ...intent, ...patch, status: to };
    this.data.intents = this.data.intents.map((i) => (i.id === id ? updated : i));
    this.save();
    return updated;
  }

  /** Patch fields (e.g. transactionSignature) without a status transition. */
  patchIntent(id: string, patch: Partial<PaymentIntent>): PaymentIntent {
    const intent = this.getIntent(id);
    if (!intent) throw new StoreError("INTENT_NOT_FOUND", "Payment intent not found.");
    const updated: PaymentIntent = { ...intent, ...patch };
    this.data.intents = this.data.intents.map((i) => (i.id === id ? updated : i));
    this.save();
    return updated;
  }

  /** Total base units SETTLED by this payer today (UTC). Used by the daily limit. */
  settleTodayTotal(payerWallet: string): bigint {
    const today = new Date().toISOString().slice(0, 10);
    let total = 0n;
    for (const i of this.data.intents) {
      if (
        i.payerWallet === payerWallet &&
        i.status === "SETTLED" &&
        i.settledAt &&
        i.settledAt.slice(0, 10) === today
      ) {
        total += BigInt(i.amountBaseUnits);
      }
    }
    return total;
  }
}

export const store = new PactStore(getConfig().dataDir);
