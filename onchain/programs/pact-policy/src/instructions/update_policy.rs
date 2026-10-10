use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PactError;
use crate::events::PolicyUpdated;
use crate::state::PolicyAccount;

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
        has_one = owner @ PactError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,
}

/// Update mutable policy fields. `None` leaves a field unchanged.
/// Mint, owner, recipients and pause/revoke flags cannot change here.
/// Spending counters are never reset by an update.
pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    agent: Option<Pubkey>,
    max_per_payment: Option<u64>,
    window_limit: Option<u64>,
    window_seconds: Option<u64>,
    expires_at: Option<i64>,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(!policy.revoked, PactError::PolicyRevoked);

    if let Some(agent) = agent {
        policy.agent = agent;
    }
    if let Some(v) = max_per_payment {
        require!(v > 0, PactError::InvalidLimits);
        policy.max_per_payment = v;
    }
    if let Some(v) = window_limit {
        require!(v > 0, PactError::InvalidLimits);
        policy.window_limit = v;
    }
    if let Some(v) = window_seconds {
        require!(v > 0, PactError::InvalidLimits);
        policy.window_seconds = v;
    }
    if let Some(v) = expires_at {
        policy.expires_at = v;
    }

    policy.version = policy
        .version
        .checked_add(1)
        .ok_or(PactError::ArithmeticOverflow)?;

    emit!(PolicyUpdated {
        policy: policy.key(),
        version: policy.version,
    });
    Ok(())
}
