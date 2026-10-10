# Test fixtures

## `tokenkeg.so`

The **real SPL Token Program binary**, dumped from Solana devnet with:

```bash
solana program dump TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  tests/fixtures/tokenkeg.so --url https://api.devnet.solana.com
```

- SHA-256: `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697`
- Size: 108_600 bytes
- Loaded into LiteSVM in every test via `common::setup_svm()`, so CPIs
  execute the genuine token program — nothing about settlement is mocked.

## `ata.so`

The **real Associated Token Program binary**, dumped from Solana devnet with:

```bash
solana program dump ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  tests/fixtures/ata.so --url https://api.devnet.solana.com
```

- SHA-256: `6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d`
- Size: 105_032 bytes
- Used by the test harness to create vault/recipient ATAs exactly as wallets
  do on mainnet (the ATA program signs for the PDA address via
  `invoke_signed`, which no off-chain client can forge).

To re-dump (e.g. after a program upgrade on devnet), re-run the commands
above and update the hashes recorded here.
