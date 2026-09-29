import { Router } from "express";
import { base58Address } from "../lib/validation/schemas";
import { IntentError } from "../services/payments/intents";
import { getUsdcBalance } from "../services/solana/usdc";
import { logEvent } from "../lib/logger";
import { wrap } from "./ai";

export const walletRouter = Router();

/** USDC balance read directly from the payer's SPL token accounts. */
walletRouter.get(
  "/:address/balance",
  wrap(async (req, res) => {
    const address = base58Address.parse(req.params.address);
    try {
      const balance = await getUsdcBalance(address);
      res.json({ address, balance });
    } catch (e) {
      logEvent("BALANCE_READ_FAILED", { detail: e instanceof Error ? e.message : "unknown" });
      throw new IntentError("RPC_ERROR", "Could not reach Solana to read your balance. Try again.", 503);
    }
  })
);
