# Pact

**Confirmation-first AI payments on Solana — with spending policy enforced on-chain, not just in the app.**

> AI interprets intent. Deterministic code authorizes. The user confirms. Solana settles.

## The problem Pact solves

Giving an AI agent access to money is dangerous for three compounding reasons:

1. **LLMs are untrustworthy authorizers.** They hallucinate amounts and addresses, can be prompt-injected, and silently change behavior between model versions. Any system where model output flows straight into a transaction is one clever message away from a drained wallet.
2. **App-layer policy is bypassable.** A spending-limit check that lives only in your backend is advice, not enforcement. Anyone holding a signing key — a compromised agent service, a malicious API response, a leaked delegate key — can call the token program directly and move funds with zero policy checks.
3. **Confirmation UX without custody guarantees is theater.** "The user approved it" only protects you if the thing they signed is the thing that executes, within bounds nothing else can exceed.

Pact closes all three gaps with one architecture: the AI only ever *proposes* (strict-schema, untrusted input); deterministic code and an **on-chain policy program** *authorize*; the user *confirms* with their wallet signature; Solana *settles*. Vault funds cannot move through any path that skips the policy program — this is proven by adversarial tests, not asserted in comments.

## How it works

Describe a payment in natural language — *"Pay Felix 3 USDC for coffee"*:

```
prompt → LLM parses intent (untrusted) → recipient resolved from contacts
  → deterministic policy pre-check → REJECTED or AWAITING_CONFIRMATION
  → user taps Confirm & Sign (wallet signature = on-chain confirmation)
  → policy program validates + settles atomically → SETTLED (only after real confirmation)
```

Two custody paths, one UX:

| | Legacy (self-custody) | On-chain enforced (vault) |
|---|---|---|
| Funds live in | Your personal USDC account | Vault ATA owned by the policy PDA |
| Policy enforced by | Backend checks + your review | Backend checks + **program checks** + your review |
| Agent/backend bypass | Possible with the key | **Impossible** — vault authority is the program |
| Enable | Default | Payment controls → Enable on-chain policy, then fund the vault |

## The on-chain policy program

`onchain/` holds `pact-policy` (Anchor 1.x), **deployed on devnet** at
`6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY`.
Every payment through it requires the owner's signature and must satisfy —
atomically with settlement — per-payment max, window spending limit, recipient
allowlist, USDC-mint binding, expiry, and single-use intent records. The owner
can pause, permanently revoke, or evacuate the vault at any time (even while
paused/revoked).

- Design authority: `onchain/THREAT_MODEL.md` (10 threats → invariants → tests)
- Normative spec: `onchain/SPEC.md` · Integration/deploy: `onchain/INTEGRATION.md`
- Verified: **28/28 adversarial LiteSVM tests** (real program + real SPL Token/ATA binaries) **plus a full devnet smoke pass** — valid payment, over-limit/window rejections, direct-transfer bypass rejection, pause/revoke enforcement, balance + counter checks after every step (`INTEGRATION.md` §7).

## Stack & layout

- **frontend/** — React 18 + Vite + TypeScript, mobile-first fintech UI. Wallet signing via injected provider (Phantom); private keys never touch the app.
- **backend/** — Express + TypeScript API: intent state machine (explicit transitions, exactly-once execute lock, 5-min expiry), deterministic policy engine, recipients, server-side-only OpenRouter service, Solana services (SPL Token, ATA, vault program path).
- **onchain/** — the policy program, threat model, spec, tests, deployment docs.

Single origin: the browser talks only to the web service; `/api` is proxied to the backend. The OpenRouter key never reaches the client bundle. Persistence is a JSON store in the `pact-data` volume.

## Getting started

```bash
docker compose -f docker-compose.base44.yml up -d
```

- App: http://localhost:3000 · API: internal `api:4000` (`GET /api/health`)
- Install Phantom, connect, fund with devnet SOL (faucet.solana.com) and devnet USDC (faucet.circle.com).
- Talk or type a payment on Home, or use Pay manually. Review and sign on the confirmation screen.
- To enable on-chain enforcement: open **Payment controls** → **On-chain enforcement** → Enable (wallet signs once), then send devnet USDC to the shown vault address. Payments then settle through the program.

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible endpoint |
| `LLM_MODEL` | `nvidia/nemotron-3-super-120b-a12b:free` | Intent parser |
| `LLM_TEMPERATURE` | `0` | |
| `OPENROUTER_API_KEY` | — | Secret, server-side only. Manual payment works without it. |
| `SOLANA_NETWORK` | `devnet` | |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Devnet USDC (6 decimals) |
| `PACT_POLICY_PROGRAM_ID` | `6Ygcr…1WY` (devnet program) | Shipped configs enable it. Unset = legacy direct-SPL path. |

## API

```
POST /api/ai/parse-payment          # natural language -> validated structured intent (no execution)
GET  /api/recipients?owner=         POST /api/recipients   DELETE /api/recipients/:id?owner=
GET  /api/policy?owner=             PUT  /api/policy
GET  /api/policy/vault?owner=       # on-chain policy/vault addresses (program path)
GET  /api/policy/onchain?owner=     # live on-chain policy state (or initialized:false)
POST /api/policy/onchain/initialize # build unsigned initialize_policy tx (wallet signs)
POST /api/policy/onchain/submit     # submit a wallet-signed policy tx
GET  /api/wallet/:address/balance
POST /api/payment-intents            # creates intent, runs deterministic policy
GET  /api/payment-intents?payer=      GET /api/payment-intents/:id
POST /api/payment-intents/:id/confirm|cancel|build-transaction|execute
GET  /api/health                     GET /api/settings
```

## Security model (summary)

- No private keys or seed phrases are ever stored; signing is client-side in the wallet.
- `OPENROUTER_API_KEY` is server-side only. LLM output is untrusted input, strict-schema validated; the LLM never authorizes, signs, or executes.
- Every payment requires explicit confirmation (`requireConfirmation` cannot be disabled); on the vault path the owner's signature is additionally verified on-chain.
- Amounts are BigInt base units (USDC = 6 decimals); no float arithmetic; `transferChecked` only, always to the canonical recipient ATA.
- Intents expire after 5 minutes; terminal intents are never re-executable; settlement is marked only after real on-chain confirmation.
- Trust root: the owner's wallet key. Agent/backend compromise alone cannot move vault funds. Known limitations (legacy path uncovered, 16-recipient allowlist, USDC-only, no multisig recovery) are documented in `onchain/THREAT_MODEL.md` §§5–6 — passing tests are evidence, not a proof of total security.

## Verification

```bash
# Program: build + 28 adversarial on-chain tests (needs `anchor build` first for the .so)
cd onchain && anchor build && cargo test && cargo clippy --all-targets

# Backend: 37 unit/parity tests + typecheck
cd backend && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit

# Frontend: typecheck + production bundle
cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

# Devnet smoke (real USDC, all 10 flows) and app-level e2e (self-booting server)
cd backend && bun scripts/devnet-smoke.ts && bun scripts/e2e-app.ts
```

## Project info

- **Status:** working devnet app; policy program deployed and smoke-tested end-to-end. Legacy flow is the default; the vault path is opt-in per wallet.
- **Roadmap:** in-app pause/revoke controls, backend↔on-chain policy sync, Token-2022 support, agent co-signatures, multisig recovery, mainnet audit before any real funds.
- **License:** see `LICENSE`. Never deploy to mainnet or use real funds without an audit — this project prioritizes verifiable guarantees over feature speed.
