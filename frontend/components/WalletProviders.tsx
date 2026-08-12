"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "../lib/solana";
// Vendored copy — upstream pulls Google Fonts on every page (see the header
// of app/wallet-adapter.css). Never import the upstream stylesheet directly.
import "../app/wallet-adapter.css";

/**
 * App-wide Solana wallet context. We pass no adapter list: every modern wallet
 * (Phantom, Solflare, Backpack…) registers itself via the Wallet Standard and
 * is picked up automatically.
 */
export default function WalletProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
