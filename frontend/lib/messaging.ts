// End-to-end encrypted 1:1 messaging (F32) — v2, sealed sender.
//
// RECIPIENT KEY: wallets don't expose their secret key, so each user derives a
// stable x25519 box keypair from a deterministic wallet SIGNATURE of a fixed
// message (Ed25519 signatures are deterministic). The PUBLIC half is published
// on-chain (MessagingKey) so others can encrypt to them; the secret is
// re-derived in the browser (one signature, cached for the session) to decrypt.
// This favours wallet-recoverability (nothing extra to back up) over recipient-
// side forward secrecy — a leak of the recipient wallet still derives the key.
//
// SEALED SENDER: every message is encrypted to the recipient with a FRESH,
// single-use ephemeral keypair (nacl.box). The ephemeral secret is destroyed
// right after sending, so a later compromise of the sender can't read past
// messages (sender-side forward secrecy), and the chain stores no sender. The
// real sender is named AND signed *inside* the sealed payload (Ed25519 over the
// message fields), and the recipient verifies that signature after decrypting —
// authenticated, but invisible to everyone else.
//
// SIZE PRIVACY: the payload is padded to a fixed length before sealing, so every
// on-chain ciphertext is exactly CT_LEN bytes — no message-length leak.
//
// RESIDUAL (cannot be fixed on a public chain without a relay/mixnet): the
// recipient address and the message timing are public, and the transaction
// fee-payer still links a message to whoever paid for it.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);
const KEY_DERIVATION_MSG = "AHA private messaging key v1 — sign to unlock your encrypted inbox.";

// Fixed sizes — keep in sync with the on-chain Message::CT_LEN.
const PLAINTEXT_LEN = 1024;            // padded envelope length
const CT_LEN = PLAINTEXT_LEN + 16;     // + NaCl box MAC = 1040 (== Message::CT_LEN)
export const MAX_PLAINTEXT = 800;      // generous body cap (envelope overhead ~130–220 b)

export const messagingKeyPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("msgkey"), owner.toBytes()], PROGRAM_ID)[0];

// --- key derivation (cached per session in memory) ---
let cachedSecret: { addr: string; kp: nacl.BoxKeyPair } | null = null;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
}

/** Derive (and cache) the caller's x25519 box keypair from a wallet signature. */
export async function deriveBoxKeypair(
  publicKey: PublicKey,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<nacl.BoxKeyPair> {
  const addr = publicKey.toBase58();
  if (cachedSecret && cachedSecret.addr === addr) return cachedSecret.kp;
  const sig = await signMessage(seed(KEY_DERIVATION_MSG));
  const secret = await sha256(sig); // 32 bytes
  const kp = nacl.box.keyPair.fromSecretKey(secret);
  cachedSecret = { addr, kp };
  return kp;
}

export function forgetBoxKey() {
  cachedSecret = null;
}

// --- registry ---

export async function getMessagingKey(owner: string): Promise<Uint8Array | null> {
  const program = readOnlyProgram();
  try {
    const a: any = await (program.account as any).messagingKey.fetch(messagingKeyPda(new PublicKey(owner)));
    return Uint8Array.from(a.boxPubkey);
  } catch {
    return null;
  }
}

/** Publish my box public key so others can message me. Idempotent. */
export async function registerMessagingKey(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const kp = await deriveBoxKeypair(wallet.publicKey, signMessage);
  return programWith(wallet)
    .methods.registerMessagingKey([...kp.publicKey])
    .accounts({ key: messagingKeyPda(wallet.publicKey), owner: wallet.publicKey })
    .rpc();
}

/** True if I've published a messaging key (so I can receive). */
export async function isRegistered(owner: string): Promise<boolean> {
  return (await getMessagingKey(owner)) !== null;
}

// --- sealed-envelope helpers ---

const u64le = (n: number | bigint): Uint8Array => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Canonical bytes the sender signs (and the recipient re-checks): binds the
 *  message body to this exact recipient / id / nonce / ephemeral key. */
function signedBytes(recipient: PublicKey, idLe: Uint8Array, nonce: Uint8Array, eph: Uint8Array, body: string, ts: number): Uint8Array {
  return concat(seed("AHAmsg-v2|"), recipient.toBytes(), idLe, nonce, eph, u64le(ts), seed(body));
}

/** Pad a JSON envelope to the fixed PLAINTEXT_LEN (2-byte length prefix + zeros). */
function pad(jsonBytes: Uint8Array): Uint8Array {
  if (jsonBytes.length + 2 > PLAINTEXT_LEN) throw new Error("Message too long.");
  const out = new Uint8Array(PLAINTEXT_LEN);
  out[0] = (jsonBytes.length >> 8) & 0xff;
  out[1] = jsonBytes.length & 0xff;
  out.set(jsonBytes, 2);
  return out;
}
function unpad(plain: Uint8Array): Uint8Array {
  const len = (plain[0] << 8) | plain[1];
  return plain.slice(2, 2 + len);
}

// --- send / list / decrypt ---

export interface InboxMessage {
  pubkey: string;
  recipient: string;
  ephPubkey: Uint8Array;
  nonce: Uint8Array;
  id: string;
  createdAt: number;
  expiresAt: number; // 0 = never
  ciphertext: Uint8Array;
  expired: boolean;
}

/** The result of opening a sealed message. */
export interface DecryptedMessage {
  text: string;
  from: string | null;   // authenticated sender wallet (null if the signature didn't verify)
  verified: boolean;     // true ⇒ `from` is cryptographically proven
}

const idToLe = (id: anchor.BN) => id.toArrayLike(Buffer, "le", 8) as unknown as Uint8Array;

/** Encrypt + store a sealed-sender message to any registered recipient. */
export async function sendMessage(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  recipient: PublicKey,
  text: string,
  expiresAt: number // unix secs, 0 = never
): Promise<string> {
  const recipientBox = await getMessagingKey(recipient.toBase58());
  if (!recipientBox) throw new Error("Recipient hasn't enabled messaging yet (no published key).");
  if (new TextEncoder().encode(text).length > MAX_PLAINTEXT) throw new Error(`Message too long (max ~${MAX_PLAINTEXT} bytes).`);

  // Fresh single-use ephemeral keypair → sealed sender + sender forward secrecy.
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const id = new anchor.BN(Buffer.from(nacl.randomBytes(8)).toString("hex"), 16); // random u64
  const idLe = idToLe(id);
  const ts = Math.floor(Date.now() / 1000);

  // Authenticate the sender INSIDE the envelope (invisible on-chain).
  const sig = await signMessage(signedBytes(recipient, idLe, nonce, eph.publicKey, text, ts));
  const envelope = { v: 2, from: wallet.publicKey.toBase58(), ts, body: text, sig: b64(sig) };
  const plain = pad(new TextEncoder().encode(JSON.stringify(envelope)));
  const ct = nacl.box(plain, nonce, recipientBox, eph.secretKey); // exactly CT_LEN bytes
  if (ct.length !== CT_LEN) throw new Error("internal: ciphertext length mismatch");
  // (eph.secretKey is now discarded — no way to re-derive it.)

  const program = programWith(wallet);
  const [msgPda] = PublicKey.findProgramAddressSync(
    [seed("msg"), recipient.toBytes(), idLe],
    PROGRAM_ID
  );
  const txSig = await program.methods
    .sendMessage(id, recipient, [...eph.publicKey], [...nonce], new anchor.BN(expiresAt), Buffer.from(ct))
    .accounts({ message: msgPda, payer: wallet.publicKey })
    .rpc();

  // Keep a local, device-only copy so the sender can still see their thread
  // (the chain no longer stores who sent what, and the ephemeral key is gone).
  appendSent({ to: recipient.toBase58(), text, ts, expiresAt, pubkey: msgPda.toBase58() });
  return txSig;
}

const MSG_RECIPIENT_OFFSET = 8; // discriminator → recipient is the first field now
// Exact on-chain size of a v2 Message account: 8 disc + 32 recipient + 32 eph +
// 24 nonce + 8 id + 8 created + 8 expires + (4+1040) ciphertext + 1 bump = 1165.
// Filtering on it skips legacy v1 messages (different layout) so decoding the
// fixed-size v2 set never overruns the buffer.
const MSG_ACCOUNT_SIZE = 8 + 32 + 32 + 24 + 8 + 8 + 8 + (4 + CT_LEN) + 1;

/** All messages addressed to `me` (newest first), expired ones flagged. */
export async function listInbox(me: string): Promise<InboxMessage[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).message.all([
    { dataSize: MSG_ACCOUNT_SIZE },
    { memcmp: { offset: MSG_RECIPIENT_OFFSET, bytes: me } },
  ]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): InboxMessage => {
      const a = r.account;
      const expiresAt = Number(a.expiresAt);
      return {
        pubkey: r.publicKey.toBase58(),
        recipient: a.recipient.toBase58(),
        ephPubkey: Uint8Array.from(a.ephPubkey),
        nonce: Uint8Array.from(a.nonce),
        id: a.id.toString(),
        createdAt: Number(a.createdAt),
        expiresAt,
        ciphertext: Uint8Array.from(a.ciphertext),
        expired: expiresAt !== 0 && now >= expiresAt,
      };
    })
    .sort((x: InboxMessage, y: InboxMessage) => y.createdAt - x.createdAt);
}

/** Decrypt + authenticate a received message with my session-cached box secret. */
export async function decryptMessage(
  m: InboxMessage,
  publicKey: PublicKey,
  signMessage: (b: Uint8Array) => Promise<Uint8Array>
): Promise<DecryptedMessage> {
  const kp = await deriveBoxKeypair(publicKey, signMessage);
  const opened = nacl.box.open(m.ciphertext, m.nonce, m.ephPubkey, kp.secretKey);
  if (!opened) throw new Error("Could not decrypt (not the intended recipient, or wrong key).");

  let env: any;
  try { env = JSON.parse(new TextDecoder().decode(unpad(opened))); }
  catch { throw new Error("Message payload is malformed."); }
  const body = String(env.body ?? "");

  // Verify the in-envelope signature proves the claimed sender.
  let verified = false;
  try {
    const from = new PublicKey(env.from);
    const idLe = idToLe(new anchor.BN(m.id));
    const expected = signedBytes(new PublicKey(m.recipient), idLe, m.nonce, m.ephPubkey, body, Number(env.ts));
    verified = nacl.sign.detached.verify(expected, unb64(env.sig), from.toBytes());
  } catch { verified = false; }

  return { text: body, from: verified ? String(env.from) : null, verified };
}

export async function deleteMessage(wallet: SigningWallet, message: PublicKey): Promise<string> {
  return programWith(wallet)
    .methods.deleteMessage()
    .accounts({ message, rentTo: wallet.publicKey, signer: wallet.publicKey })
    .rpc();
}

// --- sent log (per-device, localStorage; the chain stores no sender) ---
const SENT_KEY = "aha:msg-sent";
export interface SentRecord { to: string; text: string; ts: number; expiresAt: number; pubkey: string }
function readSent(): SentRecord[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || "[]"); } catch { return []; }
}
export function appendSent(rec: SentRecord) {
  if (typeof window === "undefined") return;
  const all = readSent();
  all.push(rec);
  localStorage.setItem(SENT_KEY, JSON.stringify(all.slice(-200))); // keep it bounded
}
/** Messages I sent from this device (newest first), expired ones flagged. */
export function getSent(): (SentRecord & { expired: boolean })[] {
  const now = Date.now() / 1000;
  return readSent()
    .map((r) => ({ ...r, expired: r.expiresAt !== 0 && now >= r.expiresAt }))
    .sort((a, b) => b.ts - a.ts);
}

// --- unread tracking (per-device, localStorage) ---
const READ_KEY = "aha:msg-read";
function readSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); }
}
export function isRead(pubkey: string): boolean { return readSet().has(pubkey); }
export function markRead(pubkey: string) {
  const s = readSet(); s.add(pubkey);
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}
export function unreadCount(msgs: InboxMessage[]): number {
  const s = readSet();
  return msgs.filter((m) => !m.expired && !s.has(m.pubkey)).length;
}
