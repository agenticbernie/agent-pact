//! Forged-account resistance: wrong PDAs, substituted token accounts,
//! wrong mint, fake token program. The program must validate every account
//! independently instead of trusting the transaction composer (backend/LLM).

// Local helpers return LiteSVM's (large) error type by value for readable output.
#![allow(clippy::result_large_err)]

mod common;

use common::*;
use solana_signer::Signer;

fn funded_policy(svm: &mut litesvm::LiteSVM) -> (Setup, anchor_lang::prelude::Pubkey) {
    let s = basic_setup(svm);
    let policy = setup_policy_with_vault(
        svm,
        &s,
        10_000_000,
        50_000_000,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        1_000_000_000,
    );
    (s, policy)
}

fn base_pay(
    svm: &mut litesvm::LiteSVM,
    s: &Setup,
    policy: &anchor_lang::prelude::Pubkey,
    mutate: impl FnOnce(&mut anchor_lang::solana_program::instruction::Instruction),
) -> TxResult {
    let vault = vault_ata(policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [11u8; 32];
    let (record, _) = intent_pda(policy, &intent_id);
    let mut ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    mutate(&mut ix);
    send(svm, &s.owner, vec![ix], &[])
}

#[test]
fn wrong_policy_pda_rejected() {
    let mut svm = setup_svm();
    let (s, _policy) = funded_policy(&mut svm);
    // Policy PDA derived for a DIFFERENT owner.
    let stranger = solana_keypair::Keypair::new();
    let (wrong_policy, _) = policy_pda(&stranger.pubkey());
    let fail = base_pay(&mut svm, &s, &wrong_policy, |_| {}).err().unwrap();
    // Uninitialized / wrong-seed account: Anchor account-deserialize or seeds
    // constraint fails before any handler logic.
    assert!(
        logs(&fail).contains("constraint")
            || logs(&fail).contains("failed to deserialize")
            || logs(&fail).contains("not enough account keys")
            || custom_error(&fail).is_some(),
        "unexpected failure: {}",
        logs(&fail)
    );
}

#[test]
fn substituted_vault_rejected() {
    let mut svm = setup_svm();
    let (s, policy) = funded_policy(&mut svm);
    // Attacker-owned token account passed as the vault.
    let attacker = solana_keypair::Keypair::new();
    let fake_vault = recipient_ata(&attacker.pubkey(), &s.mint);
    create_token_account_at(&mut svm, &s.payer, &fake_vault, &s.mint, &attacker.pubkey());
    mint_to(
        &mut svm,
        &s.payer,
        &s.mint,
        &fake_vault,
        &s.payer,
        5_000_000,
    );

    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [12u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &fake_vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::VAULT_MISMATCH));
    // Attacker's account untouched, real vault untouched.
    assert_eq!(token_balance(&svm, &fake_vault), 5_000_000);
    assert_eq!(
        token_balance(&svm, &vault_ata(&policy, &s.mint)),
        1_000_000_000
    );
}

#[test]
fn substituted_recipient_ata_rejected() {
    let mut svm = setup_svm();
    let (s, policy) = funded_policy(&mut svm);
    // Allowlisted recipient, but the destination is the ATTACKER's ATA.
    // The canonical-derivation check must catch the mismatch.
    let attacker = solana_keypair::Keypair::new();
    let attacker_ata = recipient_ata(&attacker.pubkey(), &s.mint);
    create_token_account_at(
        &mut svm,
        &s.payer,
        &attacker_ata,
        &s.mint,
        &attacker.pubkey(),
    );

    let vault = vault_ata(&policy, &s.mint);
    let intent_id = [13u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(), // allowlisted victim...
        &attacker_ata,         // ...but attacker's account
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::RECIPIENT_ACCOUNT_MISMATCH));
    assert_eq!(token_balance(&svm, &attacker_ata), 0);
    assert_eq!(token_balance(&svm, &vault), 1_000_000_000);
}

#[test]
fn wrong_mint_rejected() {
    let mut svm = setup_svm();
    let (s, policy) = funded_policy(&mut svm);
    // Attacker mints their own 6-decimal token and substitutes every
    // mint-bound account.
    let fake_mint = create_mint(&mut svm, &s.payer, &s.payer.pubkey(), 6);

    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [14u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let mut ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    // Swap the mint account meta (position 6 in the accounts list) for the fake.
    ix.accounts[6].pubkey = fake_mint;
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::MINT_MISMATCH));
}

#[test]
fn fake_token_program_rejected() {
    let mut svm = setup_svm();
    let (s, policy) = funded_policy(&mut svm);

    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [15u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let mut ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    // Swap the token_program account (position 8) for the System Program: a
    // malicious composer cannot redirect the CPI to attacker code.
    ix.accounts[8].pubkey = anchor_lang::system_program::ID;
    let res = send(&mut svm, &s.owner, vec![ix], &[]);
    assert!(res.is_err(), "fake token program must be rejected");
    assert_eq!(token_balance(&svm, &vault), 1_000_000_000);
}
