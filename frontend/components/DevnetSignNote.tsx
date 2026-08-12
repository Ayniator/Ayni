"use client";

// A pre-signing caveat shown only when the app is wired to Devnet: the user's
// wallet (Solflare/Phantom/…) must have Devnet selected, or it raises a
// "Network mismatch" and refuses to sign. Renders nothing on mainnet/testnet.
// Drop it inside any block that leads to a wallet transaction.

import { CLUSTER } from "../lib/solana";
import { useT } from "./SettingsProvider";

export default function DevnetSignNote({ className }: { className?: string }) {
  const t = useT();
  if (CLUSTER !== "devnet") return null;
  return (
    <span className={className ?? "devnet-sign-note"} role="note">
      {t("msg.devnetSign")}
    </span>
  );
}
