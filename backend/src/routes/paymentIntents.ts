import { Router } from "express";
import { base58Address, CreatePaymentIntentSchema, ExecuteIntentSchema } from "../lib/validation/schemas";
import {
  buildIntentTransaction,
  cancelIntent,
  confirmIntent,
  createIntent,
  executeIntent,
  getIntent,
  listIntents,
} from "../services/payments/intents";
import { wrap } from "./ai";

export const paymentIntentsRouter = Router();

paymentIntentsRouter.post(
  "/",
  wrap(async (req, res) => {
    const input = CreatePaymentIntentSchema.parse(req.body);
    const intent = createIntent(input);
    res.status(201).json({ intent });
  })
);

paymentIntentsRouter.get(
  "/",
  wrap(async (req, res) => {
    const payer = base58Address.parse(req.query.payer);
    res.json({ intents: listIntents(payer) });
  })
);

paymentIntentsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    res.json({ intent: getIntent(req.params.id) });
  })
);

paymentIntentsRouter.post(
  "/:id/confirm",
  wrap(async (req, res) => {
    res.json({ intent: confirmIntent(req.params.id) });
  })
);

paymentIntentsRouter.post(
  "/:id/cancel",
  wrap(async (req, res) => {
    res.json({ intent: cancelIntent(req.params.id) });
  })
);

paymentIntentsRouter.post(
  "/:id/build-transaction",
  wrap(async (req, res) => {
    res.json(await buildIntentTransaction(req.params.id));
  })
);

paymentIntentsRouter.post(
  "/:id/execute",
  wrap(async (req, res) => {
    const { signedTransactionBase64 } = ExecuteIntentSchema.parse(req.body);
    const intent = await executeIntent(req.params.id, signedTransactionBase64);
    res.json({ intent });
  })
);
