//! Spending-limit enforcement: per-payment max, cumulative window,
//! sequential joint-over-limit, zero amounts, u64 boundaries.
//! Every rejection must move no funds and consume no allowance.

// Local helpers return LiteSVM's (large) error type by value for readable output.
#![allow(clippy::result_large_err)]

mod common;

use common::*;
use solana_signer::Signer;

fn funded_policy(
    svm: &mut litesvm::LiteSVM,
    s: &Setup,
    max: u64,
    window: u64,
) -> anchor_lang::prelude::Pubkey {
    setup_policy_with_vault(
        svm,
        s,
        max,
        window,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        1_000_000_000,
    )
}

fn pay(
    svm: &mut litesvm::LiteSVM,
    s: &Setup,
    policy: &anchor_lang::prelude::Pubkey,
    intent_byte: u8,
    amount: u64,
) -> TxResult {
    let vault = vault_ata(policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [intent_byte; 32];
    let (record, _) = intent_pda(policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        amount,
    );
    send(svm, &s.owner, vec![ix], &[])
}

#[test]
fn payment_exceeding_per_transaction_limit_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s, 10_000_000, 50_000_000);

    let vault = vault_ata(&policy, &s.mint);
    let before = token_balance(&svm, &vault);
    let fail = pay(&mut svm, &s, &policy, 1, 10_000_001).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::EXCEEDS_PER_PAYMENT));

    // No funds moved, no allowance consumed.
    assert_eq!(token_balance(&svm, &vault), before);
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 0);
}

#[test]
fn payment_exceeding_window_limit_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s, 50_000_000, 50_000_000);

    // First payment of 40 USDC succeeds.
    pay(&mut svm, &s, &policy, 1, 40_000_000).unwrap();
    // Second payment of 20 USDC would total 60 > 50 → rejected.
    let fail = pay(&mut svm, &s, &policy, 2, 20_000_000).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::EXCEEDS_WINDOW));

    let vault = vault_ata(&policy, &s.mint);
    assert_eq!(token_balance(&svm, &vault), 1_000_000_000 - 40_000_000);
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 40_000_000);
}

#[test]
fn sequential_payments_that_jointly_exceed_limit_fail() {
    // Each payment is valid alone; together they exceed the window.
    // On-chain serialization means the second write observes the first —
    // there is no TOCTOU gap between check and counter update.
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s, 30_000_000, 50_000_000);

    pay(&mut svm, &s, &policy, 1, 30_000_000).unwrap();
    let fail = pay(&mut svm, &s, &policy, 2, 30_000_000).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::EXCEEDS_WINDOW));
    // Exact-fit payment succeeds.
    pay(&mut svm, &s, &policy, 3, 20_000_000).unwrap();
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 50_000_000);
}

#[test]
fn zero_amount_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s, 10_000_000, 50_000_000);
    let fail = pay(&mut svm, &s, &policy, 1, 0).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::INVALID_AMOUNT));
}

#[test]
fn u64_boundary_amounts_do_not_overflow() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    // Limits at u64::MAX; vault funded to the max token supply.
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        u64::MAX,
        u64::MAX,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        u64::MAX,
    );
    // Paying the entire u64::MAX supply works (checked math holds).
    pay(&mut svm, &s, &policy, 1, u64::MAX).unwrap();
    assert_eq!(read_policy(&svm, &policy).spent_in_window, u64::MAX);

    // Any further payment would overflow spent_in_window → ArithmeticOverflow,
    // NOT a silent wrap that resets the counter to ~0.
    let fail = pay(&mut svm, &s, &policy, 2, 1).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::ARITHMETIC_OVERFLOW));
    assert_eq!(read_policy(&svm, &policy).spent_in_window, u64::MAX);
}

#[test]
fn failed_settlement_leaves_consistent_accounting() {
    // Recipient ATA with the WRONG mint: the token CPI itself fails.
    // Accounting must be untouched (checks-then-CPI-then-commit ordering).
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s, 50_000_000, 50_000_000);

    let other_mint = create_mint(&mut svm, &s.payer, &s.payer.pubkey(), 6);
    let bad_ata = recipient_ata(&s.recipient.pubkey(), &other_mint);
    create_token_account_at(
        &mut svm,
        &s.payer,
        &bad_ata,
        &other_mint,
        &s.recipient.pubkey(),
    );

    let vault = vault_ata(&policy, &s.mint);
    let intent_id = [9u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &bad_ata, // wrong-mint account at a non-canonical address
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    let res = send(&mut svm, &s.owner, vec![ix], &[]);
    assert!(res.is_err());
    // Allowance untouched and vault intact.
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 0);
    assert_eq!(token_balance(&svm, &vault), 1_000_000_000);
}
