//! Happy path + initialization validation, executed against the real program.

mod common;

use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use solana_signer::Signer;

#[test]
fn valid_payment_within_policy() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);

    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        10_000_000, // max 10 USDC
        50_000_000, // window 50 USDC
        86_400,
        0, // never expires
        vec![s.recipient.pubkey()],
        100_000_000, // vault funded with 100 USDC
    );

    // Policy state right after init.
    let st = read_policy(&svm, &policy);
    assert_eq!(st.owner, s.owner.pubkey());
    assert_eq!(st.agent, s.agent.pubkey());
    assert_eq!(st.mint, s.mint);
    assert_eq!(st.max_per_payment, 10_000_000);
    assert_eq!(st.window_limit, 50_000_000);
    assert_eq!(st.spent_in_window, 0);
    assert_eq!(st.version, 1);
    assert!(!st.paused && !st.revoked);
    assert_eq!(st.allowed_recipients, vec![s.recipient.pubkey()]);

    // Execute 3 USDC.
    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [7u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        3_000_000,
    );
    let res = send(&mut svm, &s.owner, vec![ix], &[]);
    assert!(
        res.is_ok(),
        "execute failed: {:?}",
        res.err().map(|f| logs(&f))
    );

    // Balances moved exactly.
    assert_eq!(token_balance(&svm, &vault), 97_000_000);
    assert_eq!(token_balance(&svm, &rata), 3_000_000);

    // Counters updated.
    let st = read_policy(&svm, &policy);
    assert_eq!(st.spent_in_window, 3_000_000);

    // Settlement evidence recorded.
    let rec = read_record(&svm, &record);
    assert_eq!(rec.policy, policy);
    assert_eq!(rec.intent_id, intent_id);
    assert_eq!(rec.amount, 3_000_000);
    assert_eq!(rec.recipient, s.recipient.pubkey());

    // Success log carries the settlement event. Anchor 1.x emits events via
    // `sol_log_data`, which LiteSVM renders as a base64 "Program data:" log
    // (not a "Program log:" line), so assert on the marker.
    let meta = res.unwrap();
    assert!(
        meta.logs.iter().any(|l| l.contains("Program data:")),
        "missing PaymentExecuted event in logs: {:?}",
        meta.logs
    );
}

#[test]
fn init_rejects_bad_mint_decimals() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    // 9-decimal mint must be rejected at init.
    let bad_mint = create_mint(&mut svm, &s.payer, &s.payer.pubkey(), 9);
    let (policy, _) = policy_pda(&s.owner.pubkey());
    let ix = ix_initialize_policy(
        &s.owner.pubkey(),
        &policy,
        &bad_mint,
        s.agent.pubkey(),
        10_000_000,
        50_000_000,
        86_400,
        0,
        vec![],
    );
    let res = send(&mut svm, &s.owner, vec![ix], &[]);
    assert!(res.is_err());
    let fail = res.err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::INVALID_MINT_DECIMALS));
}

#[test]
fn init_rejects_zero_limits_and_oversized_allowlist() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);

    // Zero max_per_payment.
    let (p1, _) = policy_pda(&s.owner.pubkey());
    let ix = ix_initialize_policy(
        &s.owner.pubkey(),
        &p1,
        &s.mint,
        s.agent.pubkey(),
        0,
        50_000_000,
        86_400,
        0,
        vec![],
    );
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::INVALID_LIMITS));

    // 17 recipients > cap of 16.
    let many: Vec<_> = (0..17)
        .map(|_| solana_keypair::Keypair::new().pubkey())
        .collect();
    let ix = ix_initialize_policy(
        &s.owner.pubkey(),
        &p1,
        &s.mint,
        s.agent.pubkey(),
        10_000_000,
        50_000_000,
        86_400,
        0,
        many,
    );
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::TOO_MANY_RECIPIENTS));
}

#[test]
fn zero_window_defaults_to_one_day() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        10_000_000,
        50_000_000,
        0, // default
        0,
        vec![],
        0,
    );
    let st = read_policy(&svm, &policy);
    assert_eq!(st.window_seconds, 86_400);
}

/// Sanity: raw Instruction import path used by adversarial tests compiles.
#[test]
fn instruction_type_available() {
    let _ = std::mem::size_of::<Instruction>();
}
