"use client";

import dynamic from "next/dynamic";

// The wallet button reads `window`-registered wallets, so render it client-side only.
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  {
    ssr: false,
    loading: () => (
      <span className="wallet-fallback">
        <SolanaMark /> Connect Wallet
      </span>
    ),
  }
);

export default function WalletButton() {
  return (
    <span className="sol-wallet">
      <span className="sol-badge" aria-hidden="true"><SolanaMark /></span>
      <WalletMultiButton />
    </span>
  );
}

/** The Solana mark (three slanted bars, purple→teal gradient). */
export function SolanaMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 18) / 24} viewBox="0 0 24 18" aria-hidden="true" className="sol-mark">
      <defs>
        <linearGradient id="solg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g fill="url(#solg)">
        <path d="M5 1 L24 1 L19 5 L0 5 Z" />
        <path d="M0 7 L19 7 L24 11 L5 11 Z" />
        <path d="M5 13 L24 13 L19 17 L0 17 Z" />
      </g>
    </svg>
  );
}
