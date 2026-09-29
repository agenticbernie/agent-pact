import type { Express } from "express";
import { getConfig } from "../config/env";
import { isAiConfigured } from "../services/ai/openrouter";
import { aiRouter } from "./ai";
import { recipientsRouter } from "./recipients";
import { policyRouter } from "./policy";
import { walletRouter } from "./wallet";
import { paymentIntentsRouter } from "./paymentIntents";

export function registerRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() });
  });

  // Non-sensitive configuration for the Settings screen. Never includes the API key.
  app.get("/api/settings", (_req, res) => {
    const cfg = getConfig();
    res.json({
      network: cfg.solana.network,
      rpcUrl: cfg.solana.rpcUrl,
      usdcMint: cfg.solana.usdcMint,
      model: cfg.llm.model,
      aiConfigured: isAiConfigured(),
    });
  });

  app.use("/api/ai", aiRouter);
  app.use("/api/recipients", recipientsRouter);
  app.use("/api/policy", policyRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/payment-intents", paymentIntentsRouter);
}
