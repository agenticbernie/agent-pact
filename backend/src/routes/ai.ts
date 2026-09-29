import { Router } from "express";
import { ParsePaymentRequestSchema } from "../lib/validation/schemas";
import { parsePaymentIntent } from "../services/ai/openrouter";

export const wrap =
  (fn: (req: import("express").Request, res: import("express").Response) => Promise<unknown>) =>
  (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export const aiRouter = Router();

/**
 * POST /api/ai/parse-payment
 * Parses natural language into a structured, validated ParsedPaymentIntent.
 * Never executes, authorizes or stores anything.
 */
aiRouter.post(
  "/parse-payment",
  wrap(async (req, res) => {
    const { message } = ParsePaymentRequestSchema.parse(req.body);
    const outcome = await parsePaymentIntent(message);
    if (!outcome.ok) {
      const userMessage =
        outcome.error === "AI_NOT_CONFIGURED"
          ? "AI parsing is not configured yet. You can enter the payment manually."
          : "I couldn't understand that payment request. You can try again or enter the payment manually.";
      return res.status(503).json({ error: outcome.error, message: userMessage, fallback: "manual" });
    }
    res.json({ ok: true, intent: outcome.intent });
  })
);
