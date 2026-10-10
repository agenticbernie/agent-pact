# Pact On-Chain Policy — Threat Model & Security Architecture

Status: implemented in `programs/pact-policy` (Anchor 1.x, Solana devnet).
This document is the design authority for the program. The executable
specification is `SPEC.md`; the code must match both.

## 1. Starting point (verified, Phase 1)

Pact (repo root, branch `main`, clean tree) enforces spending policy **only
off-chain**:

- `backend/src/lib/policy/engine.ts` — pure deterministic check at intent
  creation (per-payment max, UTC-day cumulative, recipient allowlist, USDC-only).
- `backend/src/lib/payments/stateMachine.ts` + `services/payments/intents.ts` —
  explicit lifecycle, exactly-once CONFIRMED→EXECUTING lock, 5-minute expiry.
- Settlement is a **direct SPL `transferChecked`** from the payer's own ATA,
  signed by the user's wallet (`services/solana/usdc.ts`, `frontend/src/pages/Confirm.tsx`).

Consequence: anyone holding the signing key — a compromised agent service, a
malicious backend response tricking the wallet, or any holder of a delegated
key — can call the SPL Token Program directly and move funds with **zero
policy enforcement**. There is no on-chain program, no PDA, no vault, no
deployment script. The backend, frontend and LLM are the *only* enforcement
layer, and none of them is a trust root.

## 2. Goal

Move the security-critical authorization — *may these funds move to this
recipient in this amount at this time* — into a custom on-chain program,
`pact-policy`, such that **no alternate transaction path within the custody
model can move the funds without passing the program's checks**. Off-chain
code keeps its jobs (intent parsing, UX, confirmation flow) but loses its
status as an enforcement authority.

## 3. Custody architecture (the bypass question)

> "Do not assume that adding a policy PDA is sufficient. Demonstrate why an
> agent cannot simply bypass the policy program and transfer assets through
> the SPL Token Program directly."

A policy PDA that merely *records* limits while funds sit in a key-controlled
token account enforces nothing: the agent calls `spl_token::transfer` with
itself as authority and the PDA is never consulted. **Therefore custody must
move.** Selected design:

- User USDC for agent-driven payments lives in a **vault token account whose
  authority is the policy PDA itself** (`vault.owner == policy_pda`).
- SPL Token rules: only the account authority (or a delegate / multisig —
  both of which the program never creates) can debit. The PDA can only sign
  via `invoke_signed` inside `pact-policy`, using seeds the program controls.
- Hence **every debit of vault funds executes program code**, which runs the
  full policy check set atomically with the CPI settlement. There is no
  "direct" path: a direct SPL transfer instruction with the agent (or user, or
  backend) as authority fails with `OwnerMismatch` because the vault's owner
  field is the PDA.

Rejected alternatives:

| Alternative | Why rejected |
|---|---|
| Policy PDA as advisory record; funds stay in user ATA | Bypassable by construction — the exact flaw we must eliminate. |
| SPL `delegate`/`approve` of a fixed allowance to an agent key | Allowance is a one-time ceiling, not a rate/window/recipient policy; agent can drain up to the allowance to *any* recipient with no on-chain recipient check; revocation is racy (in-flight txs). |
| Multisig (user + agent) on the source account | Multisig authorizes *amounts*, not recipients/windows/policies; every parameter change needs key management; no spending counters, no expiry, no events. |
| Token-2022 transfer-hook / permanent-delegate | Permanent delegate is a super-user bypass (worse); transfer-hooks run on every transfer including unrelated ones, complicate the mint, and still need a state account — strictly more complex than a vault. |

Residual, accepted limitation: funds the user keeps in their **personal ATA**
(self-custody path, the pre-existing Pact flow) remain outside on-chain
enforcement. The vault model protects exactly the funds the user deposits
into the vault. The backend keeps both paths (legacy direct-SPL default;
vault path when `PACT_POLICY_PROGRAM_ID` is configured) and the docs mark
which path each payment used. Full migration to vault-only settlement is
future work (see §8).

## 4. Threats, invariants, tests

`T#` = threat, `I#` = invariant enforced in program code, `E#` = LiteSVM test
(real program + real SPL Token bytes, no mocks).

- **T1 — Compromised/malicious AI agent.** The agent (LLM + backend pipeline)
  submits a payment the user never approved, or with tampered amount/recipient.
  - I1a: `execute_payment` requires the **owner's signature** (user
    confirmation is checked on-chain, not just in the UI).
  - I1b: amount, recipient, mint, window counters are validated against the
    on-chain policy account, never against backend-supplied assertions.
  - E1: `agent_cannot_steal_without_owner_sig`;
    `tampered_amount_or_recipient_rejected` (backend lies → user-signed tx
    still fails policy checks on-chain).
- **T2 — Compromised backend / manipulated API response.** Backend returns a
  malicious unsigned transaction (wrong program, wrong accounts, inflated
  amount) for the wallet to sign.
  - I2: the wallet signs a transaction whose effects are bounded by program
    checks; a forged instruction fails account constraints before any CPI.
    Backend additionally re-validates the built transaction server-side
    (defense in depth; the program does not trust it).
  - E2: `malicious_backend_tx_rejected` — execute with substituted accounts
    fails; no funds move, counters untouched.
- **T3 — Agent calls the token program directly (bypass).**
  - I3: vault authority is the policy PDA; direct `transfer`/`transferChecked`
    with any other authority fails in the token program.
  - E3: `direct_spl_transfer_from_vault_fails` — sign as agent *and* as owner;
    both fail; vault balance unchanged. (Owner bypass exists only via the
    explicit `owner_withdraw` escape hatch, §5.)
- **T4 — Unauthorized policy update / revocation.**
  - I4: every mutation (`update_policy`, `add/remove_recipient`,
    `pause/unpause`, `revoke`, `owner_withdraw`) requires the owner's
    signature and the policy PDA derivation `["pact-policy", owner]`.
  - E4: `non_owner_policy_mutation_rejected` for each instruction.
- **T5 — Forged accounts: wrong PDA, substituted token accounts, wrong mint,
  fake token program.**
  - I5a: policy PDA seeds + bump enforced by Anchor; wrong PDA → constraint
    failure.
  - I5b: `vault.mint == policy.mint`, `vault.owner == policy.key()`;
    recipient account must equal the canonical ATA derived from
    `(recipient_wallet, policy.mint)` — a substituted ATA fails.
  - I5c: `mint.key() == policy.mint` and `mint.decimals == 6`.
  - I5d: `token_program` constrained to the SPL Token Program ID; a fake
    program ID fails before CPI.
  - E5: `wrong_pda_rejected`, `substituted_vault_rejected`,
    `substituted_recipient_ata_rejected`, `wrong_mint_rejected`,
    `fake_token_program_rejected`.
- **T6 — Integer overflow, decimal confusion, duplicate execution, replay.**
  - I6a: `amount > 0`; all arithmetic `checked_*`; release profile has
    `overflow-checks = true`; amounts are `u64` base units (SPL-native, no
    floats anywhere).
  - I6b: every execution initializes a unique **intent-record PDA**
    `["pact-intent", policy, intent_id]`; replaying an `intent_id` fails
    account initialization; the record stores amount/recipient/timestamp as
    settlement evidence.
  - E6: `zero_amount_rejected`, `u64_boundary_amounts`, `replay_same_intent_fails`,
    `failed_payment_consumes_no_allowance`.
- **T7 — Concurrent payments exceeding the window limit.**
  - I7: check-and-update of `spent_in_window` happens in a single instruction;
    the Solana runtime serializes writes to the policy account, so two
    concurrent transactions cannot both pass a limit they collectively exceed.
  - E7: `sequential_payments_enforce_window` (each valid alone, jointly over →
    second fails); documents runtime serialization as the mechanism.
- **T8 — Clock abuse: window reset gaming, expired authorization.**
  - I8: window uses on-chain `Clock::unix_timestamp`; reset is lazy
    (`now - window_start >= window_seconds` ⇒ new window); `expires_at != 0
    && now > expires_at` blocks execution. Slot-time skew (seconds) is
    accepted and documented — windows are day-scale.
  - E8: `window_resets_after_period`, `expired_policy_rejected`.
- **T9 — Malicious CPI paths / unintended signers.**
  - I9: exactly one CPI (`transfer_checked` to the constrained token program);
    PDA signer seeds are the policy PDA seeds only; no other program is
    invoked; no delegate authorities are ever created.
  - E9: covered by E5 (fake token program) + `no_unexpected_cpi` log assertion.
- **T10 — Admin key compromise / emergency recovery.**
  - I10: owner can always `pause` (halts agent payments instantly), `revoke`
    (permanent halt), and `owner_withdraw` (evacuate vault **even while
    paused**). Withdrawal is owner-signed, emits an event, and does not
    consume the agent window. There is no multi-sig recovery in v1.
  - E10: `pause_halts_payments`, `revoke_is_permanent`,
    `owner_can_evacuate_while_paused`.
  - Accepted risk: owner-key compromise is total (documented; the owner is the
    trust root, as in the pre-existing Pact model where the wallet key moves
    everything).

## 5. Trust assumptions (explicit)

1. The Solana runtime, SPL Token Program, and Anchor account-constraint
   enforcement behave as documented.
2. The policy **owner key** (user wallet) is the trust root. Its compromise is
   out of scope to mitigate on-chain (same as today: the wallet key moves all
   funds). The program's job is to protect the owner from *everyone else*,
   including the agent and backend.
3. The agent key is an **identifier + submitter**, not a custodian: v1 does
   not require its signature on `execute_payment` (the owner's signature is
   the confirmation). Agent compromise alone cannot move funds. Requiring an
   agent co-signature (dual-control) is a documented future hardening.
4. Off-chain clocks (backend expiry) are UX only; on-chain time comes from
   `Clock`.
5. LiteSVM executes the compiled SBF program faithfully for functional and
   adversarial testing; mainnet/devnet deployment is verified separately.

## 6. Known limitations (v1)

- Personal-ATA (legacy) payments are not covered by on-chain policy (see §3).
- Recipient allowlist is embedded in the policy account, capped at 16 entries;
  empty allowlist = any recipient allowed (parity with backend semantics).
- Single mint per policy (USDC, 6 decimals enforced); Token-2022 unsupported.
- Single window type (fixed-length seconds, default 1 day); no per-recipient
  limits, no velocity rules.
- No dual-signature (agent co-sign) requirement; no multisig recovery.
- `owner_withdraw` is intentionally policy-exempt (escape hatch, logged).
