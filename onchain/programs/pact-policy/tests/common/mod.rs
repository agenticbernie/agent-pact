//! Shared harness for Pact policy adversarial tests.
//!
//! Every test executes the **compiled SBF program** (`anchor build` output)
//! together with the **real SPL Token Program binary** (dumped from devnet,
//! see `fixtures/README.md`) inside LiteSVM. Nothing about settlement is
//! mocked: CPIs run genuine token-program code.

// Shared across test binaries: each binary uses a subset.
#![allow(dead_code)]
// `TxResult`'s error type comes from LiteSVM and is large by construction;
// boxing it would only obscure failure output.
#![allow(clippy::result_large_err)]

use anchor_lang::{
    prelude::{pubkey, rent, Clock, Pubkey},
    solana_program::system_instruction,
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token::ID as TOKEN_ID,
};
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub use pact_policy::state::{IntentRecord, PolicyAccount};

pub const PACT_SO: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/pact_policy.so"
));
pub const TOKEN_SO: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/tokenkeg.so"
));
pub const ATA_SO: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/ata.so"
));

/// Associated Token Program ID (same on all clusters).
pub const ATA_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub const MINT_LEN: usize = 82;

/// Anchor `#[error_code]` discriminants: 6000 + declaration index in
/// `programs/pact-policy/src/error.rs`.
#[allow(dead_code)]
pub mod err {
    pub const INVALID_AMOUNT: u32 = 6000;
    pub const EXCEEDS_PER_PAYMENT: u32 = 6001;
    pub const EXCEEDS_WINDOW: u32 = 6002;
    pub const POLICY_REVOKED: u32 = 6003;
    pub const POLICY_PAUSED: u32 = 6004;
    pub const POLICY_EXPIRED: u32 = 6005;
    pub const AGENT_MISMATCH: u32 = 6006;
    pub const RECIPIENT_NOT_ALLOWED: u32 = 6007;
    pub const RECIPIENT_ACCOUNT_MISMATCH: u32 = 6008;
    pub const VAULT_MISMATCH: u32 = 6009;
    pub const MINT_MISMATCH: u32 = 6010;
    pub const INVALID_MINT_DECIMALS: u32 = 6011;
    pub const INVALID_LIMITS: u32 = 6012;
    pub const TOO_MANY_RECIPIENTS: u32 = 6013;
    pub const ARITHMETIC_OVERFLOW: u32 = 6014;
    pub const UNAUTHORIZED: u32 = 6015;
    pub const REVOKE_IS_PERMANENT: u32 = 6016;
}

// ---------------------------------------------------------------------------
// SVM setup
// ---------------------------------------------------------------------------

pub fn setup_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.add_program(pact_policy::id(), PACT_SO).unwrap();
    svm.add_program(TOKEN_ID, TOKEN_SO).unwrap();
    svm.add_program(ATA_ID, ATA_SO).unwrap();
    svm
}

pub fn fund(svm: &mut LiteSVM, who: &Pubkey, lamports: u64) {
    svm.airdrop(who, lamports).unwrap();
}

pub fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    let clock = Clock {
        unix_timestamp,
        ..svm.get_sysvar::<Clock>()
    };
    svm.set_sysvar(&clock);
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

// ---------------------------------------------------------------------------
// Transaction plumbing
// ---------------------------------------------------------------------------

pub type TxResult = Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata>;

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ixs: Vec<anchor_lang::solana_program::instruction::Instruction>,
    extra_signers: &[&Keypair],
) -> TxResult {
    // Fresh blockhash per transaction (like a live cluster): without this,
    // two byte-identical instructions would share a signature and the second
    // would be rejected as AlreadyProcessed instead of executing — which
    // would mask the very replay behavior the tests must exercise.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs.as_slice(), Some(&payer.pubkey()), &blockhash);
    // Dedupe: payer is frequently also the mint/transfer authority.
    // `try_new` demands an exact signer count, so duplicates must go.
    let mut seen = std::collections::HashSet::new();
    let mut signers = vec![payer];
    signers.extend_from_slice(extra_signers);
    signers.retain(|k| seen.insert(k.pubkey()));
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
}

/// Submit a transaction where the fee payer signed but other required
/// signers did not. The runtime (sigverify) must reject it — this is what
/// the network itself enforces for a missing owner signature.
pub fn send_missing_sigs(
    svm: &mut LiteSVM,
    fee_payer: &Keypair,
    ixs: Vec<anchor_lang::solana_program::instruction::Instruction>,
) -> TxResult {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs.as_slice(), Some(&fee_payer.pubkey()), &blockhash);
    let n = msg.header.num_required_signatures as usize;
    let data = VersionedMessage::Legacy(msg.clone()).serialize();
    let mut signatures = vec![Default::default(); n];
    for (i, key) in msg.account_keys[..n].iter().enumerate() {
        if key == &fee_payer.pubkey() {
            signatures[i] = fee_payer.try_sign_message(&data).unwrap();
        }
    }
    let tx = VersionedTransaction {
        signatures,
        message: VersionedMessage::Legacy(msg),
    };
    svm.send_transaction(tx)
}

/// Extract the Anchor custom error code from a failed transaction, if any.
pub fn custom_error(fail: &FailedTransactionMetadata) -> Option<u32> {
    use solana_transaction::{InstructionError, TransactionError};
    match &fail.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

pub fn logs(fail: &FailedTransactionMetadata) -> String {
    fail.meta.logs.join("\n")
}

// ---------------------------------------------------------------------------
// Minimal SPL Token client (stable instruction layouts, no extra deps)
// ---------------------------------------------------------------------------

fn token_ix(
    program_id: Pubkey,
    accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
    data: Vec<u8>,
) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction {
        program_id,
        accounts,
        data,
    }
}

use anchor_lang::solana_program::instruction::AccountMeta;

fn u64le(v: u64) -> Vec<u8> {
    v.to_le_bytes().to_vec()
}

pub fn ix_init_mint(
    mint: &Pubkey,
    authority: &Pubkey,
    decimals: u8,
) -> anchor_lang::solana_program::instruction::Instruction {
    let mut data = vec![0u8, decimals];
    data.extend_from_slice(&authority.to_bytes());
    data.push(0u8); // freeze authority: None
    token_ix(
        TOKEN_ID,
        vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new_readonly(rent::ID, false),
        ],
        data,
    )
}

pub fn ix_mint_to(
    mint: &Pubkey,
    dest: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    let mut data = vec![7u8];
    data.extend(u64le(amount));
    token_ix(
        TOKEN_ID,
        vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    )
}

pub fn ix_transfer(
    src: &Pubkey,
    dst: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    let mut data = vec![3u8];
    data.extend(u64le(amount));
    token_ix(
        TOKEN_ID,
        vec![
            AccountMeta::new(*src, false),
            AccountMeta::new(*dst, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    )
}

pub fn create_mint(svm: &mut LiteSVM, payer: &Keypair, authority: &Pubkey, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(MINT_LEN);
    let ixs = vec![
        system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            rent,
            MINT_LEN as u64,
            &TOKEN_ID,
        ),
        ix_init_mint(&mint.pubkey(), authority, decimals),
    ];
    send(svm, payer, ixs, &[&mint]).unwrap();
    mint.pubkey()
}

/// Create the canonical ATA for `(owner, mint)` through the **real
/// Associated Token Program** (`CreateIdempotent`). Anyone can fund an ATA
/// for anyone — no owner signature is needed, exactly as on mainnet.
pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, ata: &Pubkey, owner: &Pubkey, mint: &Pubkey) {
    let ix = token_ix(
        ATA_ID,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(*ata, false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(TOKEN_ID, false),
        ],
        vec![1u8], // CreateIdempotent
    );
    send(svm, payer, vec![ix], &[]).unwrap();
}

/// Create a token account **at an exact address** (needed for ATA-derivation
/// checks: the account must live at the canonical ATA address).
pub fn create_token_account_at(
    svm: &mut LiteSVM,
    payer: &Keypair,
    addr: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
) {
    assert_eq!(
        addr,
        &recipient_ata(owner, mint),
        "test helper only creates canonical ATAs"
    );
    create_ata(svm, payer, addr, owner, mint);
}

pub fn mint_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    authority: &Keypair,
    amount: u64,
) {
    send(
        svm,
        payer,
        vec![ix_mint_to(mint, dest, &authority.pubkey(), amount)],
        &[authority],
    )
    .unwrap();
}

/// Raw SPL token `amount` (u64, base units) held by a token account.
pub fn token_balance(svm: &LiteSVM, addr: &Pubkey) -> u64 {
    let acc = svm.get_account(addr).expect("token account missing");
    let data = &acc.data;
    assert!(data.len() >= 72, "not a token account");
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

// ---------------------------------------------------------------------------
// Pact helpers
// ---------------------------------------------------------------------------

pub fn policy_pda(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[pact_policy::constants::POLICY_SEED, owner.as_ref()],
        &pact_policy::id(),
    )
}

pub fn intent_pda(policy: &Pubkey, intent_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            pact_policy::constants::INTENT_SEED,
            policy.as_ref(),
            intent_id.as_ref(),
        ],
        &pact_policy::id(),
    )
}

pub fn vault_ata(policy: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(policy, mint, &TOKEN_ID)
}

pub fn recipient_ata(recipient: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(recipient, mint, &TOKEN_ID)
}

pub fn read_policy(svm: &LiteSVM, policy: &Pubkey) -> PolicyAccount {
    let acc = svm.get_account(policy).expect("policy account missing");
    let mut data: &[u8] = &acc.data;
    PolicyAccount::try_deserialize(&mut data).unwrap()
}

pub fn read_record(svm: &LiteSVM, record: &Pubkey) -> IntentRecord {
    let acc = svm.get_account(record).expect("intent record missing");
    let mut data: &[u8] = &acc.data;
    IntentRecord::try_deserialize(&mut data).unwrap()
}

#[allow(clippy::too_many_arguments)]
pub fn ix_initialize_policy(
    owner: &Pubkey,
    policy: &Pubkey,
    mint: &Pubkey,
    agent: Pubkey,
    max_per_payment: u64,
    window_limit: u64,
    window_seconds: u64,
    expires_at: i64,
    allowed_recipients: Vec<Pubkey>,
) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::InitializePolicy {
            agent,
            max_per_payment,
            window_limit,
            window_seconds,
            expires_at,
            allowed_recipients,
        }
        .data(),
        pact_policy::accounts::InitializePolicy {
            owner: *owner,
            policy: *policy,
            mint: *mint,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn ix_execute_payment(
    owner: &Pubkey,
    agent: &Pubkey,
    policy: &Pubkey,
    vault: &Pubkey,
    recipient: &Pubkey,
    recipient_ata: &Pubkey,
    mint: &Pubkey,
    record: &Pubkey,
    intent_id: [u8; 32],
    amount: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        pact_policy::id(),
        &pact_policy::instruction::ExecutePayment { intent_id, amount }.data(),
        pact_policy::accounts::ExecutePayment {
            owner: *owner,
            agent: *agent,
            policy: *policy,
            vault: *vault,
            recipient: *recipient,
            recipient_ata: *recipient_ata,
            mint: *mint,
            intent_record: *record,
            token_program: TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Standard funded setup: payer (also mint authority), owner, agent,
/// recipient + 6-decimal mint. Returns (mint, recipient).
pub struct Setup {
    pub payer: Keypair,
    pub owner: Keypair,
    pub agent: Keypair,
    pub recipient: Keypair,
    pub mint: Pubkey,
}

pub fn basic_setup(svm: &mut LiteSVM) -> Setup {
    let payer = Keypair::new();
    let owner = Keypair::new();
    let agent = Keypair::new();
    let recipient = Keypair::new();
    fund(svm, &payer.pubkey(), 10_000_000_000);
    fund(svm, &owner.pubkey(), 10_000_000_000);
    let mint = create_mint(svm, &payer, &payer.pubkey(), 6);
    set_clock(svm, 1_700_000_000);
    Setup {
        payer,
        owner,
        agent,
        recipient,
        mint,
    }
}

/// Initialize a policy plus a funded vault (vault created at the canonical
/// ATA address with authority = policy PDA, then funded with `vault_funds`).
#[allow(clippy::too_many_arguments)]
pub fn setup_policy_with_vault(
    svm: &mut LiteSVM,
    s: &Setup,
    max_per_payment: u64,
    window_limit: u64,
    window_seconds: u64,
    expires_at: i64,
    allowed_recipients: Vec<Pubkey>,
    vault_funds: u64,
) -> Pubkey {
    let (policy, _) = policy_pda(&s.owner.pubkey());
    let ix = ix_initialize_policy(
        &s.owner.pubkey(),
        &policy,
        &s.mint,
        s.agent.pubkey(),
        max_per_payment,
        window_limit,
        window_seconds,
        expires_at,
        allowed_recipients,
    );
    send(svm, &s.owner, vec![ix], &[]).unwrap();

    let vault = vault_ata(&policy, &s.mint);
    create_token_account_at(svm, &s.payer, &vault, &s.mint, &policy);
    if vault_funds > 0 {
        mint_to(svm, &s.payer, &s.mint, &vault, &s.payer, vault_funds);
    }
    // Recipient ATA at the canonical address, owned by the recipient.
    let rata = recipient_ata(&s.recipient.pubkey(), &s.mint);
    create_token_account_at(svm, &s.payer, &rata, &s.mint, &s.recipient.pubkey());
    policy
}
