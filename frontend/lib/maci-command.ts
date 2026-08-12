// F39 — MACI command format, state machine and audit digests (pure).
//
// This module is deliberately dependency-light and DOM-free: `tweetnacl` plus
// Web Crypto SHA-256, no chain access, no React, no Next. That is what lets the
// same code run in three places that MUST agree byte-for-byte:
//
//   * the voter's browser, sealing a command (`frontend/lib/maci.ts`);
//   * the coordinator, decrypting the queue and computing a tally;
//   * ANY third party auditing that tally (`tests/maci.ts` does exactly this).
//
// The last one is the point. The chain cannot check a MACI tally — the commands
// are sealed to the coordinator — so what makes the result disputable is that
// the rules are a published, executable function of public inputs, and the
// on-chain `tally_hash` pins every one of those inputs. See docs/maci.md.
//
// Portability notes: no BigInt (the repo's test tsconfig targets ES6), no
// TextEncoder, no Buffer. Nonces are plain numbers (< 2^53, encoded as u64 LE).

import nacl from "tweetnacl";

/** Padded plaintext length of a MACI command (matches MaciMessage::CT_LEN - 16). */
export const MACI_CMD_LEN = 160;
/** Sealed length: padded plaintext + NaCl box MAC. */
export const MACI_CT_LEN = MACI_CMD_LEN + 16;
/** Unpadded, signed command length: 4 + 32 + 32 + 8 + 1 + 64. */
export const MACI_COMMAND_LEN = 141;
/** Signed body (everything but the signature). */
export const MACI_BODY_LEN = 77;

export const MACI_VOTE_NO = 0;
export const MACI_VOTE_YES = 1;
/** Registered, deliberately counted in neither column. */
export const MACI_VOTE_ABSTAIN = 2;

const MAGIC = [0x41, 0x48, 0x4d, 0x31]; // "AHM1"
const ZERO_NONCE = new Uint8Array(24);

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** SHA-256 over the concatenation — the same primitive as Solana's `hashv`. */
export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const g = globalThis as any;
  const d = await g.crypto.subtle.digest("SHA-256", concat(parts));
  return new Uint8Array(d);
}

/** Little-endian u64 from a safe integer (nonces, indices, counts). */
export function u64le(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
    throw new Error("u64le: value out of safe range");
  }
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) {
    out[i] = x % 256;
    x = Math.floor(x / 256);
  }
  return out;
}

function readU64le(b: Uint8Array, off: number): number {
  let v = 0;
  for (let i = 7; i >= 0; i--) v = v * 256 + b[off + i];
  if (!Number.isSafeInteger(v)) throw new Error("u64: nonce beyond safe range");
  return v;
}

export const hexOf = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------
// Command encoding
// ---------------------------------------------------------------------------

export interface MaciCommand {
  /** The sign-up key this command acts for. Never changes — it IS the state index. */
  stateKey: Uint8Array;
  /** The key that must sign the voter's NEXT command. Equal to the current key
   *  for a plain vote; different for a key change (the coercion defence). */
  newKey: Uint8Array;
  /** Strictly increasing per voter. Ordering within a voter is by nonce, so the
   *  tally does not depend on the order messages happened to be published in. */
  nonce: number;
  /** MACI_VOTE_NO | MACI_VOTE_YES | MACI_VOTE_ABSTAIN. */
  vote: number;
}

/** The bytes a command's signature covers: domain ‖ round ‖ body. */
export function maciSigningPayload(round: Uint8Array, body: Uint8Array): Uint8Array {
  return concat([ascii("AHA-maci-cmd"), round, body]);
}

/** Encode + sign a command. `signSecretKey` is the nacl.sign 64-byte secret of
 *  the key that is CURRENT for this voter (which, for a key change, is still the
 *  old key — the rotation takes effect after this command is applied). */
export function encodeMaciCommand(
  cmd: MaciCommand,
  round: Uint8Array,
  signSecretKey: Uint8Array
): Uint8Array {
  if (cmd.stateKey.length !== 32 || cmd.newKey.length !== 32) {
    throw new Error("MACI command: keys must be 32 bytes.");
  }
  if (cmd.vote !== 0 && cmd.vote !== 1 && cmd.vote !== 2) {
    throw new Error("MACI command: vote must be 0, 1 or 2.");
  }
  const body = new Uint8Array(MACI_BODY_LEN);
  body.set(MAGIC, 0);
  body.set(cmd.stateKey, 4);
  body.set(cmd.newKey, 36);
  body.set(u64le(cmd.nonce), 68);
  body[76] = cmd.vote;
  const sig = nacl.sign.detached(maciSigningPayload(round, body), signSecretKey);
  return concat([body, sig]);
}

export interface ParsedMaciCommand extends MaciCommand {
  body: Uint8Array;
  signature: Uint8Array;
}

/** Parse a command; returns null on anything malformed (a malformed command is
 *  simply invalid, exactly like a badly signed one — never a hard error, or a
 *  voter could grief the whole round with one junk message). */
export function decodeMaciCommand(bytes: Uint8Array): ParsedMaciCommand | null {
  if (bytes.length !== MACI_COMMAND_LEN) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return null;
  const vote = bytes[76];
  if (vote !== 0 && vote !== 1 && vote !== 2) return null;
  let nonce: number;
  try {
    nonce = readU64le(bytes, 68);
  } catch {
    return null;
  }
  return {
    stateKey: bytes.slice(4, 36),
    newKey: bytes.slice(36, 68),
    nonce,
    vote,
    body: bytes.slice(0, MACI_BODY_LEN),
    signature: bytes.slice(MACI_BODY_LEN, MACI_COMMAND_LEN),
  };
}

export function verifyMaciCommand(
  cmd: ParsedMaciCommand,
  round: Uint8Array,
  signerPubkey: Uint8Array
): boolean {
  return nacl.sign.detached.verify(
    maciSigningPayload(round, cmd.body),
    cmd.signature,
    signerPubkey
  );
}

// ---------------------------------------------------------------------------
// Padding + sealing (mirrors the submission layer already on chain)
// ---------------------------------------------------------------------------

/** Pad to the fixed plaintext length (2-byte big-endian length prefix). Every
 *  sealed command is the same size, so size leaks nothing about its content. */
export function padMaciCommand(cmd: Uint8Array): Uint8Array {
  if (cmd.length + 2 > MACI_CMD_LEN) throw new Error("MACI command too long.");
  const out = new Uint8Array(MACI_CMD_LEN);
  out[0] = (cmd.length >> 8) & 0xff;
  out[1] = cmd.length & 0xff;
  out.set(cmd, 2);
  return out;
}

export function unpadMaciCommand(padded: Uint8Array): Uint8Array | null {
  if (padded.length !== MACI_CMD_LEN) return null;
  const len = (padded[0] << 8) | padded[1];
  if (len + 2 > MACI_CMD_LEN) return null;
  return padded.slice(2, 2 + len);
}

export interface SealedMaciCommand {
  ephPubkey: Uint8Array;
  ciphertext: Uint8Array;
}

/** Seal a padded command to the round's coordinator with a fresh ephemeral key.
 *  A single-use ephemeral key makes a constant (zero) nonce safe and keeps the
 *  on-chain record free of any per-sender field. */
export function sealMaciCommand(
  padded: Uint8Array,
  coordinatorPubkey: Uint8Array
): SealedMaciCommand {
  const eph = nacl.box.keyPair();
  const ct = nacl.box(padded, ZERO_NONCE, coordinatorPubkey, eph.secretKey);
  if (ct.length !== MACI_CT_LEN) throw new Error("internal: MACI ciphertext length mismatch");
  return { ephPubkey: eph.publicKey, ciphertext: ct };
}

/** Coordinator side: open one sealed command, or null if it is not for us / is
 *  corrupt. Poly1305 makes this a *verifying* decryption — an opening that
 *  succeeds could not have been produced under a different shared secret, which
 *  is why publishing per-message X25519 shared secrets is a sound audit witness
 *  (docs/maci.md, "How a wrong tally is proven"). */
export function openMaciCiphertext(
  ciphertext: Uint8Array,
  ephPubkey: Uint8Array,
  coordinatorSecret: Uint8Array
): Uint8Array | null {
  const opened = nacl.box.open(ciphertext, ZERO_NONCE, ephPubkey, coordinatorSecret);
  return opened || null;
}

// ---------------------------------------------------------------------------
// The state machine — last-valid-per-voter, with key changes
// ---------------------------------------------------------------------------

export interface MaciSignupRecord {
  pubkey: Uint8Array;
  index: number;
}

export interface MaciQueueEntry {
  index: number;
  /** The unpadded command, or null if the coordinator could not open/parse it. */
  command: Uint8Array | null;
}

export interface MaciVoterState {
  signupKey: Uint8Array;
  currentKey: Uint8Array;
  nonce: number;
  vote: number;
  /** Message indices whose application actually changed this voter's state. */
  appliedAt: number[];
}

export interface MaciTallyResult {
  yes: number;
  no: number;
  abstain: number;
  states: MaciVoterState[];
  /** Message indices that were opened, parsed, and applied. */
  applied: number[];
  /** Message indices that were dropped (undecryptable, malformed, unknown
   *  voter, bad signature, or a stale nonce). Never published — knowing WHICH
   *  messages were overridden is exactly what a coercer wants. */
  dropped: number[];
}

/**
 * Apply a decrypted queue to the registered electorate.
 *
 * Rules, in the order they matter:
 *
 *  1. A command names the sign-up key it acts for (`stateKey`). Unknown key ⇒
 *     dropped. The sign-up key is the state index and never changes, so a key
 *     change does not orphan the voter's slot.
 *  2. Commands for one voter are applied in **ascending nonce** order, ties
 *     broken by message index. So the outcome is a function of the SET of
 *     messages, not of the order they were published in.
 *  3. A command must be signed by the voter's **current** key and carry a nonce
 *     strictly greater than the last one applied. Otherwise it is dropped.
 *  4. Applying a command sets the voter's vote AND rotates the current key to
 *     `newKey`.
 *
 * Rule 4 is the whole coercion defence. A voter who published a key change to a
 * key the coercer does not hold has made every later command signed by the
 * surrendered key invalid — including the one the coercer watched them sign. No
 * observer can tell, because every message is sealed and the coordinator
 * publishes only the totals.
 */
export function applyMaciQueue(
  signups: MaciSignupRecord[],
  queue: MaciQueueEntry[],
  round: Uint8Array
): MaciTallyResult {
  const states = new Map<string, MaciVoterState>();
  const ordered = [...signups].sort((a, b) => a.index - b.index);
  for (const s of ordered) {
    states.set(hexOf(s.pubkey), {
      signupKey: s.pubkey,
      currentKey: s.pubkey,
      nonce: 0,
      vote: MACI_VOTE_ABSTAIN,
      appliedAt: [],
    });
  }

  const dropped: number[] = [];
  const buckets = new Map<string, { index: number; cmd: ParsedMaciCommand }[]>();

  for (const entry of queue) {
    const parsed = entry.command ? decodeMaciCommand(entry.command) : null;
    if (!parsed) {
      dropped.push(entry.index);
      continue;
    }
    const key = hexOf(parsed.stateKey);
    if (!states.has(key)) {
      dropped.push(entry.index);
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ index: entry.index, cmd: parsed });
    else buckets.set(key, [{ index: entry.index, cmd: parsed }]);
  }

  const applied: number[] = [];
  for (const [key, bucket] of Array.from(buckets.entries())) {
    const state = states.get(key)!;
    bucket.sort((a, b) => (a.cmd.nonce - b.cmd.nonce) || (a.index - b.index));
    for (const { index, cmd } of bucket) {
      if (cmd.nonce <= state.nonce) {
        dropped.push(index);
        continue;
      }
      if (!verifyMaciCommand(cmd, round, state.currentKey)) {
        dropped.push(index);
        continue;
      }
      state.nonce = cmd.nonce;
      state.vote = cmd.vote;
      state.currentKey = cmd.newKey;
      state.appliedAt.push(index);
      applied.push(index);
    }
  }

  let yes = 0;
  let no = 0;
  let abstain = 0;
  const out: MaciVoterState[] = [];
  for (const s of ordered) {
    const state = states.get(hexOf(s.pubkey))!;
    out.push(state);
    if (state.vote === MACI_VOTE_YES) yes++;
    else if (state.vote === MACI_VOTE_NO) no++;
    else abstain++;
  }

  applied.sort((a, b) => a - b);
  dropped.sort((a, b) => a - b);
  return { yes, no, abstain, states: out, applied, dropped };
}

// ---------------------------------------------------------------------------
// Audit digests — every one of these is mirrored in Rust, byte for byte
// ---------------------------------------------------------------------------

/** `H("AHA-maci-signup" || round || nullifier || pubkey)` — the sign-up
 *  commit–reveal binding (`maci_signup_commitment` in Rust). */
export function maciSignupCommitment(
  round: Uint8Array,
  nullifier: Uint8Array,
  maciPubkey: Uint8Array
): Promise<Uint8Array> {
  return sha256(ascii("AHA-maci-signup"), round, nullifier, maciPubkey);
}

/** `H("AHA-maci-signup-nul" || round)` masked into BN254 — the `member_vote`
 *  circuit's `proposalId` for a sign-up (`maci_signup_external_nullifier`). */
export async function maciSignupExternalNullifier(round: Uint8Array): Promise<Uint8Array> {
  const h = await sha256(ascii("AHA-maci-signup-nul"), round);
  h[0] &= 0x1f; // BN254 p > 2^253 ⇒ always in field
  return h;
}

/** `H("AHA-maci-chain" || round)` — the seed `close_maci_round` writes. */
export function maciChainSeed(round: Uint8Array): Promise<Uint8Array> {
  return sha256(ascii("AHA-maci-chain"), round);
}

export interface MaciMessageRecord {
  index: number;
  ephPubkey: Uint8Array;
  ciphertext: Uint8Array;
}

/** Recompute the digest `process_maci_messages` folds on chain. Anyone can run
 *  this against the message accounts and compare it with `MaciState`. */
export async function maciChainDigest(
  round: Uint8Array,
  messages: MaciMessageRecord[]
): Promise<Uint8Array> {
  let digest = await maciChainSeed(round);
  const ordered = [...messages].sort((a, b) => a.index - b.index);
  for (const m of ordered) {
    digest = await sha256(digest, u64le(m.index), m.ephPubkey, m.ciphertext);
  }
  return digest;
}

/** Running commitment to the electorate, in registration order (`maci_signup`). */
export async function maciSignupDigest(signups: MaciSignupRecord[]): Promise<Uint8Array> {
  let digest: Uint8Array = new Uint8Array(32);
  const ordered = [...signups].sort((a, b) => a.index - b.index);
  for (const s of ordered) {
    digest = await sha256(digest, u64le(s.index), s.pubkey);
  }
  return digest;
}

/**
 * The coordinator's commitment to what it decrypted: for every message index in
 * order, one status byte (1 = opened, 0 = could not open) followed by the
 * 160-byte padded plaintext (zeros when unopened).
 *
 * Fixed-width on purpose: the digest's shape reveals nothing beyond the queue
 * length, which is public anyway.
 */
export async function maciPlaintextDigest(
  plaintexts: (Uint8Array | null)[]
): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  for (const p of plaintexts) {
    const flag = new Uint8Array(1);
    flag[0] = p ? 1 : 0;
    blocks.push(flag);
    blocks.push(p ? p : new Uint8Array(MACI_CMD_LEN));
  }
  return sha256(...blocks);
}

/** `H("AHA-maci-tally" || round || chain || signups || count || yes || no ||
 *  plaintexts)` — mirrors `maci_tally_hash` in Rust. */
export function maciTallyHash(args: {
  round: Uint8Array;
  chainDigest: Uint8Array;
  signupDigest: Uint8Array;
  signupCount: number;
  yes: number;
  no: number;
  plaintextDigest: Uint8Array;
}): Promise<Uint8Array> {
  return sha256(
    ascii("AHA-maci-tally"),
    args.round,
    args.chainDigest,
    args.signupDigest,
    u64le(args.signupCount),
    u64le(args.yes),
    u64le(args.no),
    args.plaintextDigest
  );
}

// ---------------------------------------------------------------------------
// Coordinator: queue → tally + the digests it must publish
// ---------------------------------------------------------------------------

export interface MaciCoordinatorTally extends MaciTallyResult {
  plaintextDigest: Uint8Array;
  chainDigest: Uint8Array;
  signupDigest: Uint8Array;
  tallyHash: Uint8Array;
}

/**
 * Everything the coordinator needs for `commit_maci_tally`, computed from
 * nothing but public on-chain data plus its own decryption key.
 *
 * An auditor holding the same inputs and the per-message shared secrets runs
 * this same function and gets the same `tallyHash`; if it differs from the one
 * on chain, the coordinator is caught.
 */
export async function coordinatorTally(
  round: Uint8Array,
  signups: MaciSignupRecord[],
  messages: MaciMessageRecord[],
  coordinatorSecret: Uint8Array
): Promise<MaciCoordinatorTally> {
  const ordered = [...messages].sort((a, b) => a.index - b.index);
  const padded: (Uint8Array | null)[] = [];
  const queue: MaciQueueEntry[] = [];

  for (const m of ordered) {
    const opened = openMaciCiphertext(m.ciphertext, m.ephPubkey, coordinatorSecret);
    padded.push(opened);
    queue.push({ index: m.index, command: opened ? unpadMaciCommand(opened) : null });
  }

  const result = applyMaciQueue(signups, queue, round);
  const plaintextDigest = await maciPlaintextDigest(padded);
  const chainDigest = await maciChainDigest(round, ordered);
  const signupDigest = await maciSignupDigest(signups);
  const tallyHash = await maciTallyHash({
    round,
    chainDigest,
    signupDigest,
    signupCount: signups.length,
    yes: result.yes,
    no: result.no,
    plaintextDigest,
  });

  return { ...result, plaintextDigest, chainDigest, signupDigest, tallyHash };
}

// ---------------------------------------------------------------------------
// Policy math — the same rules as finalize_member_proposal / finalize_maci_round
// ---------------------------------------------------------------------------

/** Mirrors `quorum_threshold` in Rust (0 denominator ⇒ ceil(eligible/3), min 1). */
export function maciQuorumThreshold(eligible: number, qNum: number, qDen: number): number {
  if (qDen > 0) return Math.max(1, Math.floor((eligible * qNum) / qDen));
  return Math.max(1, Math.floor((eligible + 2) / 3));
}

/** Mirrors `vote_passes` (0 denominator ⇒ simple majority). */
export function maciVotePasses(yes: number, no: number, pNum: number, pDen: number): boolean {
  const turnout = yes + no;
  if (pDen > 0) return yes * pDen >= pNum * turnout;
  return yes > no;
}

/** Mirrors `member_vote_outcome` — quorum met, turnout non-zero, threshold cleared. */
export function maciOutcome(
  yes: number,
  no: number,
  eligible: number,
  qNum: number,
  qDen: number,
  pNum: number,
  pDen: number
): boolean {
  const turnout = yes + no;
  return (
    turnout >= maciQuorumThreshold(eligible, qNum, qDen) &&
    turnout > 0 &&
    maciVotePasses(yes, no, pNum, pDen)
  );
}
