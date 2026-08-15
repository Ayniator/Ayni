"use client";

import dynamic from "next/dynamic";

// "Connect", not "Select Wallet".
//
// The upstream WalletMultiButton hardcodes its own LABELS and passes them to
// BaseWalletMultiButton, so the only supported way to change the wording is to
// use the Base component directly and supply the whole label set. Every other
// label is kept at the upstream wording on purpose — this is a rename of one
// string, not a re-voicing of the wallet menu.
const LABELS = {
  "change-wallet": "Change wallet",
  connecting: "Connecting ...",
  "copy-address": "Copy address",
  copied: "Copied",
  disconnect: "Disconnect",
  // Upstream says "Connect" here already: a wallet is chosen but not connected.
  "has-wallet": "Connect",
  // Upstream says "Select Wallet". This is the one the user sees first, and
  // "Connect" is what it actually does.
  "no-wallet": "Connect",
} as const;

// The button reads `window`-registered wallets, so render it client-side only.
const BaseWalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).BaseWalletMultiButton,
  {
    ssr: false,
    // Match the real button's label so the swap at hydration is not a visible
    // word change.
    loading: () => <span className="wallet-fallback">Connect</span>,
  }
);

export default function WalletButton() {
  return (
    <span className="sol-wallet">
      <BaseWalletMultiButton labels={LABELS} />
    </span>
  );
}
