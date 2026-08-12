// F66 — blinded, one-time recovery keys for the ON-CHAIN guardian rebind path.
//
// WHICH RECOVERY THIS IS (and which it is not — read this before touching it):
//
// * This module serves F9/F10/F11: the Council/guardian-visible WALLET
//   MIGRATION, where `Membership.recovery_keys` ([Pubkey; 2], set at
//   `issue_membership` and rotated via `set_recovery`) co-sign an on-chain
//   rebind of the `owner` wallet. That event is public by design.
// * It is EXPLICITLY DISTINCT from Epic 11's local Shamir recovery (locked
//   position in CLAUDE.md): reconstructing the master secret from shards is a
//   purely local event that emits NOTHING on chain — no key rotation, no
//   commitment change, no transaction. Nothing in this file participates in
//   that flow, and nothing in that flow may call into the chain via this one.
//
// THE PROBLEM F66 SOLVES: writing a sponsor's RAW wallet pubkey into
// `recovery_keys` would publicly and permanently link member ↔ sponsors on the
// ledger — a Traditions violation. Instead the client derives a BLINDED
// one-time key per (sponsor, member, epoch):
//
//   seed = HKDF-SHA-512(
//     ikm  = sponsorSecret,
//     salt = UTF8("AHA-F66-recovery-v1"),
//     info = UTF8("AHA-F66-recovery-v1|") ‖ memberCommitment ‖ u64le(epoch),
//     L    = 32 bytes
//   )
//   blinded keypair = Ed25519 Keypair.fromSeed(seed)
//
// UNLINKABILITY: the blinded pubkey is a one-way function of (sponsorSecret,
// memberCommitment, epoch). Without the sponsorSecret, nothing computable
// links the pubkey resting in `recovery_keys` to any sponsor identity, wallet,
// or other blinded key the same sponsor holds elsewhere — to an observer it is
// a uniformly random Ed25519 point. The sponsor, holding sponsorSecret, can
// re-derive the SAME keypair at any time and sign the migration transaction
// when a rebind is genuinely needed (proveRecoveryControl).
//
// SINGLE-USE: rotating `epoch` rotates the key. After any migration that
// exercised a blinded key (its pubkey then appears on chain as a signer), the
// client MUST bump the epoch and `set_recovery` the fresh pair, so each
// derived key signs at most once in public.
//
// SCOPE: derivation only. Deliberately NO storage, NO enumeration helpers, NO
// network — a sponsor's set of blinded keys must not be listable anywhere;
// each key exists only when its holder re-derives it from inputs they already
// know.

import { Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

/** Domain-separation tag — versioned; changing it changes every derived key. */
export const RECOVERY_KEY_DOMAIN = "AHA-F66-recovery-v1";

const te = new TextEncoder();

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const u64le = (n: number | bigint): Uint8Array => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};

function checkInputs(sponsorSecret: Uint8Array, memberCommitment: Uint8Array, epoch: number): void {
  if (!(sponsorSecret instanceof Uint8Array) || sponsorSecret.length < 32) {
    throw new Error("sponsorSecret must be at least 32 bytes");
  }
  if (!(memberCommitment instanceof Uint8Array) || memberCommitment.length !== 32) {
    throw new Error("memberCommitment must be exactly 32 bytes");
  }
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error("epoch must be a non-negative integer");
  }
}

/** WebCrypto — native in every browser and node ≥ 19; a node-18 caller (the
 *  plain-node tests) must set `globalThis.crypto = require("crypto").webcrypto`
 *  first. Same convention as sharding.ts; no node import leaks into the
 *  frontend bundle. */
function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) {
    throw new Error(
      "WebCrypto unavailable — on node < 19 set globalThis.crypto = require('crypto').webcrypto before use"
    );
  }
  return s;
}

/** HKDF-SHA-512 → 32-byte Ed25519 seed (exact construction in the header). */
async function deriveSeed(sponsorSecret: Uint8Array, memberCommitment: Uint8Array, epoch: number): Promise<Uint8Array> {
  checkInputs(sponsorSecret, memberCommitment, epoch);
  const ikm = await subtle().importKey("raw", sponsorSecret as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    {
      name: "HKDF",
      hash: "SHA-512",
      salt: te.encode(RECOVERY_KEY_DOMAIN),
      info: concat(te.encode(RECOVERY_KEY_DOMAIN + "|"), memberCommitment, u64le(epoch)) as BufferSource,
    },
    ikm,
    32 * 8
  );
  return new Uint8Array(bits);
}

/**
 * Derive the sponsor's blinded one-time recovery keypair for one member and
 * one epoch. Deterministic: the same three inputs always yield the same
 * keypair, so the sponsor never stores it — they re-derive on demand.
 */
export async function deriveBlindedRecoveryKey(
  sponsorSecret: Uint8Array,
  memberCommitment: Uint8Array,
  epoch: number
): Promise<{ keypair: Keypair; blindedPubkey: PublicKey }> {
  const seed = await deriveSeed(sponsorSecret, memberCommitment, epoch);
  const keypair = Keypair.fromSeed(seed);
  return { keypair, blindedPubkey: keypair.publicKey };
}

/**
 * The pair the client passes as `recovery_keys` to `issue_membership` /
 * `set_recovery`: one blinded pubkey per sponsor, both bound to the same
 * member and epoch. Order matches the sponsorSecrets order. Refuses a
 * degenerate split where both "sponsors" are the same secret — that would
 * silently collapse 2 guardians into 1.
 */
export async function blindedKeysForMember(
  sponsorSecrets: [Uint8Array, Uint8Array],
  memberCommitment: Uint8Array,
  epoch: number
): Promise<[PublicKey, PublicKey]> {
  const [a, b] = await Promise.all(
    sponsorSecrets.map((s) => deriveBlindedRecoveryKey(s, memberCommitment, epoch))
  );
  if (a.blindedPubkey.equals(b.blindedPubkey)) {
    throw new Error("both sponsor secrets derive the same recovery key — sponsors must be independent");
  }
  return [a.blindedPubkey, b.blindedPubkey];
}

/**
 * Sponsor-side proof of control: re-derive the blinded keypair and sign
 * `message` (the migration transaction message bytes) with it. The returned
 * `keypair` is what the sponsor passes as an additional signer on the
 * `member_migrate` transaction; `signature` verifies against `blindedPubkey`
 * with plain Ed25519 (nacl.sign.detached.verify), proving control without
 * ever revealing which sponsor is behind the key.
 */
export async function proveRecoveryControl(
  sponsorSecret: Uint8Array,
  memberCommitment: Uint8Array,
  epoch: number,
  message: Uint8Array
): Promise<{ keypair: Keypair; blindedPubkey: PublicKey; signature: Uint8Array }> {
  const { keypair, blindedPubkey } = await deriveBlindedRecoveryKey(sponsorSecret, memberCommitment, epoch);
  const signature = nacl.sign.detached(message, keypair.secretKey);
  return { keypair, blindedPubkey, signature };
}
