"use client";

import { RPC_URL } from "../lib/solana";

// The app is wired to one cluster (NEXT_PUBLIC_RPC_URL, devnet by default).
// Mainnet is intentionally not selectable yet.
const NETWORK = /mainnet/i.test(RPC_URL) ? "mainnet" : /testnet/i.test(RPC_URL) ? "testnet" : "devnet";

export default function NetworkSelector() {
  return (
    <select
      className="net-select"
      value={NETWORK}
      onChange={() => { /* only devnet is allowed for now */ }}
      title="Network — Mainnet is not available yet"
      aria-label="Network"
    >
      <option value="devnet">Devnet</option>
      <option value="testnet" disabled>Testnet</option>
      <option value="mainnet" disabled>Mainnet (soon)</option>
    </select>
  );
}
