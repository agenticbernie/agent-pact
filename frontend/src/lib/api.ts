import type {
  AppSettings,
  ParsedPaymentIntent,
  PaymentIntent,
  Policy,
  Recipient,
  UsdcBalanceInfo,
} from "../types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body.error as string) ?? "REQUEST_FAILED",
      (body.message as string) ?? "Request failed. Try again."
    );
  }
  return body as T;
}

export interface CreateIntentInput {
  payerWallet: string;
  recipientId: string;
  amount: string;
  memo?: string | null;
  aiSource?: { originalPrompt: string; confidence: number };
}

export const api = {
  settings: () => request<AppSettings>("/settings"),

  parsePayment: (message: string) =>
    request<{ ok: true; intent: ParsedPaymentIntent }>("/ai/parse-payment", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  listRecipients: (owner: string) =>
    request<{ recipients: Recipient[] }>(`/recipients?owner=${owner}`),

  addRecipient: (input: { ownerWallet: string; name: string; walletAddress: string }) =>
    request<{ recipient: Recipient }>("/recipients", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteRecipient: (owner: string, id: string) =>
    request<{ ok: boolean }>(`/recipients/${id}?owner=${owner}`, { method: "DELETE" }),

  getPolicy: (owner: string) => request<{ policy: Policy }>(`/policy?owner=${owner}`),

  updatePolicy: (input: {
    ownerWallet: string;
    maxPaymentAmount: string;
    dailyLimit: string;
    allowedRecipients: string[];
    requireConfirmation: true;
  }) =>
    request<{ policy: Policy }>("/policy", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  getBalance: (address: string) =>
    request<{ address: string; balance: UsdcBalanceInfo }>(`/wallet/${address}/balance`),

  createIntent: (input: CreateIntentInput) =>
    request<{ intent: PaymentIntent }>("/payment-intents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listIntents: (payer: string) => request<{ intents: PaymentIntent[] }>(`/payment-intents?payer=${payer}`),

  getIntent: (id: string) => request<{ intent: PaymentIntent }>(`/payment-intents/${id}`),

  confirmIntent: (id: string) =>
    request<{ intent: PaymentIntent }>(`/payment-intents/${id}/confirm`, { method: "POST" }),

  cancelIntent: (id: string) =>
    request<{ intent: PaymentIntent }>(`/payment-intents/${id}/cancel`, { method: "POST" }),

  buildTransaction: (id: string) =>
    request<{ transactionBase64: string; createsRecipientAta: boolean }>(
      `/payment-intents/${id}/build-transaction`,
      { method: "POST" }
    ),

  executeIntent: (id: string, signedTransactionBase64: string) =>
    request<{ intent: PaymentIntent }>(`/payment-intents/${id}/execute`, {
      method: "POST",
      body: JSON.stringify({ signedTransactionBase64 }),
    }),
};
