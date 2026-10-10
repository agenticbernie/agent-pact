use anchor_lang::prelude::*;

#[error_code]
pub enum PactError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Payment exceeds the maximum amount per transaction")]
    ExceedsPerPaymentLimit,
    #[msg("Payment exceeds the cumulative spending limit for the current window")]
    ExceedsWindowLimit,
    #[msg("Policy has been revoked; no further payments are possible")]
    PolicyRevoked,
    #[msg("Policy is paused; payments are temporarily halted")]
    PolicyPaused,
    #[msg("Policy has expired")]
    PolicyExpired,
    #[msg("Agent identity does not match the authorized agent on this policy")]
    AgentMismatch,
    #[msg("Recipient is not on this policy's allowlist")]
    RecipientNotAllowed,
    #[msg("Recipient token account is not the canonical account for this recipient and mint")]
    RecipientAccountMismatch,
    #[msg("Vault token account is not owned by this policy or has the wrong mint")]
    VaultMismatch,
    #[msg("Mint does not match the policy mint")]
    MintMismatch,
    #[msg("Only 6-decimal mints (USDC) are supported")]
    InvalidMintDecimals,
    #[msg("Policy limits must be greater than zero")]
    InvalidLimits,
    #[msg("Recipient allowlist is full")]
    TooManyRecipients,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Only the policy owner can perform this action")]
    Unauthorized,
    #[msg("A revoked policy cannot be unpaused; create a new policy")]
    RevokeIsPermanent,
    #[msg("Token account is not owned by the SPL Token Program (Token-2022 unsupported)")]
    UnsupportedTokenProgram,
}
