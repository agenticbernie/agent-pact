use anchor_lang::prelude::*;

/// On-chain spending policy. PDA seeds: `["pact-policy", owner]`.
/// Authority over the vault token account (the vault's SPL `owner` field is
/// this PDA), so vault funds can only move through this program's instructions.
#[account]
#[derive(InitSpace)]
pub struct PolicyAccount {
    /// Trust root: signer on every mutation and every payment execution.
    pub owner: Pubkey,
    /// Authorized agent identity (v1: identifier, not required to sign).
    pub agent: Pubkey,
    /// The only mint this policy can move. Immutable after initialization.
    pub mint: Pubkey,
    /// Maximum amount (base units) per single payment.
    pub max_per_payment: u64,
    /// Cumulative cap (base units) per spending window.
    pub window_limit: u64,
    /// Window length in seconds (default 86_400).
    pub window_seconds: u64,
    /// Unix timestamp at which the current window started.
    pub window_start: i64,
    /// Base units settled in the current window (agent payments only;
    /// `owner_withdraw` never touches this).
    pub spent_in_window: u64,
    /// Allowed recipient wallets, max 16. Empty = any recipient allowed.
    #[max_len(16)]
    pub allowed_recipients: Vec<Pubkey>,
    /// Unix timestamp after which execution is rejected. 0 = never expires.
    pub expires_at: i64,
    /// While true, `execute_payment` is blocked (owner can still withdraw).
    pub paused: bool,
    /// Terminal. Set by `revoke`; no instruction clears it.
    pub revoked: bool,
    /// Starts at 1; incremented on every `update_policy`.
    pub version: u64,
    /// PDA bump.
    pub bump: u8,
}

/// Replay-protection + settlement-evidence record.
/// PDA seeds: `["pact-intent", policy, intent_id]`. Created exactly once per
/// payment; a repeated `intent_id` fails account initialization.
#[account]
#[derive(InitSpace)]
pub struct IntentRecord {
    pub policy: Pubkey,
    pub intent_id: [u8; 32],
    pub amount: u64,
    pub recipient: Pubkey,
    pub executed_at: i64,
}
