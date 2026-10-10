use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PactError;
use crate::events::PolicyInitialized;
use crate::instructions::execute_payment::parse_spl_mint;
use crate::state::PolicyAccount;

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + PolicyAccount::INIT_SPACE,
        seeds = [POLICY_SEED, owner.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, PolicyAccount>,
    /// The mint this policy will control. Decimals are verified (must be 6).
    /// CHECK: SPL-Token ownership and decimals enforced explicitly in the handler.
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_initialize_policy(
    ctx: Context<InitializePolicy>,
    agent: Pubkey,
    max_per_payment: u64,
    window_limit: u64,
    window_seconds: u64,
    expires_at: i64,
    allowed_recipients: Vec<Pubkey>,
) -> Result<()> {
    // SPL-Token ownership first (Token-2022 rejected), then decimals.
    let spl_mint = parse_spl_mint(&ctx.accounts.mint.to_account_info())?;
    require!(
        spl_mint.decimals == USDC_DECIMALS,
        PactError::InvalidMintDecimals
    );
    require!(
        max_per_payment > 0 && window_limit > 0,
        PactError::InvalidLimits
    );
    require!(
        allowed_recipients.len() <= MAX_RECIPIENTS,
        PactError::TooManyRecipients
    );

    let window_seconds = if window_seconds == 0 {
        DEFAULT_WINDOW_SECONDS
    } else {
        window_seconds
    };
    require!(window_seconds > 0, PactError::InvalidLimits);

    let policy = &mut ctx.accounts.policy;
    policy.owner = ctx.accounts.owner.key();
    policy.agent = agent;
    policy.mint = ctx.accounts.mint.key();
    policy.max_per_payment = max_per_payment;
    policy.window_limit = window_limit;
    policy.window_seconds = window_seconds;
    policy.window_start = Clock::get()?.unix_timestamp;
    policy.spent_in_window = 0;
    policy.allowed_recipients = allowed_recipients;
    policy.expires_at = expires_at;
    policy.paused = false;
    policy.revoked = false;
    policy.version = 1;
    policy.bump = ctx.bumps.policy;

    emit!(PolicyInitialized {
        policy: policy.key(),
        owner: policy.owner,
        agent: policy.agent,
        mint: policy.mint,
        version: policy.version,
    });
    Ok(())
}
