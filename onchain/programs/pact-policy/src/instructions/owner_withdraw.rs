use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token};

use crate::constants::*;
use crate::error::PactError;
use crate::events::OwnerWithdrawal;
use crate::instructions::execute_payment::{parse_spl_mint, parse_spl_token_account};
use crate::state::PolicyAccount;

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
        has_one = owner @ PactError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,
    /// CHECK: SPL-Token ownership, mint, and authority enforced in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: SPL-Token ownership and mint enforced in the handler.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: SPL-Token ownership and key equality enforced in the handler.
    pub mint: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Emergency / explicit owner escape hatch. Deliberately policy-exempt: it
/// works while paused or revoked, and never consumes the agent spending
/// window. Every withdrawal emits an event for auditability.
pub fn handle_owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, PactError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.mint.key(),
        ctx.accounts.policy.mint,
        PactError::MintMismatch
    );

    // Explicit SPL-Token validation (SPL Token only; Token-2022 rejected).
    parse_spl_mint(&ctx.accounts.mint.to_account_info())?;
    let spl_vault = parse_spl_token_account(&ctx.accounts.vault.to_account_info())?;
    require!(
        spl_vault.mint == ctx.accounts.policy.mint && spl_vault.owner == ctx.accounts.policy.key(),
        PactError::VaultMismatch
    );
    let spl_dest = parse_spl_token_account(&ctx.accounts.destination.to_account_info())?;
    require!(
        spl_dest.mint == ctx.accounts.policy.mint,
        PactError::MintMismatch
    );

    let policy = &ctx.accounts.policy;
    let seeds: &[&[u8]] = &[POLICY_SEED, policy.owner.as_ref(), &[policy.bump]];
    let signer_seeds = &[seeds];
    let cpi_accounts = token::TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.policy.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token::transfer_checked(cpi_ctx, amount, USDC_DECIMALS)?;

    emit!(OwnerWithdrawal {
        policy: policy.key(),
        destination: ctx.accounts.destination.key(),
        amount,
    });
    Ok(())
}
