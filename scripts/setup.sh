#!/usr/bin/env bash
# One-shot toolchain bootstrap for building & testing the Ayni Anchor program.
# Idempotent: skips anything already installed. Pin versions via env vars.
set -euo pipefail

SOLANA_VERSION="${SOLANA_VERSION:-1.18.26}"
ANCHOR_VERSION="${ANCHOR_VERSION:-0.30.1}"

echo "==> Rust"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "==> Solana CLI ${SOLANA_VERSION}"
if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  echo "   (add to your shell: export PATH=\"\$HOME/.local/share/solana/install/active_release/bin:\$PATH\")"
fi

echo "==> Anchor ${ANCHOR_VERSION} (via avm)"
if ! command -v anchor >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
  avm install "${ANCHOR_VERSION}"
  avm use "${ANCHOR_VERSION}"
fi

echo "==> Localnet wallet"
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-bip39-passphrase -s -o "$HOME/.config/solana/id.json"
fi

echo "==> JS deps"
if command -v yarn >/dev/null 2>&1; then yarn install; else npm install; fi

echo "==> Done."
solana --version || true
anchor --version || true
