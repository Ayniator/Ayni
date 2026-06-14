// End-to-end encrypted 1:1 messaging (F32).
//
// Keys: wallets don't expose their secret key, so each user derives a stable
// x25519 box keypair from a deterministic wallet SIGNATURE of a fixed message
// (Ed25519 signatures are deterministic). The PUBLIC half is published on-chain
// (MessagingKey) so others can encrypt to them; the secret is re-derived in the
// browser (one signature, cached for the session) to decrypt.
//
// Encryption: nacl.box(plaintext, nonce, recipientBoxPub, myBoxSecret). The
// recipient opens with nacl.box.open(ct, nonce, message.sender_box, mySecret).
// Only the recipient can read it; metadata (sender/recipient) is public on-chain.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";

const seed = (s: string) => new TextEncoder().encode(s);
const KEY_DERIVATION_MSG = "AHA private messaging key v1 — sign to unlock your encrypted inbox.";

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

// --- send / list / decrypt ---

export interface InboxMessage {
  pubkey: string;
  sender: string;
  recipient: string;
  senderBox: Uint8Array;
  nonce: Uint8Array;
  id: string;
  createdAt: number;
  expiresAt: number; // 0 = never
  ciphertext: Uint8Array;
  expired: boolean;
}

const MAX_PLAINTEXT = 480; // leaves room under the 512-byte on-chain ciphertext cap

/** Encrypt + store a message to any recipient (who must have registered a key). */
export async function sendMessage(
  wallet: SigningWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  recipient: PublicKey,
  text: string,
  expiresAt: number // unix secs, 0 = never
): Promise<string> {
  const recipientBox = await getMessagingKey(recipient.toBase58());
  if (!recipientBox) throw new Error("Recipient hasn't enabled messaging yet (no published key).");
  const mine = await deriveBoxKeypair(wallet.publicKey, signMessage);
  const plain = new TextEncoder().encode(text);
  if (plain.length > MAX_PLAINTEXT) throw new Error(`Message too long (max ~${MAX_PLAINTEXT} bytes).`);
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(plain, nonce, recipientBox, mine.secretKey);

  const program = programWith(wallet);
  const id = new anchor.BN(Date.now());
  const [msgPda] = PublicKey.findProgramAddressSync(
    [seed("msg"), recipient.toBytes(), wallet.publicKey.toBytes(), id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
  return program.methods
    .sendMessage(id, recipient, [...mine.publicKey], [...nonce], new anchor.BN(expiresAt), Buffer.from(ct))
    .accounts({ message: msgPda, sender: wallet.publicKey })
    .rpc();
}

const MSG_RECIPIENT_OFFSET = 8 + 32; // discriminator + sender

/** All messages addressed to `me` (newest first), expired ones flagged. */
export async function listInbox(me: string): Promise<InboxMessage[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).message.all([
    { memcmp: { offset: MSG_RECIPIENT_OFFSET, bytes: me } },
  ]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): InboxMessage => {
      const a = r.account;
      const expiresAt = Number(a.expiresAt);
      return {
        pubkey: r.publicKey.toBase58(),
        sender: a.sender.toBase58(),
        recipient: a.recipient.toBase58(),
        senderBox: Uint8Array.from(a.senderBox),
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

/** Messages I sent (so the sender sees their thread too). */
export async function listSent(me: string): Promise<InboxMessage[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).message.all([{ memcmp: { offset: 8, bytes: me } }]);
  const now = Date.now() / 1000;
  return rows.map((r: any): InboxMessage => {
    const a = r.account;
    const expiresAt = Number(a.expiresAt);
    return {
      pubkey: r.publicKey.toBase58(), sender: a.sender.toBase58(), recipient: a.recipient.toBase58(),
      senderBox: Uint8Array.from(a.senderBox), nonce: Uint8Array.from(a.nonce), id: a.id.toString(),
      createdAt: Number(a.createdAt), expiresAt, ciphertext: Uint8Array.from(a.ciphertext),
      expired: expiresAt !== 0 && now >= expiresAt,
    };
  }).sort((x: InboxMessage, y: InboxMessage) => y.createdAt - x.createdAt);
}

/** Decrypt a received message with my session-cached box secret. */
export async function decryptMessage(
  m: InboxMessage,
  publicKey: PublicKey,
  signMessage: (b: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const kp = await deriveBoxKeypair(publicKey, signMessage);
  const opened = nacl.box.open(m.ciphertext, m.nonce, m.senderBox, kp.secretKey);
  if (!opened) throw new Error("Could not decrypt (not the intended recipient, or wrong key).");
  return new TextDecoder().decode(opened);
}

export async function deleteMessage(wallet: SigningWallet, message: PublicKey): Promise<string> {
  return programWith(wallet)
    .methods.deleteMessage()
    .accounts({ message, rentTo: wallet.publicKey, signer: wallet.publicKey })
    .rpc();
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
