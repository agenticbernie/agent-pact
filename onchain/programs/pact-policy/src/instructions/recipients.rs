use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PactError;
use crate::events::{RecipientAdded, RecipientRemoved};
use crate::state::PolicyAccount;

#[derive(Accounts)]
pub struct ManageRecipient<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
        has_one = owner @ PactError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,
}

pub fn handle_add_recipient(ctx: Context<ManageRecipient>, recipient: Pubkey) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(!policy.revoked, PactError::PolicyRevoked);
    if !policy.allowed_recipients.contains(&recipient) {
        require!(
            policy.allowed_recipients.len() < MAX_RECIPIENTS,
            PactError::TooManyRecipients
        );
        policy.allowed_recipients.push(recipient);
    }
    emit!(RecipientAdded {
        policy: policy.key(),
        recipient,
    });
    Ok(())
}

pub fn handle_remove_recipient(ctx: Context<ManageRecipient>, recipient: Pubkey) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(!policy.revoked, PactError::PolicyRevoked);
    policy.allowed_recipients.retain(|r| *r != recipient);
    emit!(RecipientRemoved {
        policy: policy.key(),
        recipient,
    });
    Ok(())
}
