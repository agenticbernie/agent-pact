export type PaymentStatus =
  | "PROPOSED"
  | "AWAITING_CONFIRMATION"
  | "CONFIRMED"
  | "EXECUTING"
  | "SETTLED"
  | "REJECTED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export type MissingField = "recipient" | "amount" | "token";

export interface ParsedPaymentIntent {
  action: "PAYMENT" | "UNKNOWN";
  recipientInput: string | null;
  amount: string | null;
  token: "USDC" | null;
  memo: string | null;
  confidence: number;
  missingFields: MissingField[];
}

export type PolicyReasonCode =
  | "ALLOWED"
  | "PAYMENT_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_EXCEEDED"
  | "RECIPIENT_NOT_ALLOWED"
  | "INVALID_AMOUNT"
  | "INVALID_TOKEN";

export interface PolicyResult {
  allowed: boolean;
  reasonCode: PolicyReasonCode;
  message: string;
}

export interface Policy {
  maxPaymentAmount: string;
  dailyLimit: string;
  allowedRecipients: string[];
  requireConfirmation: true;
}

export interface Recipient {
  id: string;
  ownerWallet: string;
  name: string;
  walletAddress: string;
  createdAt: string;
}

export interface PaymentIntent {
  id: string;
  nonce: string;
  payerWallet: string;
  recipientId: string;
  recipientName: string;
  recipientWallet: string;
  amountBaseUnits: string;
  amountDisplay: string;
  token: "USDC";
  memo: string | null;
  status: PaymentStatus;
  aiSource: { originalPrompt: string; model: string; confidence: number } | null;
  policyResult: PolicyResult | null;
  transactionSignature: string | null;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  settledAt: string | null;
  expiresAt: string;
}

export interface AppSettings {
  network: string;
  rpcUrl: string;
  usdcMint: string;
  model: string;
  aiConfigured: boolean;
}

export interface UsdcBalanceInfo {
  baseUnits: string;
  display: string;
  hasTokenAccount: boolean;
}
