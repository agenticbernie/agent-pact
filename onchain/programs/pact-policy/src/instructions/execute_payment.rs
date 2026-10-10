use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::PactError;
use crate::events::PaymentExecuted;
use crate::state::{IntentRecord, PolicyAccount};

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32], amount: u64)]
pub struct ExecutePayment<'info> {
    /// User confirmation, verified on-chain: no owner signature, no payment.
    #[account(mut)]
    pub owner: Signer<'info>,
    /// Authorized agent identity (v1: must match, not required to sign).
    /// CHECK: key equality with `policy.agent` is enforced in the handler.
    pub agent: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.owner.as_ref()],
        bump = policy.bump,
        has_one = owner @ PactError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,
    /// Vault token account (authority must be the policy PDA).
    /// CHECK: SPL-Token ownership, mint, and authority are deserialized and
    /// enforced explicitly in the handler (see `parse_spl_token_account`).
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// Recipient wallet. Bound to `recipient_ata` via canonical ATA derivation.
    /// CHECK: allowlist membership + ATA derivation enforced in the handler.
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: SPL-Token ownership and mint enforced explicitly in the handler,
    /// plus the canonical-ATA derivation check.
    #[account(mut)]
    pub recipient_ata: UncheckedAccount<'info>,
    /// CHECK: SPL-Token ownership, key equality with `policy.mint`, and
    /// decimals enforced explicitly in the handler.
    pub mint: UncheckedAccount<'info>,
    /// Replay protection + settlement evidence. `init` fails if `intent_id`
    /// was already executed under this policy.
    #[account(
        init,
        payer = owner,
        space = 8 + IntentRecord::INIT_SPACE,
        seeds = [INTENT_SEED, policy.key().as_ref(), intent_id.as_ref()],
        bump,
    )]
    pub intent_record: Account<'info, IntentRecord>,
    /// Constrained to the SPL Token Program ID: a fake token program is
    /// rejected before any CPI.
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Deserialize an SPL Token mint with strict program-ownership enforcement.
/// Token-2022 accounts are rejected (v1 supports SPL Token only).
pub fn parse_spl_mint(info: &AccountInfo) -> Result<Mint> {
    require!(info.owner == &token::ID, PactError::UnsupportedTokenProgram);
    let data = info.try_borrow_data()?;
    let mut data: &[u8] = &data;
    Mint::try_deserialize_unchecked(&mut data)
}

/// Deserialize an SPL Token account with strict program-ownership enforcement.
pub fn parse_spl_token_account(info: &AccountInfo) -> Result<TokenAccount> {
    require!(info.owner == &token::ID, PactError::UnsupportedTokenProgram);
    let data = info.try_borrow_data()?;
    let mut data: &[u8] = &data;
    TokenAccount::try_deserialize_unchecked(&mut data)
}

/// Validate policy, update spending counters, and settle via CPI — atomically.
/// A rejected payment transfers nothing and consumes no allowance: every check
/// runs before any state write or CPI, and a failed CPI aborts the whole
/// transaction.
pub fn handle_execute_payment(
    ctx: Context<ExecutePayment>,
    intent_id: [u8; 32],
    amount: u64,
) -> Result<()> {
    // Checks first, against a short-lived borrow; all values needed later are
    // copied out so the CPI below cannot overlap a mutable borrow.
    let (policy_key, policy_owner, policy_bump, policy_version, new_spent) = {
        let policy = &mut ctx.accounts.policy;

        // 1-2. Liveness.
        require!(!policy.revoked, PactError::PolicyRevoked);
        require!(!policy.paused, PactError::PolicyPaused);

        // 3. Expiry (0 = never expires). Time comes from on-chain Clock only.
        let now = Clock::get()?.unix_timestamp;
        require!(
            policy.expires_at == 0 || now <= policy.expires_at,
            PactError::PolicyExpired
        );

        // 4-5. Amount gates (backend assertions are never trusted).
        require!(amount > 0, PactError::InvalidAmount);
        require!(
            amount <= policy.max_per_payment,
            PactError::ExceedsPerPaymentLimit
        );

        // 6. Agent identity.
        require_keys_eq!(
            ctx.accounts.agent.key(),
            policy.agent,
            PactError::AgentMismatch
        );

        // 7. Recipient allowlist (empty = open, matching backend semantics).
        require!(
            policy.allowed_recipients.is_empty()
                || policy
                    .allowed_recipients
                    .contains(&ctx.accounts.recipient.key()),
            PactError::RecipientNotAllowed
        );

        // 8. Mint binding + decimals (SPL Token only).
        let spl_mint = parse_spl_mint(&ctx.accounts.mint.to_account_info())?;
        require_keys_eq!(
            ctx.accounts.mint.key(),
            policy.mint,
            PactError::MintMismatch
        );
        require!(
            spl_mint.decimals == USDC_DECIMALS,
            PactError::InvalidMintDecimals
        );

        // 8b. Vault binding: same mint, authority is this policy PDA.
        let spl_vault = parse_spl_token_account(&ctx.accounts.vault.to_account_info())?;
        require!(
            spl_vault.mint == policy.mint && spl_vault.owner == policy.key(),
            PactError::VaultMismatch
        );

        // 9. Recipient account binding: must be the canonical ATA for
        // (recipient, policy.mint). A substituted attacker ATA fails here.
        let expected_ata =
            anchor_spl::associated_token::get_associated_token_address_with_program_id(
                &ctx.accounts.recipient.key(),
                &policy.mint,
                &token::ID,
            );
        require_keys_eq!(
            ctx.accounts.recipient_ata.key(),
            expected_ata,
            PactError::RecipientAccountMismatch
        );
        let spl_rata = parse_spl_token_account(&ctx.accounts.recipient_ata.to_account_info())?;
        require!(
            spl_rata.mint == policy.mint,
            PactError::RecipientAccountMismatch
        );

        // 10-11. Lazy window reset + cumulative limit (checked arithmetic).
        if now >= policy.window_start {
            let elapsed = (now - policy.window_start) as u64;
            if elapsed >= policy.window_seconds {
                policy.window_start = now;
                policy.spent_in_window = 0;
            }
        }
        let new_spent = policy
            .spent_in_window
            .checked_add(amount)
            .ok_or(PactError::ArithmeticOverflow)?;
        require!(
            new_spent <= policy.window_limit,
            PactError::ExceedsWindowLimit
        );

        (
            policy.key(),
            policy.owner,
            policy.bump,
            policy.version,
            new_spent,
        )
    };

    // 12. Settle: CPI into the real SPL Token Program, authority = policy PDA.
    let seeds: &[&[u8]] = &[POLICY_SEED, policy_owner.as_ref(), &[policy_bump]];
    let signer_seeds = &[seeds];
    let cpi_accounts = token::TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.policy.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds);
    token::transfer_checked(cpi_ctx, amount, USDC_DECIMALS)?;

    // 13-14. Commit accounting + settlement evidence (only reachable if the
    // CPI succeeded — failed settlement leaves no inconsistent state).
    let now = Clock::get()?.unix_timestamp;
    let policy = &mut ctx.accounts.policy;
    policy.spent_in_window = new_spent;
    let record = &mut ctx.accounts.intent_record;
    record.policy = policy_key;
    record.intent_id = intent_id;
    record.amount = amount;
    record.recipient = ctx.accounts.recipient.key();
    record.executed_at = now;

    emit!(PaymentExecuted {
        policy: policy_key,
        intent_id,
        amount,
        recipient: ctx.accounts.recipient.key(),
        agent: ctx.accounts.agent.key(),
        spent_in_window: new_spent,
        version: policy_version,
    });
    Ok(())
}
