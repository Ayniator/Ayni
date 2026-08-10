// Epic 0 — the treasurer's faucet ledger (off-chain, encrypted, codes only).
//
// The epic's user story: "As the treasurer, I can review every faucet
// transaction with the one-time pseudonymous codes of parrain and neophyte —
// codes, never identities, and this ledger lives encrypted off-chain, visible
// to the treasurer role alone."
//
// DESIGN — an anonymous sealed drop-box:
//   * At activation time the PARRAIN'S CLIENT generates two fresh one-time
//     codes (parrain's + neophyte's), builds a tiny entry {codes, amount,
//     coarse day}, pads it to a fixed size, and seals it to the treasurer's
//     published messaging key (F32 MessagingKey) with a single-use ephemeral
//     nacl.box keypair — the same sealed-sender construction as the inbox.
//   * The sealed blob is POSTed to /api/faucet-ledger AFTER AN INDEPENDENT
//     RANDOM DELAY, so drop-box arrival order/time cannot be lined up against
//     the on-chain grant transaction. If the tab closes first, the blob waits
//     in a localStorage queue and is flushed on the next visit.
//   * The entry contains NO wallet, NO commitment, NO tx signature, and only a
//     day-granularity date. Decrypted, it still identifies no one: the codes
//     are meaningless outside the humans who hold them (the parrain knows
//     their own code; they hand the neophyte theirs).
//   * Only the treasurer can read: they re-derive their box secret with one
//     wallet signature (deriveBoxKeypair) and try it against every blob.
//
// HONEST LIMITS (pilot): the drop-box server necessarily observes arrival
// times and file order — the POST jitter blurs, not erases, that channel; and
// the treasurer-key model trusts seat 0's wallet. Both are subsumed by the
// Epic 10 relayer decision. The ledger deliberately reconciles by COUNT
// against the jar's on-chain `granted`, never by per-entry linkage.

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { deriveBoxKeypair, getMessagingKey } from "./messaging";

// Fixed sizes — every blob on the drop-box is byte-identical in length.
const ENTRY_PLAIN = 192; // padded entry
export const LEDGER_BLOB_LEN = 32 + 24 + ENTRY_PLAIN + 16; // eph pub + nonce + ct

const QUEUE_KEY = "aha:faucet-ledger-queue";
/** POST delay window: decorrelates drop-box arrival from the grant tx. */
const POST_JITTER_MS: [number, number] = [60_000, 420_000]; // 1–7 min

// Code alphabet without lookalikes (no 0/O, 1/I/l).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 8;

export interface LedgerEntry {
  codeParrain: string;
  codeNeophyte: string;
  amountLamports: number;
  day: string; // YYYY-MM-DD, deliberately coarse
}

/** Two fresh one-time codes — shown once to the parrain, never stored. */
export function makeLedgerCodes(): { codeParrain: string; codeNeophyte: string } {
  const code = () => {
    const r = new Uint8Array(CODE_LEN);
    crypto.getRandomValues(r);
    return Array.from(r, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  };
  return { codeParrain: code(), codeNeophyte: code() };
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Seal one entry to the treasurer's published box key. */
export function sealLedgerEntry(treasurerBoxPub: Uint8Array, entry: LedgerEntry): string {
  const plain = new Uint8Array(ENTRY_PLAIN); // zero padding
  const json = new TextEncoder().encode(
    JSON.stringify({ v: 1, cp: entry.codeParrain, cn: entry.codeNeophyte, amt: entry.amountLamports, day: entry.day })
  );
  if (json.length > ENTRY_PLAIN) throw new Error("ledger entry too large");
  plain.set(json);

  const eph = nacl.box.keyPair(); // single-use; secret discarded on return
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(plain, nonce, treasurerBoxPub, eph.secretKey);
  const blob = new Uint8Array(LEDGER_BLOB_LEN);
  blob.set(eph.publicKey, 0);
  blob.set(nonce, 32);
  blob.set(ct, 56);
  return b64(blob);
}

/** The coarse date an entry carries — today, day precision only. */
export function ledgerDay(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- submission (jittered, queue-backed) -----------------------------------

interface Queued { circle: string; blob: string; notBefore: number }

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

async function post(circle: string, blob: string): Promise<boolean> {
  try {
    const res = await fetch("/api/faucet-ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ circle, blob }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Queue a sealed entry for delivery at a random later moment. Returns
 * immediately; delivery happens in the background (or on a later visit).
 */
export function submitLedgerEntry(circle: string, blob: string): void {
  const delay = POST_JITTER_MS[0] + Math.random() * (POST_JITTER_MS[1] - POST_JITTER_MS[0]);
  const q = readQueue();
  q.push({ circle, blob, notBefore: Date.now() + delay });
  writeQueue(q);
  setTimeout(flushLedgerQueue, delay + 1000);
}

/** Deliver every queued entry whose jitter window has passed. */
export async function flushLedgerQueue(): Promise<void> {
  const q = readQueue();
  if (!q.length) return;
  const now = Date.now();
  const keep: Queued[] = [];
  for (const item of q) {
    if (item.notBefore > now) {
      keep.push(item);
      continue;
    }
    const ok = await post(item.circle, item.blob);
    if (!ok) keep.push(item); // retry on a later visit
  }
  writeQueue(keep);
}

/**
 * Full parrain-side flow: fetch the treasurer's key, seal, queue.
 * Returns the codes to show once, or null if the treasurer has published no
 * messaging key yet (the grant still proceeds; the ledger entry is skipped —
 * surfaced honestly to the parrain).
 */
export async function recordGrantInLedger(
  circle: PublicKey,
  treasurerWallet: string,
  amountLamports: number
): Promise<{ codeParrain: string; codeNeophyte: string } | null> {
  const boxPub = await getMessagingKey(treasurerWallet);
  if (!boxPub) return null;
  const codes = makeLedgerCodes();
  const blob = sealLedgerEntry(boxPub, {
    codeParrain: codes.codeParrain,
    codeNeophyte: codes.codeNeophyte,
    amountLamports,
    day: ledgerDay(),
  });
  submitLedgerEntry(circle.toBase58(), blob);
  return codes;
}

// --- treasurer read side ----------------------------------------------------

/**
 * Fetch and decrypt the circle's ledger. Only blobs sealed to the caller's
 * derived box key open; everything else is skipped silently.
 */
export async function readLedger(
  circle: PublicKey,
  me: PublicKey,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<LedgerEntry[]> {
  const res = await fetch(`/api/faucet-ledger?circle=${circle.toBase58()}`);
  if (!res.ok) throw new Error(`ledger fetch failed (${res.status})`);
  const { blobs } = (await res.json()) as { blobs: string[] };
  const kp = await deriveBoxKeypair(me, signMessage);

  const out: LedgerEntry[] = [];
  for (const s of blobs) {
    try {
      const blob = unb64(s);
      if (blob.length !== LEDGER_BLOB_LEN) continue;
      const plain = nacl.box.open(blob.subarray(56), blob.subarray(32, 56), blob.subarray(0, 32), kp.secretKey);
      if (!plain) continue; // not sealed to me
      const json = JSON.parse(new TextDecoder().decode(plain).replace(/\0+$/, ""));
      if (json?.v !== 1) continue;
      out.push({
        codeParrain: String(json.cp),
        codeNeophyte: String(json.cn),
        amountLamports: Number(json.amt),
        day: String(json.day),
      });
    } catch {
      /* malformed blob — skip */
    }
  }
  // Day-sorted; within a day, order is meaningless by design.
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
