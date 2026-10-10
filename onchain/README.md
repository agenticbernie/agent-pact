# Pact On-Chain Policy Program

Custom Solana program (Anchor 1.x) that enforces Pact spending policies
**on-chain** for agent-driven USDC payments. The backend, frontend and LLM
may construct payment requests, but only this program can authorize settlement
from a policy vault.

- Design authority: [`THREAT_MODEL.md`](THREAT_MODEL.md) (threats → invariants → tests)
- Normative spec: [`SPEC.md`](SPEC.md) (instructions, accounts, errors, events)
- Integration: [`INTEGRATION.md`](INTEGRATION.md) (deploy, configure, fund, verify)

## Layout

```
onchain/
  Anchor.toml                 # program id, localnet cluster, `cargo test` script
  Cargo.toml                  # cargo workspace
  rust-toolchain.toml         # pinned Rust 1.89.0
  programs/pact-policy/
    src/                      # program: lib, state, events, error, instructions/*
    tests/                    # LiteSVM adversarial suite (real program + real SPL binaries)
    tests/fixtures/           # tokenkeg.so + ata.so dumped from devnet (hashes in README)
  THREAT_MODEL.md  SPEC.md  INTEGRATION.md  README.md
```

Program ID (initial devnet key): `6Ygcr4fxma8ddFEkRphk73UBz8Ykdx97GFxcKjNFu1WY`

## Trust model (one paragraph)

Vault USDC is owned by the policy PDA, so it can only move through this
program. Every payment needs the owner's signature (user confirmation,
checked on-chain) and must satisfy the stored policy (agent identity,
per-payment max, window limit, allowlist, mint, expiry) atomically with the
SPL CPI. The owner can pause, revoke, or evacuate at any time. Details and
accepted limitations: `THREAT_MODEL.md` §§3–6.

## Build / test

```bash
cd onchain
anchor build          # SBF program -> target/deploy/pact_policy.so + IDL + types
cargo test            # 28 LiteSVM tests: real program, real SPL Token + ATA binaries
cargo fmt --check
cargo clippy --all-targets   # must be warning-free
```

`cargo test` requires `anchor build` first (tests `include_bytes!` the `.so`).
No validator, no airdrop, no network needed for tests.

## Backend wiring

`PACT_POLICY_PROGRAM_ID=<program id>` switches `build-transaction` to the
vault path (`backend/src/services/solana/policyProgram.ts`). Unset = legacy
direct-SPL path. Backend parity tests (`backend/tests/policyProgram.test.ts`)
check the instruction layout against the generated IDL. Full flow:
`INTEGRATION.md`.
