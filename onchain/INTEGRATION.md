# Pact Policy Program — Integration & Deployment

## 1. Deploy to devnet

Prerequisites: Solana CLI with a funded devnet keypair (`prog` below is the
program keypair at `onchain/target/deploy/pact_policy-keypair.json` —
**never commit this file**; it is gitignored).

```bash
cd onchain
anchor build
solana program deploy \
  --url https://api.devnet.solana.com \
  --keypair <FUNDED_DEVNET_KEYPAIR.json> \
  --program-id target/deploy/pact_policy-keypair.json \
  target/deploy/pact_policy.so
```

Verify:

```bash
solana program show 6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY \
  --url https://api.devnet.solana.com
```

Notes:

- The program id is baked in via `declare_id!` and must match the keypair.
  Redeploying under a new id requires updating `declare_id!`, `Anchor.toml`,
  `backend/tests/policyProgram.test.ts`, and this doc.
- Upgrade authority defaults to the program keypair. For anything beyond a
  devnet demo, transfer upgrade authority to a multisig before funding vaults.
- Never deploy to mainnet without explicit authorization (see threat model:
  owner-key trust root, no multisig recovery in v1).

**Status (2026-10-10): DEPLOYED to devnet.**
`solana program show` confirms: owner `BPFLoaderUpgradeab1e…`, authority =
deployer wallet, data length 240_040 bytes (matches the local `.so`),
slot 509386526. Deploy signature:
`2J37BqhcAiCYkNz7bcHBExojsd3AeyDa82ZV7vpU1MbWRNCeqsjgY8DTMui2YmEq7BxK8GdVeefnvHY464z2dhXL`.
A live policy was initialized as end-to-end proof — tx
`4NBjZKJJWXYJ1cE9HGP9FsNGjqLCw6boMsrC1o4kGBga3UpcCXHup7keTMiZFgCDHVdMikZG7Gw7YZPfGDfGpo9z`,
policy PDA `8useQLsmBJR2yeB2ux1hQ3XjVTG8V25VALVnTwo4qY9F` (owner = program,
679 bytes, agent/paused/revoked/expiry all as initialized).

## 2. Configure the backend

```bash
PACT_POLICY_PROGRAM_ID=6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY
```

(`backend/src/config/env.ts`; surfaced read-only at `GET /api/settings` as
`policyProgramId`.) When set, `POST /api/payment-intents/:id/build-transaction`
builds `execute_payment` instead of a direct SPL transfer, and `execute`
additionally verifies the signed transaction carries the expected program
instruction (defense in depth — the program remains authoritative). When
unset, the legacy direct-SPL path is used unchanged.

`GET /api/policy/vault?owner=<wallet>` returns the derived addresses:

```json
{ "programId": "6Ygcr…", "policy": "…", "vault": "…", "mint": "4zMMC9…" }
```

## 3. Fund the vault (per user)

1. Initialize the policy from the app: **Payment controls → On-chain
   enforcement → Enable on-chain policy** (wallet signs; the backend builds
   the unsigned `initialize_policy` via `POST /api/policy/onchain/initialize`
   and lands it via `POST /api/policy/onchain/submit`). Parameters default
   from your Pact rules (max, daily limit, allowlist ≤ 16).
2. Create the vault ATA for `(policy PDA, USDC mint)` — permissionless, anyone
   can fund the account creation (standard ATA program call).
3. Deposit USDC into the vault with a plain SPL transfer (devnet USDC:
   faucet.circle.com). The Policy page shows the vault address and balance.

The deposit prerequisite is the main UX change vs the legacy path: vault
payments draw from vault balance, checked at build time
(`INSUFFICIENT_BALANCE` names the vault explicitly).

## 4. Payment flow (program path)

```
create intent (off-chain policy pre-check, unchanged)
  → confirm (explicit user action, unchanged)
  → build-transaction → execute_payment ix (vault → recipient ATA)
  → wallet signs (owner signature = on-chain confirmation)
  → execute → backend verifies program ix present → submits
  → Solana confirms → SETTLED (only after real confirmation, unchanged)
```

On-chain, `execute_payment` validates owner/agent/limits/allowlist/mint/
expiry/replay and settles via CPI atomically. A rejected payment moves
nothing and consumes no allowance.

## 5. Frontend

No transaction-format changes: the wallet signs an opaque base64 transaction
as before. The Confirm screen labels the settlement program from
`GET /api/settings` (`Pact Policy · <id>` vs `SPL Token Program`).

## 6. What is NOT yet integrated

- No automatic migration of existing balances into vaults.
- Backend policy edits (limits/recipients) do not auto-sync to the on-chain
  policy — re-initialize or manage on-chain parameters separately (update/
  add-recipient instructions exist on-chain; app buttons pending).
- Legacy personal-ATA payments remain available and are NOT covered by
  on-chain policy (documented limitation, threat model §3).

## 7. Devnet smoke test (2026-10-10) — ALL CHECKS PASSED

Script: `backend/scripts/devnet-smoke.ts` (run with bun; needs an operator
keypair with devnet SOL + devnet USDC):

```bash
cd backend
bun scripts/devnet-smoke.ts --steps=init,atas,overlimit,pausecycle   # no USDC needed
bun scripts/devnet-smoke.ts --steps=deposit,valid,direct,windowlimit,revokecycle,withdraw
# App-level e2e (boots an isolated server, drives API + real on-chain init):
bun scripts/e2e-app.ts
```

One full pass uses one owner (keys persist in `/tmp/opencode/smoke-keys.json`;
delete it for a fresh pass — `revoke` is permanent per policy PDA).
Smoke policy shape: max 2 USDC, window 5 USDC / 86400s, allowlist = [recipient].

| Step | Result on devnet |
|---|---|
| init policy + vault/recipient ATAs | policy `7cQXdB6N…ND6KB2` initialized; state verified (not paused/revoked, expiry 0) |
| deposit 10 USDC operator → owner → vault | vault = 10_000_000 base units |
| valid 1 USDC payment via `execute_payment` | vault −1.00, recipient +1.00, `spent` 0 → 1_000_000 |
| over-limit 3 USDC (> max 2) | rejected `0x1771` (6001); balances + allowance unchanged |
| direct SPL `transferChecked` from vault (owner-signed) | rejected by token program (`OwnerMismatch` — vault authority is the PDA); nothing moved |
| pause → execute 0.5 USDC | rejected `0x1774` (6004); unpause restores |
| fill window to exactly 5_000_000, then +1 base unit | rejected `0x1772` (6002); balances + allowance unchanged |
| revoke → execute | rejected `0x1773` (6003); unpause rejected `0x1780` (6016, permanent) |
| `owner_withdraw` full vault while revoked | vault → 0, allowance still 5_000_000 (escape hatch consumes nothing) |

Every rejection was verified to move no funds and consume no allowance
(vault/recipient balances + `spent_in_window` re-read after each step).
