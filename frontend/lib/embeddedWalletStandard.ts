// Epic 12 · F86 — the AHA embedded wallet, exposed through the Wallet Standard.
//
// This module wraps lib/embeddedWallet.ts in a Standard Wallet named
// "AHA Wallet" and registers it with the page. wallet-adapter's
// `useStandardWalletAdapters` (already wired into components/WalletProviders)
// picks it up automatically, so `useWallet()`, `useAnchorWallet()` and the
// connect modal see it as just another wallet — ZERO changes to existing pages.
//
// ── WHAT THIS WALLET IS (and is not) ───────────────────────────────────────
//  · DEVICE-LOCAL and SELF-CUSTODIAL. The ed25519 secret never leaves this
//    device: it is sealed by the F65 keystore (lib/keystore.ts) and only ever
//    exists in memory while a signature is produced. There is no custodian, no
//    server, and no account to lock out.
//  · The passkey / keystore is a DEVICE-LOCAL UNLOCK — it is NOT the member's
//    identity. The Epic 11 MASTER SECRET remains the credential of record: the
//    Solana keypair and the Semaphore identity commitment both derive from it.
//  · Losing the passkey or the device is therefore SURVIVABLE: sponsor shard
//    recovery (Epic 11, /recovery) reconstructs the master secret bit-
//    identically, purely locally, emitting nothing on chain. Nothing in this
//    file may ever be described to a member as "your identity".
//
// ── NO NETWORK ─────────────────────────────────────────────────────────────
// This file contains no fetch, no XHR, no WebSocket, and imports nothing that
// networks. Connecting and signing are entirely local; broadcasting a signed
// transaction is the app's job (wallet-adapter's own `sendTransaction` posts
// the bytes we hand back). Sentinel may assert that statically.
//
// ── WHY NO `solana:signAndSendTransaction` ─────────────────────────────────
// Deliberate. Implementing it would make this module hold an RPC connection and
// broadcast, which is exactly the network reach the custody model forbids here.
// Without it, wallet-adapter falls back to sign-then-`connection.sendRawTransaction`
// on the app side, which is both correct and keeps the boundary clean.

import type {
  Wallet,
  WalletAccount,
  WalletIcon,
  WalletVersion,
} from "@wallet-standard/base";
import { registerWallet } from "@wallet-standard/wallet";
import {
  embeddedWalletPublicKey,
  embeddedWalletPublicKeyBytes,
  hasEmbeddedWallet,
  lockEmbeddedWallet,
  signMessage as signMessageBytes,
  signSerializedTransaction,
  unlockEmbeddedWallet,
} from "./embeddedWallet";

// ---------------------------------------------------------------------------
// Identity of the wallet as the connect modal sees it
// ---------------------------------------------------------------------------

/** The name the member sees in the wallet modal. Stable — do not rename. */
export const AHA_WALLET_NAME = "AHA Wallet";

const VERSION: WalletVersion = "1.0.0";

/** Inline violet (#6d4cff) mark — no external asset, so no network fetch. */
const ICON: WalletIcon =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzZkNGNmZiIvPjxwYXRoIGQ9Ik0zMiAxMyBMNDcgNDkgSDM5LjIgTDMyIDMxLjIgTDI0LjggNDkgSDE3IFoiIGZpbGw9IiNmZmZmZmYiLz48cmVjdCB4PSIyNCIgeT0iMzkiIHdpZHRoPSIxNiIgaGVpZ2h0PSI0IiByeD0iMiIgZmlsbD0iIzZkNGNmZiIvPjwvc3ZnPg==";

// Feature identifiers, written as literals rather than imported from
// @solana/wallet-standard-features / @wallet-standard/features: those packages
// are transitive dependencies here, and the identifiers are frozen parts of the
// spec. wallet-adapter matches on exactly these strings.
const StandardConnect = "standard:connect" as const;
const StandardDisconnect = "standard:disconnect" as const;
const StandardEvents = "standard:events" as const;
const SolanaSignTransaction = "solana:signTransaction" as const;
const SolanaSignAllTransactions = "solana:signAllTransactions" as const;
const SolanaSignMessage = "solana:signMessage" as const;

/** Chains this wallet will sign for. wallet-adapter derives the chain from the
 *  RPC endpoint, so this list must cover every cluster `lib/solana.ts` can
 *  resolve to (its CLUSTER is mainnet | testnet | devnet) — otherwise
 *  sendTransaction fails with "invalid chain" on a cluster the app itself
 *  supports. `solana:localnet` is intentionally absent: it is not a
 *  wallet-standard identifier, and a local validator is a development concern. */
const CHAINS = ["solana:devnet", "solana:testnet", "solana:mainnet"] as const;

const ACCOUNT_FEATURES = [
  SolanaSignTransaction,
  SolanaSignAllTransactions,
  SolanaSignMessage,
] as const;

// ---------------------------------------------------------------------------
// Wallet-standard shapes
// ---------------------------------------------------------------------------

type ChangeListener = (properties: {
  readonly chains?: Wallet["chains"];
  readonly features?: Wallet["features"];
  readonly accounts?: Wallet["accounts"];
}) => void;

interface SignTransactionInput {
  readonly account: WalletAccount;
  readonly transaction: Uint8Array;
  readonly chain?: `${string}:${string}`;
  readonly options?: unknown;
}

interface SignMessageInput {
  readonly account: WalletAccount;
  readonly message: Uint8Array;
}

/** Build a frozen, read-only account object from the cached public key. */
function makeAccount(address: string, publicKey: Uint8Array): WalletAccount {
  return Object.freeze({
    address,
    publicKey,
    chains: [...CHAINS] as `${string}:${string}`[],
    features: [...ACCOUNT_FEATURES] as `${string}:${string}`[],
    label: AHA_WALLET_NAME,
    icon: ICON,
  });
}

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

class AhaEmbeddedWallet implements Wallet {
  #account: WalletAccount | null = null;
  #listeners: ChangeListener[] = [];

  get version(): WalletVersion {
    return VERSION;
  }

  get name(): string {
    return AHA_WALLET_NAME;
  }

  get icon(): WalletIcon {
    return ICON;
  }

  get chains(): `${string}:${string}`[] {
    return [...CHAINS];
  }

  get accounts(): readonly WalletAccount[] {
    return this.#account ? [this.#account] : [];
  }

  get features() {
    return {
      [StandardConnect]: { version: "1.0.0" as const, connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0" as const, disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0" as const, on: this.#on },
      [SolanaSignTransaction]: {
        version: "1.0.0" as const,
        // Legacy and v0 messages both round-trip through
        // embeddedWallet.signSerializedTransaction().
        supportedTransactionVersions: ["legacy", 0] as const,
        signTransaction: this.#signTransaction,
      },
      // Convenience alias. wallet-adapter actually implements its own
      // `signAllTransactions` by calling the VARIADIC `solana:signTransaction`
      // above with several inputs (there is no canonical
      // `solana:signAllTransactions` in the Solana wallet-standard), so this
      // entry is for direct wallet-standard consumers only.
      [SolanaSignAllTransactions]: {
        version: "1.0.0" as const,
        supportedTransactionVersions: ["legacy", 0] as const,
        signAllTransactions: this.#signTransaction,
      },
      [SolanaSignMessage]: {
        version: "1.0.0" as const,
        signMessage: this.#signMessage,
      },
    };
  }

  // -- events ---------------------------------------------------------------

  #on = (event: "change", listener: ChangeListener): (() => void) => {
    if (event !== "change") return () => undefined;
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  };

  #emitChange(): void {
    const accounts = this.accounts;
    for (const listener of [...this.#listeners]) {
      try {
        listener({ accounts });
      } catch {
        /* a listener throwing must not break the others */
      }
    }
  }

  // -- connect / disconnect -------------------------------------------------

  /**
   * Connect.
   *
   * NEVER creates a key. If this device has no embedded wallet, a silent
   * (auto-connect) attempt is a no-op and an explicit attempt fails with a
   * message pointing the member at the page that owns creation. Creating a
   * self-custodial key must always be a deliberate, informed act.
   *
   * With a wallet present, an explicit connect unlocks the keystore (one
   * biometric/PIN prompt per session) so presence is proven at connect time
   * rather than surprising the member at their first signature. A silent
   * auto-connect never prompts: it restores the account from the cached PUBLIC
   * key and lets the first signature do the unlocking.
   */
  #connect = async (input?: { readonly silent?: boolean }) => {
    const silent = input?.silent === true;

    if (!hasEmbeddedWallet()) {
      if (silent) return { accounts: this.accounts }; // no wallet, no prompt
      throw new Error(
        'No AHA Wallet on this device yet. Create one first in Settings → Security — connecting never creates a key for you.'
      );
    }

    if (silent) {
      const address = embeddedWalletPublicKey();
      const publicKey = embeddedWalletPublicKeyBytes();
      if (!address || !publicKey) return { accounts: this.accounts };
      this.#setAccount(makeAccount(address, publicKey));
      return { accounts: this.accounts };
    }

    // Explicit connect: unlock (may prompt) and take the address from the
    // unlocked keypair, which is authoritative over the cache.
    const address = await unlockEmbeddedWallet();
    const publicKey = embeddedWalletPublicKeyBytes();
    if (!publicKey) throw new Error("AHA Wallet public key could not be read.");
    this.#setAccount(makeAccount(address, publicKey));
    return { accounts: this.accounts };
  };

  #disconnect = async (): Promise<void> => {
    lockEmbeddedWallet(); // drop the in-memory secret; keystore session untouched
    if (this.#account) {
      this.#account = null;
      this.#emitChange();
    }
  };

  #setAccount(account: WalletAccount): void {
    if (this.#account && this.#account.address === account.address) return;
    this.#account = account;
    this.#emitChange();
  }

  /**
   * Re-read the public-key cache after the UI created, imported or removed the
   * key, and emit `change` if the connected account is now stale.
   *
   * Deliberately one-directional: it can DROP or REPLACE a connected account
   * (so a removed key can never keep signing) but it never conjures one out of
   * nothing. Authorising an account is what `connect` is for — and connect is
   * where the member proves presence via the keystore unlock.
   */
  refresh(): void {
    if (!this.#account) return;
    const address = embeddedWalletPublicKey();
    const publicKey = address ? embeddedWalletPublicKeyBytes() : null;
    if (!address || !publicKey) {
      this.#account = null;
      this.#emitChange();
      return;
    }
    this.#setAccount(makeAccount(address, publicKey));
  }

  // -- signing --------------------------------------------------------------

  #assertAccount(account: WalletAccount): void {
    const current = this.#account;
    if (!current) throw new Error("AHA Wallet is not connected.");
    // Compare by address rather than object identity: callers legitimately
    // hand back a structurally-equal copy of the account they were given.
    if (account?.address !== current.address) {
      throw new Error("Unknown account for AHA Wallet.");
    }
  }

  #assertChain(chain?: string): void {
    if (chain && !(CHAINS as readonly string[]).includes(chain)) {
      throw new Error(`AHA Wallet does not support the chain "${chain}".`);
    }
  }

  #signTransaction = async (...inputs: readonly SignTransactionInput[]) => {
    const outputs: { signedTransaction: Uint8Array }[] = [];
    for (const input of inputs) {
      this.#assertAccount(input.account);
      this.#assertChain(input.chain);
      outputs.push({ signedTransaction: await signSerializedTransaction(input.transaction) });
    }
    return outputs;
  };

  #signMessage = async (...inputs: readonly SignMessageInput[]) => {
    const outputs: {
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType: "ed25519";
    }[] = [];
    for (const input of inputs) {
      this.#assertAccount(input.account);
      outputs.push({
        signedMessage: input.message,
        signature: await signMessageBytes(input.message),
        signatureType: "ed25519",
      });
    }
    return outputs;
  };
}

// ---------------------------------------------------------------------------
// Registration (idempotent)
// ---------------------------------------------------------------------------

const wallet = new AhaEmbeddedWallet();

/** Window flag so a second module instance (React strict mode double-mount,
 *  fast refresh, or a duplicated chunk) cannot register the wallet twice. */
const REGISTERED_FLAG = "__ahaEmbeddedWalletRegistered";

let registered = false;

/**
 * Register "AHA Wallet" with the page. Safe to call any number of times and
 * from any number of components: the first call wins, the rest are no-ops.
 *
 * `registerWallet` (from @wallet-standard/wallet) dispatches the
 * `wallet-standard:register-wallet` window event AND listens for
 * `wallet-standard:app-ready`, so registration lands whether this module runs
 * before or after wallet-adapter mounts.
 */
export function registerEmbeddedWallet(): void {
  if (typeof window === "undefined") return; // SSR: nothing to register into
  if (registered) return;
  const w = window as unknown as Record<string, unknown>;
  if (w[REGISTERED_FLAG]) {
    registered = true;
    return;
  }
  w[REGISTERED_FLAG] = true;
  registered = true;
  try {
    registerWallet(wallet);
  } catch {
    // A failed registration must never break the page: every other wallet
    // (Phantom, Solflare…) keeps working, the member just won't see this one.
    w[REGISTERED_FLAG] = false;
    registered = false;
  }
}

/** True once this page has registered the wallet. */
export function embeddedWalletRegistered(): boolean {
  return registered;
}

/**
 * Tell the registered wallet that the embedded key was created, imported, or
 * removed, so the account list (and every `useWallet()` consumer) updates
 * without a page reload.
 */
export function refreshEmbeddedWalletAccount(): void {
  wallet.refresh();
}
