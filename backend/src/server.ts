import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import { getConfig } from "./config/env";
import { logEvent } from "./lib/logger";
import { registerRoutes } from "./routes";
import { StoreError } from "./db/store";
import { IntentError } from "./services/payments/intents";
import { usdcMint } from "./services/solana/connection";
import { USDC_DECIMALS } from "./lib/usdc/parse";
import { getConnection } from "./services/solana/connection";

const cfg = getConfig();

// Startup validation: the configured USDC mint must be a valid pubkey.
try {
  new PublicKey(cfg.solana.usdcMint);
} catch {
  console.error("Invalid USDC_MINT configuration");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

registerRoutes(app);

// Error handling. Never leaks secrets; treats every error as opaque to the client.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "INVALID_JSON", message: "Request body is not valid JSON." });
  }
  const maybeZod = err as { name?: string; issues?: Array<{ message: string }> };
  if (maybeZod.name === "ZodError" && Array.isArray(maybeZod.issues)) {
    return res
      .status(400)
      .json({ error: "VALIDATION_ERROR", message: maybeZod.issues[0]?.message ?? "Invalid request." });
  }
  if (err instanceof IntentError) {
    return res.status(err.httpStatus).json({ error: err.code, message: err.message });
  }
  if (err instanceof StoreError) {
    return res.status(err.code === "RECIPIENT_NOT_FOUND" || err.code === "INTENT_NOT_FOUND" ? 404 : 409).json({
      error: err.code,
      message: err.message,
    });
  }
  logEvent("REQUEST_FAILED", { message: err.message });
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong." });
});

// Startup check that the configured USDC mint exists and really has 6 decimals.
getConnection()
  .getParsedAccountInfo(usdcMint())
  .then((info) => {
    const parsed = (
      info.value?.data as { parsed?: { type?: string; info?: { decimals?: number } } } | undefined
    )?.parsed;
    const decimals = parsed?.info?.decimals;
    if (!info.value || parsed?.type !== "mint" || typeof decimals !== "number") {
      logEvent("USDC_MINT_CHECK_FAILED", { reason: "NOT_A_MINT_OR_NOT_FOUND" });
      console.error("Configured USDC_MINT was not found or is not a token mint. Update USDC_MINT.");
      process.exit(1);
    }
    if (decimals !== USDC_DECIMALS) {
      logEvent("USDC_MINT_CHECK_FAILED", { decimals, expected: USDC_DECIMALS });
      console.error(`Configured USDC mint has ${decimals} decimals, expected ${USDC_DECIMALS}. Update USDC_MINT.`);
      process.exit(1);
    }
    logEvent("USDC_MINT_VERIFIED", { mint: cfg.solana.usdcMint, decimals });
  })
  .catch((e) => logEvent("USDC_MINT_CHECK_UNAVAILABLE", { detail: e?.message ?? "rpc unreachable" }));

app.listen(cfg.port, "0.0.0.0", () => {
  logEvent("SERVER_STARTED", {
    port: cfg.port,
    network: cfg.solana.network,
    model: cfg.llm.model,
    aiConfigured: Boolean(cfg.llm.apiKey),
  });
});
