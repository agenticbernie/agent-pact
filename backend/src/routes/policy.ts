import { Router } from "express";
import { store } from "../db/store";
import { base58Address, UpdatePolicySchema } from "../lib/validation/schemas";
import { wrap } from "./ai";

export const policyRouter = Router();

policyRouter.get(
  "/",
  wrap(async (req, res) => {
    const owner = base58Address.parse(req.query.owner);
    res.json({ policy: store.getPolicy(owner) });
  })
);

policyRouter.put(
  "/",
  wrap(async (req, res) => {
    const { ownerWallet, ...policy } = UpdatePolicySchema.parse(req.body);
    store.setPolicy(ownerWallet, policy);
    res.json({ policy: store.getPolicy(ownerWallet) });
  })
);
