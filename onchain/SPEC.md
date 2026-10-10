# Pact Policy Program — Specification

Program: `pact-policy` · Framework: Anchor 1.x (Rust) · Target: Solana devnet
Program ID (devnet, initial deployment key): `6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY`

> This spec is normative for v1. If code and spec disagree, fix the code (or
> amend the spec explicitly). The threat model is `THREAT_MODEL.md`.

## 1. Accounts

### 1.1 Policy (`PolicyAccount`)

PDA seeds: `[b"pact-policy", owner: Pubkey]` · bump stored.

| Field | Type | Notes |
|---|---|---|
| `owner` | Pubkey | Trust root; signer on all mutations and every execution (I1a, I4). |
| `agent` | Pubkey | Authorized agent identity; must match `agent` account on execute; non-signer in v1. |
| `mint` | Pubkey | Immutable after init; the only mint this policy can move. |
| `max_per_payment` | u64 | Base units; `0` rejected at init/update. |
| `window_limit` | u64 | Base units; cumulative cap per window; `0` rejected. |
| `window_seconds` | u64 | `> 0` (default 86400). |
| `window_start` | i64 | Unix timestamp of current window start. |
| `spent_in_window` | u64 | Base units settled in current window (agent payments only). |
| `allowed_recipients` | Vec<Pubkey> | Max 16; **empty = any recipient allowed** (backend parity, see limitation). |
| `expires_at` | i64 | Unix timestamp; `0` = never expires. |
| `paused` | bool | `pause`/`unpause` (owner). Execute blocked while true. |
| `revoked` | bool | `revoke` sets permanently; no instruction unsets it. |
| `version` | u64 | Starts 1; +1 on every `update_policy`. |
| `bump` | u8 | PDA bump. |

Space: `8 + 32*3 + 8*3 + 8 + 8 + (4 + 16*32) + 8 + 1 + 1 + 8 + 1` = fixed;
allocate for 16 recipients always (simple, no realloc).

### 1.2 Vault (SPL token account, no custom struct)

- Address: canonical ATA `ATA(policy_pda, mint)` (created off-chain by anyone;
  the program never invokes the ATA program).
- Constraints on every use: `vault.mint == policy.mint`,
  `vault.owner (authority) == policy.key()`.
- Funding: plain SPL transfers (permissionless). The program does not track
  deposits.

### 1.3 Intent record (`IntentRecord`)

PDA seeds: `[b"pact-intent", policy: Pubkey, intent_id: [u8; 32]]`.

| Field | Type |
|---|---|
| `policy` | Pubkey |
| `intent_id` | [u8; 32] |
| `amount` | u64 |
| `recipient` | Pubkey |
| `executed_at` | i64 |

Created (`init`, payer = owner) exactly once per `execute_payment`. A second
execution with the same `intent_id` fails account initialization → replay
protection (I6b). Serves as on-chain settlement evidence alongside events.

## 2. Instructions

### 2.1 `initialize_policy(agent, mint_params…, limits…, expires_at, allowed_recipients)`

Accounts: `owner` (Signer, mut, payer), `policy` (init PDA), `mint` (SPL Mint,
readonly), `system_program`.
Args: `agent: Pubkey`, `max_per_payment: u64`, `window_limit: u64`,
`window_seconds: u64` (0 ⇒ default 86400), `expires_at: i64`,
`allowed_recipients: Vec<Pubkey>` (≤ 16).
Validation: `mint.decimals == 6`; `mint.key()` stored; limits `> 0`;
`window_seconds > 0` after defaulting; `version = 1`; `window_start = now`;
`spent = 0`; `paused = revoked = false`.
Emits `PolicyInitialized`.

### 2.2 `update_policy(agent?, max_per_payment?, window_limit?, window_seconds?, expires_at?)`

Accounts: `owner` (Signer), `policy` (mut PDA).
`Option<T>` args; `None` = unchanged. Mint, owner, recipients, pause/revoke
flags **cannot** change here. `version += 1` (checked). Emits `PolicyUpdated`.
(`window_start`/`spent_in_window` untouched — no free reset via update.)

### 2.3 `add_recipient(recipient)` / `remove_recipient(recipient)`

Accounts: `owner` (Signer), `policy` (mut PDA).
Add: `len < 16` else error; duplicates ignored (idempotent, still emits event).
Remove: `retain`; absent entry is a no-op. Emits `RecipientAdded/Removed`.

### 2.4 `pause()` / `unpause()`

Accounts: `owner` (Signer), `policy` (mut). Emits `PolicyPaused/Unpaused`.
(`revoked` policy cannot be unpaused — unpause on revoked errors.)

### 2.5 `revoke()`

Accounts: `owner` (Signer), `policy` (mut). Sets `revoked = true` permanently.
Emits `PolicyRevoked`. Irreversible by design (recovery = new policy).

### 2.6 `owner_withdraw(amount, destination)`

Accounts: `owner` (Signer), `policy` (PDA, readonly), `vault` (mut token,
`mint == policy.mint`, `authority == policy.key()`), `destination` (mut token,
`mint == policy.mint`), `mint`, `token_program` (SPL ID).
CPI `transfer_checked` signed by policy PDA. Works while paused/revoked
(emergency evacuation, I10). Does **not** touch window counters. Emits
`OwnerWithdrawal`. `amount > 0`.

### 2.7 `execute_payment(intent_id: [u8; 32], amount: u64)`

Accounts: `owner` (Signer, mut payer for record rent), `agent` (readonly,
`key == policy.agent`), `policy` (mut PDA), `vault` (mut token account),
`recipient` (readonly wallet pubkey), `recipient_ata` (mut token account),
`mint` (readonly SPL Mint), `intent_record` (init PDA), `token_program`
(SPL ID), `system_program`.

Validation order (all before any state change or CPI):

1. `!policy.revoked` else `PolicyRevoked`; `!policy.paused` else `PolicyPaused`.
2. `policy.expires_at == 0 || now <= policy.expires_at` else `PolicyExpired`.
3. `amount > 0` else `InvalidAmount`.
4. `amount <= policy.max_per_payment` else `ExceedsPerPaymentLimit`.
5. `agent.key() == policy.agent` else `AgentMismatch`.
6. `policy.allowed_recipients.is_empty() || contains(recipient)` else
   `RecipientNotAllowed`.
7. `mint.key() == policy.mint && mint.decimals == 6` else `MintMismatch`.
8. `vault.mint == policy.mint && vault.owner == policy.key()` else
   `VaultMismatch`.
9. `recipient_ata.key() == ATA(recipient, policy.mint)` (canonical derivation
   with SPL Token program id) **and** `recipient_ata.mint == policy.mint`
   else `RecipientAccountMismatch`. (Kills substituted-ATA attacks, I5b.)
10. Lazy window reset: if `now - window_start >= window_seconds`
    (checked math) ⇒ `window_start = now; spent_in_window = 0`.
11. `new_spent = spent.checked_add(amount)` else `ArithmeticOverflow`;
    `new_spent <= window_limit` else `ExceedsWindowLimit`.

Effects (atomic, single instruction — CPI failure rolls back everything):

12. CPI `transfer_checked(amount, 6)` vault → recipient_ata, authority =
    policy PDA seeds. Token program ID constrained to SPL Token.
13. `policy.spent_in_window = new_spent` (window_start already updated).
14. Init intent record `{policy, intent_id, amount, recipient, executed_at: now}`.
15. Emit `PaymentExecuted { policy, intent_id, amount, recipient, agent,
    spent_in_window, version }`.

A rejected payment transfers nothing and consumes no allowance (checks precede
all writes; failed CPI aborts the transaction).

## 3. Errors

`PolicyRevoked, PolicyPaused, PolicyExpired, InvalidAmount,
ExceedsPerPaymentLimit, ExceedsWindowLimit, AgentMismatch,
RecipientNotAllowed, RecipientAccountMismatch, VaultMismatch, MintMismatch,
InvalidMintDecimals, InvalidLimits, TooManyRecipients, ArithmeticOverflow,
Unauthorized, RevokeIsPermanent, UnsupportedTokenProgram`
(+ Anchor built-in constraint violations for wrong PDA/signer/program IDs).

Token accounts (`vault`, `recipient_ata`, `destination`, `mint`) are passed
as `UncheckedAccount` and deserialized explicitly in-handler with strict
SPL-Token program-ownership checks (`UnsupportedTokenProgram` rejects
Token-2022 accounts): this keeps `anchor build` IDL generation working,
which `InterfaceAccount<token…>` breaks upstream (missing `IdlBuild`
impls), while enforcing identical guarantees with program-specific codes.

## 4. Events

`PolicyInitialized{policy,owner,agent,mint,version}`,
`PolicyUpdated{policy,version}`,
`RecipientAdded{policy,recipient}` / `RecipientRemoved{policy,recipient}`,
`PolicyPaused{policy}` / `PolicyUnpaused{policy}`, `PolicyRevoked{policy}`,
`OwnerWithdrawal{policy,destination,amount}`,
`PaymentExecuted{policy,intent_id,amount,recipient,agent,spent_in_window,version}`.

## 5. State-transition summary

`active ⇄ paused` (owner) · `active|paused → revoked` (owner, terminal) ·
window `{start,spent}` resets lazily on execute · `version` strictly increases
on update · intent records are create-once (no transitions).

## 6. Intent-ID derivation (off-chain convention)

Backend `intent_id = SHA256(intent.nonce)` (nonce = 16 random bytes stored per
intent). 32 bytes, unique per payment, deterministic without schema migration.
The program treats it as opaque; uniqueness is what matters.

## 7. Omissions (v1, with rationale)

- No agent co-signature (owner signature is the confirmation; §5 of threat model).
- No `deposit` instruction (plain SPL transfers; fewer CPIs, less attack surface).
- No in-program vault-ATA creation (created off-chain; program validates).
- No Token-2022, no multi-mint, no per-recipient limits (documented limits).
