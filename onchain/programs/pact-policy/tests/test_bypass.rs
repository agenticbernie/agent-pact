//! Bypass resistance + replay protection: the core security claim.
//! Vault funds must be movable ONLY through `pact-policy`; intent IDs must be
//! single-use; failed attempts must not consume allowance.

// Local helpers return LiteSVM's (large) error type by value for readable output.
#![allow(clippy::result_large_err)]

mod common;

use common::*;
use solana_signer::Signer;

#[test]
fn direct_spl_transfer_from_vault_fails_for_agent_and_owner() {
    // T3: the agent (or anyone but the policy PDA) calls the token program
    // directly. The token program enforces authority — both fail.
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        10_000_000,
        50_000_000,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        100_000_000,
    );
    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);

    // As the agent.
    fund(&mut svm, &s.agent.pubkey(), 1_000_000_000);
    let res = send(
        &mut svm,
        &s.agent,
        vec![ix_transfer(&vault, &rata, &s.agent.pubkey(), 1_000_000)],
        &[],
    );
    assert!(res.is_err(), "agent direct transfer must fail");

    // As the owner (vault authority is the PDA, NOT the owner).
    let res = send(
        &mut svm,
        &s.owner,
        vec![ix_transfer(&vault, &rata, &s.owner.pubkey(), 1_000_000)],
        &[],
    );
    assert!(res.is_err(), "owner direct transfer must fail");

    // Nothing moved.
    assert_eq!(token_balance(&svm, &vault), 100_000_000);
    assert_eq!(token_balance(&svm, &rata), 0);
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 0);
}

#[test]
fn duplicate_intent_id_replayed_fails() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        10_000_000,
        50_000_000,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        100_000_000,
    );
    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [21u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let pay = || {
        ix_execute_payment(
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
        )
    };

    send(&mut svm, &s.owner, vec![pay()], &[]).unwrap();
    // Exact replay: same intent_id, fresh blockhash.
    let res = send(&mut svm, &s.owner, vec![pay()], &[]);
    assert!(res.is_err(), "replayed intent must fail");
    // Only one payment settled.
    assert_eq!(token_balance(&svm, &vault), 99_000_000);
    assert_eq!(token_balance(&svm, &rata), 1_000_000);
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 1_000_000);

    // A fresh intent_id still works (record is per-intent, not a global lock).
    let intent_id2 = [22u8; 32];
    let (record2, _) = intent_pda(&policy, &intent_id2);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record2,
        intent_id2,
        1_000_000,
    );
    send(&mut svm, &s.owner, vec![ix], &[]).unwrap();
    assert_eq!(token_balance(&svm, &rata), 2_000_000);
}

#[test]
fn window_resets_after_period() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    // Tiny 50-second window so the test can cross it via clock control.
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        50_000_000,
        50_000_000,
        50,
        0,
        vec![s.recipient.pubkey()],
        1_000_000_000,
    );
    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let pay = |svm: &mut litesvm::LiteSVM, s: &Setup, byte: u8| {
        let intent_id = [byte; 32];
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
            30_000_000,
        );
        send(svm, &s.owner, vec![ix], &[])
    };

    pay(&mut svm, &s, 31).unwrap();
    assert!(pay(&mut svm, &s, 32).is_err()); // 60 > 50 in-window
    let t = now(&svm);
    set_clock(&mut svm, t + 51); // cross the window boundary
    pay(&mut svm, &s, 33).unwrap(); // fresh window: succeeds
    let st = read_policy(&svm, &policy);
    assert_eq!(st.spent_in_window, 30_000_000);
}

#[test]
fn tampered_backend_payment_still_bound_by_policy() {
    // T1/T2: a compromised backend builds a validly-signed-owner... no — it
    // cannot forge the owner signature. Instead it tricks the owner into
    // signing inflated parameters. On-chain limits still cap the damage:
    // the inflated payment fails, the honest one succeeds.
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        5_000_000, // 5 USDC max
        50_000_000,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        100_000_000,
    );
    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);

    // Backend claims "5 USDC" but puts 500 USDC in the instruction.
    let intent_id = [41u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let malicious = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        500_000_000,
    );
    let fail = send(&mut svm, &s.owner, vec![malicious], &[])
        .err()
        .unwrap();
    assert_eq!(custom_error(&fail), Some(err::EXCEEDS_PER_PAYMENT));
    assert_eq!(token_balance(&svm, &vault), 100_000_000);
}
