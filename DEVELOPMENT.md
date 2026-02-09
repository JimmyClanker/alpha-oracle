# Development Guide

## Prerequisites

- Rust 1.79+ with Solana toolchain
- Node.js 18+
- Anchor CLI 0.32.1
- Solana CLI 3.0+

## Setup

### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 2. Install Solana
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

### 3. Install Anchor
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.32.1
avm use 0.32.1
```

### 4. Configure Wallet
```bash
solana config set --url devnet
solana config set --keypair ~/.config/solana/jimmy-solana.json
```

## Build

```bash
anchor build
```

## Deploy (Devnet)

```bash
# Fund wallet first (need ~2 SOL)
solana airdrop 2

# Deploy
anchor deploy
```

## Test

```bash
anchor test
```

## Project Structure

```
alpha-oracle/
├── programs/
│   └── alpha_oracle/
│       └── src/
│           └── lib.rs          # Solana program
├── oracle-agent/
│   ├── oracle.py               # Signal poster
│   ├── verifier.py             # Result verifier
│   └── requirements.txt
├── app/
│   └── src/
│       └── client.ts           # TypeScript SDK
├── Anchor.toml                 # Anchor config
└── README.md
```

## Key Addresses

- **Program ID**: `BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV`
- **Oracle PDA**: `["oracle", authority]`
- **Prediction PDA**: `["prediction", oracle, prediction_id]`

## Useful Commands

```bash
# Check program size
ls -la target/deploy/alpha_oracle.so

# Get program ID
solana address -k target/deploy/alpha_oracle-keypair.json

# Sync program IDs
anchor keys sync

# Run oracle agent
cd oracle-agent
source venv/bin/activate
python oracle.py

# Run verifier
python verifier.py
```
