# Pact

Confirmation-first AI payments on Solana (USDC, devnet).

> AI interprets intent. Deterministic code authorizes. The user confirms. Solana settles.

Pact lets you describe a payment in natural language ("Pay Felix 3 USDC for coffee"),
has an LLM (via OpenRouter) parse it into a structured intent, resolves the recipient
from your saved contacts, evaluates a deterministic spending policy, and only then —
after your **explicit confirmation** and your **wallet signature** — settles a real
USDC `transferChecked` transfer on Solana. Nothing is ever sent without the
confirmation step; the AI can never authorize, sign or move funds.

## Stack

- **frontend/** — React 18 + Vite (TypeScript), mobile-first fintech UI.
- **backend/** — Express + TypeScript API: intent state machine, policy engine,
  recipients, OpenRouter service (server-side only), Solana services (SPL Token,
  ATA, USDC `transferChecked`).

Single origin: the browser talks only to the web service; `/api` is proxied to the
backend. The OpenRouter API key never reaches the client bundle.

## Run (development)

```bash
docker compose -f docker-compose.base44.yml up -d
```

- App: http://localhost:3000 (web dev server, proxies `/api`)
- API: internal `api:4000` service; `GET /api/health`
- Persistence: JSON store in the `pact-data` volume

Install a Solana wallet (Phantom), connect it, and fund it with devnet SOL
(faucet.solana.com) and devnet USDC (faucet.circle.com) to test end to end.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible endpoint |
| `LLM_MODEL` | `nvidia/nemotron-3-super-120b-a12b:free` | Intent parser |
| `LLM_TEMPERATURE` | `0` | |
| `OPENROUTER_API_KEY` | — | Secret, server-side only. Manual payment works without it. |
| `SOLANA_NETWORK` | `devnet` | |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Devnet USDC (6 decimals) |

## API

```
POST /api/ai/parse-payment          # natural language -> validated structured intent (no execution)
GET  /api/recipients?owner=         POST /api/recipients   DELETE /api/recipients/:id?owner=
GET  /api/policy?owner=             PUT  /api/policy
GET  /api/wallet/:address/balance
POST /api/payment-intents            # creates intent, runs deterministic policy
GET  /api/payment-intents?payer=      GET /api/payment-intents/:id
POST /api/payment-intents/:id/confirm|cancel|build-transaction|execute
GET  /api/health                     GET /api/settings
```

## Security invariants

- No private keys or seed phrases are ever stored; signing is client-side in the wallet.
- `OPENROUTER_API_KEY` is server-side only. LLM output is untrusted input, strict-schema validated.
- The LLM never authorizes, signs, or executes anything; policy is deterministic code.
- Every payment requires explicit confirmation (`requireConfirmation` cannot be disabled).
- Amounts are BigInt base units (USDC = 6 decimals); no float arithmetic.
- `transferChecked` only; destination is always the recipient's canonical USDC ATA.
- Intents expire after 5 minutes; terminal intents are never re-executable (state machine + nonce).
- Settlement is marked only after real on-chain confirmation.

## Tests

```bash
docker compose -f docker-compose.base44.yml exec -T api npm test
```

Covers the USDC parser, policy engine, intent state machine, and AI schema validation.
