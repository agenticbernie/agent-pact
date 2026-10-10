pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY");

#[program]
pub mod pact_policy {
    use super::*;

    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        agent: Pubkey,
        max_per_payment: u64,
        window_limit: u64,
        window_seconds: u64,
        expires_at: i64,
        allowed_recipients: Vec<Pubkey>,
    ) -> Result<()> {
        crate::instructions::initialize_policy::handle_initialize_policy(
            ctx,
            agent,
            max_per_payment,
            window_limit,
            window_seconds,
            expires_at,
            allowed_recipients,
        )
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        agent: Option<Pubkey>,
        max_per_payment: Option<u64>,
        window_limit: Option<u64>,
        window_seconds: Option<u64>,
        expires_at: Option<i64>,
    ) -> Result<()> {
        crate::instructions::update_policy::handle_update_policy(
            ctx,
            agent,
            max_per_payment,
            window_limit,
            window_seconds,
            expires_at,
        )
    }

    pub fn add_recipient(ctx: Context<ManageRecipient>, recipient: Pubkey) -> Result<()> {
        crate::instructions::recipients::handle_add_recipient(ctx, recipient)
    }

    pub fn remove_recipient(ctx: Context<ManageRecipient>, recipient: Pubkey) -> Result<()> {
        crate::instructions::recipients::handle_remove_recipient(ctx, recipient)
    }

    pub fn pause(ctx: Context<ControlPolicy>) -> Result<()> {
        crate::instructions::control::handle_pause(ctx)
    }

    pub fn unpause(ctx: Context<ControlPolicy>) -> Result<()> {
        crate::instructions::control::handle_unpause(ctx)
    }

    pub fn revoke(ctx: Context<ControlPolicy>) -> Result<()> {
        crate::instructions::control::handle_revoke(ctx)
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        crate::instructions::owner_withdraw::handle_owner_withdraw(ctx, amount)
    }

    pub fn execute_payment(
        ctx: Context<ExecutePayment>,
        intent_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        crate::instructions::execute_payment::handle_execute_payment(ctx, intent_id, amount)
    }
}
