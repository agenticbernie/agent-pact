use anchor_lang::prelude::*;

#[event]
pub struct PolicyInitialized {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub version: u64,
}

#[event]
pub struct PolicyUpdated {
    pub policy: Pubkey,
    pub version: u64,
}

#[event]
pub struct RecipientAdded {
    pub policy: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct RecipientRemoved {
    pub policy: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct PolicyPaused {
    pub policy: Pubkey,
}

#[event]
pub struct PolicyUnpaused {
    pub policy: Pubkey,
}

#[event]
pub struct PolicyRevoked {
    pub policy: Pubkey,
}

#[event]
pub struct OwnerWithdrawal {
    pub policy: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PaymentExecuted {
    pub policy: Pubkey,
    pub intent_id: [u8; 32],
    pub amount: u64,
    pub recipient: Pubkey,
    pub agent: Pubkey,
    pub spent_in_window: u64,
    pub version: u64,
}
