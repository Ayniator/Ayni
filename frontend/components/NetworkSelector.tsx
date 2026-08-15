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
      {/* Testnet is no longer offered: AHA is not deployed there, so listing it
          — even greyed out — implies a cluster you could switch to and a
          deployment that does not exist.

          It IS still rendered, conditionally, when the app is actually pointed
          at a testnet RPC. Removing the option outright would leave `value`
          matching nothing, and a <select> whose value matches no option renders
          BLANK — so a misconfigured deployment would show an empty network box
          instead of naming the cluster it is really talking to. This control
          exists to say which chain you are on; going blank is the one thing it
          must never do. In normal operation this branch is dead. */}
      {NETWORK === "testnet" && <option value="testnet">Testnet</option>}
      <option value="mainnet" disabled>Mainnet (soon)</option>
    </select>
  );
}
