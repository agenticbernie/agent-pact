use anchor_lang::prelude::*;

/// Seed for the policy PDA: `["pact-policy", owner]`.
#[constant]
pub const POLICY_SEED: &[u8] = b"pact-policy";

/// Seed for the replay-protection record: `["pact-intent", policy, intent_id]`.
#[constant]
pub const INTENT_SEED: &[u8] = b"pact-intent";

/// USDC uses 6 decimals. The program only supports 6-decimal mints (v1 = USDC).
#[constant]
pub const USDC_DECIMALS: u8 = 6;

/// Maximum number of allowlisted recipients stored in a policy account.
/// Plain `const` (not `#[constant]`): `usize` has no IDL representation.
pub const MAX_RECIPIENTS: usize = 16;

/// Default spending window: 24 hours, in seconds.
#[constant]
pub const DEFAULT_WINDOW_SECONDS: u64 = 86_400;
