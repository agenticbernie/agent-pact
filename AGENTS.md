# Pact — agent notes

Confirmation-first AI payment app on Solana devnet (USDC). Core invariant:
**AI interprets → deterministic code validates → the user confirms → the wallet signs → Solana settles.**
Never break that separation: no authorization logic in AI services, no AI logic in Solana services.

## Running

- `docker compose -f docker-compose.base44.yml up -d` — web on host port 3000 (Vite :5173), API internal `:4000`.
- Single origin: frontend proxies `/api` to the `api` service. No CORS setup needed.
- Persistence: JSON store in the `pact-data` volume at `/data/pact-store.json` (DATA_DIR).
- Backend watcher: `tsx watch` (may need `docker compose -f docker-compose.base44.yml restart api`
  if bind-mount file events don't propagate). Frontend: Vite hot reload with polling enabled.

## Key locations

- `backend/src/lib/` — pure logic: `usdc/parse` (BigInt base units, 6 decimals), `policy/engine`
  (deterministic, no LLM), `payments/stateMachine` (explicit transitions only).
- `backend/src/services/ai/openrouter.ts` — server-side only; never expose to the client.
- `backend/src/services/payments/intents.ts` — intent lifecycle, idempotent execute
  (CONFIRMED→EXECUTING is the exactly-once lock; EXECUTING/SETTLED never resubmits).
- `backend/src/services/solana/` — connection, USDC balance, `transferChecked` tx build,
  submit + real confirmation polling.

## Environment / secrets

- `OPENROUTER_API_KEY` is delivered via `/run/base44/app.env` (platform-managed, outside the repo).
  App boots fine without it — AI parse returns a clear fallback message; manual payment still works.
- `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TEMPERATURE` / `SOLANA_*` / `USDC_MINT` have code defaults
  in `backend/src/config/env.ts` but can be overridden through the same env file.
- Do NOT put user-supplied keys under compose `environment:` — they must override via `env_file` last.

## Verify

- Health: `curl -s localhost:3000/api/health`
- Tests: `docker compose -f docker-compose.base44.yml exec -T api npm test` (vitest: usdc parser, policy, state machine, AI schema)
- Functional pipeline via HTTP (policy/state/reject paths) can be exercised with curl against
  `localhost:3000/api` using any valid base58 address as `payerWallet` — no real funds involved.
- Full settle flow needs Phantom + devnet USDC (faucet.circle.com); Phantom may not inject into
  the preview iframe — open the preview URL in a full browser tab if the wallet isn't detected.

## Gotchas

- USDC amounts: BigInt base units only; display strings parsed with `parseUsdc` (rejects 0, >6 decimals, garbage).
- Payment intents expire after 5 minutes; expiry is applied lazily on read.
- Never mark a payment SETTLED without polling the signature status on chain.
- The frontend duplicates shared types in `frontend/src/types.ts` — keep in sync with `backend/src/types.ts`.
