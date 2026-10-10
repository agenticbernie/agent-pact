//! Authorization: agent identity, owner-only mutations, pause/revoke/expiry.
//! A compromised backend or rogue agent must not be able to change policy or
//! execute outside it.

// Local helpers return LiteSVM's (large) error type by value for readable output.
#![allow(clippy::result_large_err)]

mod common;

use anchor_lang::{InstructionData, ToAccountMetas};
use common::*;
use solana_signer::Signer;

fn funded_policy(svm: &mut litesvm::LiteSVM, s: &Setup) -> anchor_lang::prelude::Pubkey {
    setup_policy_with_vault(
        svm,
        s,
        10_000_000,
        50_000_000,
        86_400,
        0,
        vec![s.recipient.pubkey()],
        1_000_000_000,
    )
}

fn pay_with_agent(
    svm: &mut litesvm::LiteSVM,
    s: &Setup,
    policy: &anchor_lang::prelude::Pubkey,
    agent: &anchor_lang::prelude::Pubkey,
    intent_byte: u8,
) -> TxResult {
    let vault = vault_ata(policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [intent_byte; 32];
    let (record, _) = intent_pda(policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        agent,
        policy,
        &vault,
        &s.recipient.pubkey(),
        &rata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    send(svm, &s.owner, vec![ix], &[])
}

#[test]
fn unauthorized_agent_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    let rogue = solana_keypair::Keypair::new();
    let fail = pay_with_agent(&mut svm, &s, &policy, &rogue.pubkey(), 1)
        .err()
        .unwrap();
    assert_eq!(custom_error(&fail), Some(err::AGENT_MISMATCH));
    assert_eq!(
        token_balance(&svm, &vault_ata(&policy, &s.mint)),
        1_000_000_000
    );
}

#[test]
fn unapproved_recipient_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    let outsider = solana_keypair::Keypair::new();
    let outsider_ata = recipient_ata(&outsider.pubkey(), &s.mint);
    create_token_account_at(
        &mut svm,
        &s.payer,
        &outsider_ata,
        &s.mint,
        &outsider.pubkey(),
    );

    let vault = vault_ata(&policy, &s.mint);
    let intent_id = [3u8; 32];
    let (record, _) = intent_pda(&policy, &intent_id);
    let ix = ix_execute_payment(
        &s.owner.pubkey(),
        &s.agent.pubkey(),
        &policy,
        &vault,
        &outsider.pubkey(),
        &outsider_ata,
        &s.mint,
        &record,
        intent_id,
        1_000_000,
    );
    let fail = send(&mut svm, &s.owner, vec![ix], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::RECIPIENT_NOT_ALLOWED));
}

#[test]
fn non_owner_cannot_mutate_policy() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);
    let attacker = solana_keypair::Keypair::new();
    fund(&mut svm, &attacker.pubkey(), 10_000_000_000);

    // update_policy signed by attacker.
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::UpdatePolicy {
            agent: Some(attacker.pubkey()),
            max_per_payment: Some(1),
            window_limit: Some(1),
            window_seconds: None,
            expires_at: None,
        }
        .data(),
        pact_policy::accounts::UpdatePolicy {
            owner: attacker.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    let fail = send(&mut svm, &attacker, vec![ix], &[]).err().unwrap();
    assert!(
        custom_error(&fail) == Some(err::UNAUTHORIZED) || logs(&fail).contains("has_one"),
        "unexpected failure: {}",
        logs(&fail)
    );

    // revoke signed by attacker.
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Revoke {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: attacker.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &attacker, vec![ix], &[]).is_err());

    // add_recipient signed by attacker.
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::AddRecipient {
            recipient: attacker.pubkey(),
        }
        .data(),
        pact_policy::accounts::ManageRecipient {
            owner: attacker.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &attacker, vec![ix], &[]).is_err());

    // Policy untouched.
    let st = read_policy(&svm, &policy);
    assert_eq!(st.agent, s.agent.pubkey());
    assert!(!st.revoked && !st.paused);
    assert_eq!(st.allowed_recipients, vec![s.recipient.pubkey()]);
}

#[test]
fn owner_signature_is_required_by_the_runtime_itself() {
    // The agent (or backend) alone cannot execute: the owner is marked
    // `is_signer` on the instruction, so a transaction without the owner's
    // signature is rejected by runtime signature verification — before any
    // program code runs.
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    let vault = vault_ata(&policy, &s.mint);
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    let intent_id = [5u8; 32];
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
        1_000_000,
    );
    // Agent pays the fee and signs its slot; the owner slot stays empty.
    fund(&mut svm, &s.agent.pubkey(), 1_000_000_000);
    let res = send_missing_sigs(&mut svm, &s.agent, vec![ix]);
    assert!(res.is_err(), "agent-only execution must fail");
    assert_eq!(token_balance(&svm, &vault), 1_000_000_000);
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 0);
}

#[test]
fn pause_halts_payments_and_unpause_restores() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Pause {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: s.owner.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &s.owner, vec![ix], &[]).unwrap();

    let fail = pay_with_agent(&mut svm, &s, &policy, &s.agent.pubkey(), 1)
        .err()
        .unwrap();
    assert_eq!(custom_error(&fail), Some(err::POLICY_PAUSED));

    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Unpause {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: s.owner.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &s.owner, vec![ix], &[]).unwrap();
    pay_with_agent(&mut svm, &s, &policy, &s.agent.pubkey(), 1).unwrap();
}

#[test]
fn revoke_is_permanent_and_unpause_cannot_resurrect() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    let revoke = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Revoke {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: s.owner.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &s.owner, vec![revoke], &[]).unwrap();

    let fail = pay_with_agent(&mut svm, &s, &policy, &s.agent.pubkey(), 1)
        .err()
        .unwrap();
    assert_eq!(custom_error(&fail), Some(err::POLICY_REVOKED));

    // Unpause on a revoked policy is rejected.
    let unpause = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Unpause {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: s.owner.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    let fail = send(&mut svm, &s.owner, vec![unpause], &[]).err().unwrap();
    assert_eq!(custom_error(&fail), Some(err::REVOKE_IS_PERMANENT));
}

#[test]
fn expired_policy_rejected() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    // Expires 100s after setup clock.
    let t0 = now(&svm);
    let policy = setup_policy_with_vault(
        &mut svm,
        &s,
        10_000_000,
        50_000_000,
        86_400,
        t0 + 100,
        vec![s.recipient.pubkey()],
        1_000_000_000,
    );
    // Payment before expiry works.
    pay_with_agent(&mut svm, &s, &policy, &s.agent.pubkey(), 1).unwrap();
    // After expiry it fails.
    set_clock(&mut svm, t0 + 101);
    let fail = pay_with_agent(&mut svm, &s, &policy, &s.agent.pubkey(), 2)
        .err()
        .unwrap();
    assert_eq!(custom_error(&fail), Some(err::POLICY_EXPIRED));
}

#[test]
fn owner_can_evacuate_vault_while_paused() {
    let mut svm = setup_svm();
    let s = basic_setup(&mut svm);
    let policy = funded_policy(&mut svm, &s);

    // Pause first (simulates incident response).
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::Pause {}.data(),
        pact_policy::accounts::ControlPolicy {
            owner: s.owner.pubkey(),
            policy,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &s.owner, vec![ix], &[]).unwrap();

    // Owner withdraws everything to their own token account while paused.
    let dest = recipient_ata(&s.owner.pubkey(), &s.mint);
    create_token_account_at(&mut svm, &s.payer, &dest, &s.mint, &s.owner.pubkey());
    let vault = vault_ata(&policy, &s.mint);
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::OwnerWithdraw {
            amount: 1_000_000_000,
        }
        .data(),
        pact_policy::accounts::OwnerWithdraw {
            owner: s.owner.pubkey(),
            policy,
            vault,
            destination: dest,
            mint: s.mint,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    let res = send(&mut svm, &s.owner, vec![ix], &[]);
    assert!(
        res.is_ok(),
        "evacuation failed: {:?}",
        res.err().map(|f| logs(&f))
    );
    assert_eq!(token_balance(&svm, &vault), 0);
    assert_eq!(token_balance(&svm, &dest), 1_000_000_000);
    // Escape hatch does not consume the agent window.
    assert_eq!(read_policy(&svm, &policy).spent_in_window, 0);
}
