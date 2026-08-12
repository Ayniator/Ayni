"use client";

// Epic 12 · F86 — registers the embedded "AHA Wallet" with the Wallet Standard
// once, as early as the app mounts, and renders nothing.
//
// It lives inside <WalletProviders> in app/layout.tsx so wallet-adapter is
// already listening; registerEmbeddedWallet() is idempotent and window-guarded,
// so React strict mode's double mount, fast refresh, and any accidental second
// placement are all harmless. No network, no state, no UI.

import { useEffect } from "react";
import { registerEmbeddedWallet } from "../lib/embeddedWalletStandard";

export default function EmbeddedWalletBoot() {
  useEffect(() => {
    registerEmbeddedWallet();
    // No cleanup on unmount: a Standard Wallet stays registered for the
    // lifetime of the page, and unregistering on a strict-mode remount would
    // make the wallet flicker out of the connect modal.
  }, []);

  return null;
}
