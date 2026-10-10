use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PactError;
use crate::events::{PolicyPaused, PolicyRevoked, PolicyUnpaused};
use crate::state::PolicyAccount;

#[derive(Accounts)]
pub struct ControlPolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
        has_one = owner @ PactError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,
}

/// Halt agent payments immediately. Owner withdrawal still works while paused.
pub fn handle_pause(ctx: Context<ControlPolicy>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(!policy.revoked, PactError::PolicyRevoked);
    policy.paused = true;
    emit!(PolicyPaused {
        policy: policy.key()
    });
    Ok(())
}

pub fn handle_unpause(ctx: Context<ControlPolicy>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    // A revoked policy stays dead: unpausing must not resurrect it.
    require!(!policy.revoked, PactError::RevokeIsPermanent);
    policy.paused = false;
    emit!(PolicyUnpaused {
        policy: policy.key()
    });
    Ok(())
}

/// Permanently disable agent payments under this policy. Irreversible;
/// recovery means initializing a new policy. Vault funds remain recoverable
/// via `owner_withdraw`.
pub fn handle_revoke(ctx: Context<ControlPolicy>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.revoked = true;
    emit!(PolicyRevoked {
        policy: policy.key()
    });
    Ok(())
}
