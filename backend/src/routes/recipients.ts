import { Router } from "express";
import { store, StoreError } from "../db/store";
import { base58Address, CreateRecipientSchema } from "../lib/validation/schemas";
import { wrap } from "./ai";

export const recipientsRouter = Router();

recipientsRouter.get(
  "/",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    res.json({ recipients: store.listRecipients(owner) });
  })
);

recipientsRouter.post(
  "/",
  wrap(async (req, res) => {
    const { ownerWallet, name, walletAddress } = CreateRecipientSchema.parse(req.body);
    const recipient = store.addRecipient(ownerWallet, name, walletAddress);
    res.status(201).json({ recipient });
  })
);

recipientsRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    const removed = store.deleteRecipient(owner, req.params.id);
    if (!removed) throw new StoreError("RECIPIENT_NOT_FOUND", "Recipient not found.");
    res.json({ ok: true });
  })
);
