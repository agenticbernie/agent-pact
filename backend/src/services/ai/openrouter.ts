import { getConfig } from "../../config/env";
import { logEvent } from "../../lib/logger";
import { ParsedPaymentIntentSchema } from "../../lib/validation/schemas";
import type { ParsedPaymentIntent } from "../../types";

/**
 * Server-side OpenRouter service. Its ONLY responsibility is communicating
 * with OpenRouter and returning a schema-validated ParsedPaymentIntent.
 * It contains no authorization logic and is never exposed to the frontend.
 *
 * Every model response is treated as untrusted input: JSON parse + strict
 * Zod schema validation. Any failure degrades gracefully — the frontend
 * always offers manual payment entry as a fallback.
 */

const SYSTEM_PROMPT = `You are Pact's payment intent parser.

Your only job is to extract a structured payment intent from the user's natural-language message.

You do not authorize payments.
You do not execute transactions.
You do not create wallet addresses.
You do not guess recipients.
You do not invent payment amounts.
You do not modify policies.

Supported payment token: USDC only.

Return only structured JSON matching this exact schema:
{
  "action": "PAYMENT" or "UNKNOWN",
  "recipientInput": string or null,
  "amount": string or null,
  "token": "USDC" or null,
  "memo": string or null,
  "confidence": number between 0 and 1,
  "missingFields": array containing any of "recipient", "amount", "token"
}

Rules:
- If recipient is missing, return null and add "recipient" to missingFields.
- If amount is missing, return null and add "amount" to missingFields.
- If the user requests another token or currency, do not convert it. Return token as null and add "token" to missingFields.
- Never infer wallet addresses.
- Never silently correct ambiguous payment details.
- Amounts must be returned as strings, not numbers.
- Return JSON only. No markdown, no commentary, no executable code, no extra keys.

Example:
User: Pay Felix 3 USDC for coffee
Output: {"action":"PAYMENT","recipientInput":"Felix","amount":"3","token":"USDC","memo":"coffee","confidence":0.99,"missingFields":[]}`;

export type ParseOutcome =
  | { ok: true; intent: ParsedPaymentIntent }
  | { ok: false; error: "AI_NOT_CONFIGURED" | "AI_PARSE_FAILED" | "AI_UNAVAILABLE"; detail?: string };

const AI_TIMEOUT_MS = 30_000;

export function isAiConfigured(): boolean {
  return Boolean(getConfig().llm.apiKey);
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function callOpenRouter(
  messages: ChatMessage[],
  useJsonMode: boolean
): Promise<Response> {
  const { baseURL, model, temperature, apiKey } = getConfig().llm;
  return fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": "Pact",
    },
    body: JSON.stringify({
      model,
      temperature,
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
}

/** Extract the first {...} JSON blob (handles markdown-fenced output). */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export async function parsePaymentIntent(message: string): Promise<ParseOutcome> {
  const { apiKey, model } = getConfig().llm;
  logEvent("AI_PARSE_REQUESTED", { model, messageLength: message.length });

  if (!apiKey) {
    logEvent("AI_PARSE_FAILED", { reason: "AI_NOT_CONFIGURED" });
    return { ok: false, error: "AI_NOT_CONFIGURED" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    let res = await callOpenRouter(messages, true);
    // Some models reject response_format — retry once without it.
    if (res.status === 400) {
      res = await callOpenRouter(messages, false);
    }
    if (!res.ok) {
      logEvent("AI_PARSE_FAILED", { reason: `HTTP_${res.status}` });
      return { ok: false, error: "AI_UNAVAILABLE", detail: `OpenRouter returned HTTP ${res.status}` };
    }

    const payload = (await res.json()) as unknown;
    const content =
      (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
        ?.content ?? null;
    if (typeof content !== "string" || content.length === 0) {
      logEvent("AI_PARSE_FAILED", { reason: "EMPTY_CONTENT" });
      return { ok: false, error: "AI_PARSE_FAILED" };
    }

    const jsonText = extractJson(content);
    if (!jsonText) {
      logEvent("AI_PARSE_FAILED", { reason: "NO_JSON" });
      return { ok: false, error: "AI_PARSE_FAILED" };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      logEvent("AI_PARSE_FAILED", { reason: "INVALID_JSON" });
      return { ok: false, error: "AI_PARSE_FAILED" };
    }

    const validated = ParsedPaymentIntentSchema.safeParse(raw);
    if (!validated.success) {
      logEvent("AI_PARSE_FAILED", { reason: "SCHEMA_VALIDATION" });
      return { ok: false, error: "AI_PARSE_FAILED" };
    }

    logEvent("AI_PARSE_SUCCEEDED", {
      model,
      action: validated.data.action,
      missingFields: validated.data.missingFields,
      confidence: validated.data.confidence,
    });
    return { ok: true, intent: validated.data };
  } catch (e) {
    logEvent("AI_PARSE_FAILED", { reason: "EXCEPTION", detail: e instanceof Error ? e.message : "unknown" });
    return { ok: false, error: "AI_UNAVAILABLE", detail: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}
