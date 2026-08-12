// MACI (coercion-resistant voting) — client for the full round lifecycle.
//
// Round life: open → sign up (ZK, commit–reveal) → publish sealed commands →
// close (freeze) → crank the message chain → coordinator commits a tally →
// finalize onto the member proposal. The rules the coordinator must follow, and
// the digests anyone can recompute to check it, live in `./maci-command`; this
// file is only the chain plumbing.
//
// Read docs/maci.md for what this does and does NOT protect against — in
// particular, the coordinator can still commit a false tally, and what the
// design buys is that doing so is provable rather than impossible.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";
import { relayerPubkey, relayInstruction } from "./relayer";
import { RELAY_ALLOWLIST } from "./relayPolicy";
import {
  MACI_CT_LEN,
  MACI_VOTE_NO,
  MACI_VOTE_YES,
  MaciCommand,
  MaciMessageRecord,
  MaciSignupRecord,
  coordinatorTally,
  encodeMaciCommand,
  maciSignupCommitment,
  maciSignupExternalNullifier,
  padMaciCommand,
  sealMaciCommand,
} from "./maci-command";

const seed = (s: string) => new TextEncoder().encode(s);

export { MACI_VOTE_NO, MACI_VOTE_YES } from "./maci-command";

/** Recommended dispute window between a committed tally and finalization. */
export const MACI_DEFAULT_CHALLENGE_SECS = 24 * 60 * 60;
/** Messages per crank transaction. Bounded by the 1232-byte transaction limit
 *  (one account meta each), well under the program's MACI_PROCESS_MAX_BATCH. */
export const MACI_CRANK_BATCH = 20;

export const maciRoundPda = (proposal: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("maci"), proposal.toBytes()], PROGRAM_ID)[0];

export const maciStatePda = (round: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("macistate"), round.toBytes()], PROGRAM_ID)[0];

export const maciMessagePda = (round: PublicKey, index: number | bigint) => {
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigUint64(0, BigInt(index), true);
  return PublicKey.findProgramAddressSync([seed("macimsg"), round.toBytes(), le], PROGRAM_ID)[0];
};

export const maciSignupPda = (round: PublicKey, maciPubkey: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("macisignup"), round.toBytes(), maciPubkey], PROGRAM_ID)[0];

export const maciSignupCommitPda = (round: PublicKey, commitment: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("macicommit"), round.toBytes(), commitment], PROGRAM_ID)[0];

export const maciSignupNullifierPda = (round: PublicKey, nullifier: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("macinull"), round.toBytes(), nullifier], PROGRAM_ID)[0];

/** Any Council seat opens a MACI round over a member proposal. `coordinator` is
 *  the x25519 public key voters seal their commands to.
 *
 *  Opening takes the proposal OFF the plain ballot path for good (the program
 *  marks it finalized so `cast_vote` and `finalize_member_proposal` refuse it),
 *  so it must be done before anybody votes and it cannot be undone. */
export async function openMaciRound(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey,
  coordinator: Uint8Array,
  challengeSecs: number = MACI_DEFAULT_CHALLENGE_SECS
): Promise<string> {
  const round = maciRoundPda(proposal);
  return programWith(wallet)
    .methods.openMaciRound([...coordinator], new anchor.BN(challengeSecs))
    .accounts({
      circle,
      proposal,
      round,
      state: maciStatePda(round),
      seat: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export interface MaciRoundInfo { coordinator: Uint8Array; messageCount: number; processed: boolean }

export async function getMaciRound(proposal: string): Promise<MaciRoundInfo | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).maciRound.fetch(maciRoundPda(new PublicKey(proposal)));
    return { coordinator: Uint8Array.from(a.coordinator), messageCount: Number(a.messageCount), processed: Boolean(a.processed) };
  } catch {
    return null;
  }
}

export interface MaciStateInfo {
  round: PublicKey;
  proposal: PublicKey;
  coordinatorAuthority: PublicKey;
  msgDeadline: number;
  challengeSecs: number;
  signupCount: number;
  frozenMessageCount: number;
  processedCount: number;
  chainDigest: Uint8Array;
  signupDigest: Uint8Array;
  tallyYes: number;
  tallyNo: number;
  plaintextDigest: Uint8Array;
  tallyHash: Uint8Array;
  committedAt: number;
  stage: number;
  passed: boolean;
}

export const MACI_STAGE_OPEN = 0;
export const MACI_STAGE_CLOSED = 1;
export const MACI_STAGE_PROCESSED = 2;
export const MACI_STAGE_COMMITTED = 3;
export const MACI_STAGE_FINALIZED = 4;

export async function getMaciState(round: PublicKey): Promise<MaciStateInfo | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).maciState.fetch(maciStatePda(round));
    return {
      round: a.round,
      proposal: a.proposal,
      coordinatorAuthority: a.coordinatorAuthority,
      msgDeadline: Number(a.msgDeadline),
      challengeSecs: Number(a.challengeSecs),
      signupCount: Number(a.signupCount),
      frozenMessageCount: Number(a.frozenMessageCount),
      processedCount: Number(a.processedCount),
      chainDigest: Uint8Array.from(a.chainDigest),
      signupDigest: Uint8Array.from(a.signupDigest),
      tallyYes: Number(a.tallyYes),
      tallyNo: Number(a.tallyNo),
      plaintextDigest: Uint8Array.from(a.plaintextDigest),
      tallyHash: Uint8Array.from(a.tallyHash),
      committedAt: Number(a.committedAt),
      stage: Number(a.stage),
      passed: Boolean(a.passed),
    };
  } catch {
    return null;
  }
}

/** Every registered voting key for a round, in registration order. Public by
 *  design: MACI's secrecy is in the sealed commands and the key changes, never
 *  in who is entitled to vote. */
export async function listMaciSignups(round: PublicKey): Promise<MaciSignupRecord[]> {
  const rows = await (readOnlyProgram().account as any).maciSignup.all([
    { memcmp: { offset: 8, bytes: round.toBase58() } },
  ]);
  return rows
    .map((r: any) => ({ pubkey: Uint8Array.from(r.account.pubkey), index: Number(r.account.index) }))
    .sort((a: MaciSignupRecord, b: MaciSignupRecord) => a.index - b.index);
}

/** Every sealed command in a round, in publication order. */
export async function listMaciMessages(round: PublicKey): Promise<MaciMessageRecord[]> {
  const rows = await (readOnlyProgram().account as any).maciMessage.all([
    { memcmp: { offset: 8, bytes: round.toBase58() } },
  ]);
  return rows
    .map((r: any) => ({
      index: Number(r.account.index),
      ephPubkey: Uint8Array.from(r.account.ephPubkey),
      ciphertext: Uint8Array.from(r.account.ciphertext),
    }))
    .sort((a: MaciMessageRecord, b: MaciMessageRecord) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Sign-up (commit–reveal + ZK)
// ---------------------------------------------------------------------------

/** A voter's MACI signing keypair. Keep the secret OFF any shared device: it is
 *  what lets the voter override a coerced vote. */
export function newMaciKeypair(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}

/** The circuit's `proposalId` for a sign-up proof, as a bigint for snarkjs. */
export async function maciSignupProposalId(round: PublicKey): Promise<bigint> {
  const masked = await maciSignupExternalNullifier(round.toBytes());
  let v = 0n;
  for (const b of Array.from(masked)) v = (v << 8n) | BigInt(b);
  return v;
}

async function submit(
  wallet: SigningWallet,
  build: (payer: PublicKey) => Promise<TransactionInstruction>,
  ixName: string
): Promise<string> {
  // Relay only what the relayer will actually accept; the allowlist is pinned by
  // discriminator in relayPolicy.ts, so a not-yet-listed instruction falls back
  // to self-pay rather than bouncing off /api/relay.
  const listed = Object.keys(RELAY_ALLOWLIST).some((k) => RELAY_ALLOWLIST[k].name === ixName);
  const relayer = listed ? await relayerPubkey() : null;
  if (relayer) return relayInstruction(await build(relayer));
  const ix = await build(wallet.publicKey);
  const tx = new anchor.web3.Transaction().add(ix);
  return programWith(wallet).provider.sendAndConfirm!(tx, []);
}

/** Step 1 of sign-up: publish the commitment binding this nullifier to this key.
 *  Must land in an EARLIER slot than the reveal — that is the whole point (it
 *  stops anyone who sees the reveal from re-aiming the proof at their own key). */
export async function maciSignupCommit(
  wallet: SigningWallet,
  round: PublicKey,
  nullifier: Uint8Array,
  maciPubkey: Uint8Array
): Promise<string> {
  const commitment = await maciSignupCommitment(round.toBytes(), nullifier, maciPubkey);
  return submit(
    wallet,
    (payer) =>
      readOnlyProgram()
        .methods.maciSignupCommit([...commitment])
        .accounts({
          round,
          state: maciStatePda(round),
          commit: maciSignupCommitPda(round, commitment),
          payer,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    "maci_signup_commit"
  );
}

export interface MaciSignupProof {
  nullifier: number[];
  proofA: number[];
  proofB: number[];
  proofC: number[];
}

/** Step 2 of sign-up: reveal the key, prove membership, register the voice.
 *  The proof must be a `member_vote` proof against the PROPOSAL's snapshotted
 *  member root, with `proposalId = maciSignupProposalId(round)` and `choice = 1`. */
export async function maciSignupReveal(
  wallet: SigningWallet,
  round: PublicKey,
  proposal: PublicKey,
  maciPubkey: Uint8Array,
  proof: MaciSignupProof
): Promise<string> {
  const nullifier = Uint8Array.from(proof.nullifier);
  const commitment = await maciSignupCommitment(round.toBytes(), nullifier, maciPubkey);
  return submit(
    wallet,
    (payer) =>
      readOnlyProgram()
        .methods.maciSignup([...maciPubkey], proof.nullifier, proof.proofA, proof.proofB, proof.proofC)
        .accounts({
          round,
          state: maciStatePda(round),
          proposal,
          commit: maciSignupCommitPda(round, commitment),
          signupNullifier: maciSignupNullifierPda(round, nullifier),
          signup: maciSignupPda(round, maciPubkey),
          payer,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    "maci_signup"
  );
}

// ---------------------------------------------------------------------------
// Publishing sealed commands
// ---------------------------------------------------------------------------

/** Pad a raw MACI command to the fixed plaintext length (2-byte length prefix). */
function pad(cmd: Uint8Array): Uint8Array {
  return padMaciCommand(cmd);
}

/** Seal a command to the round's coordinator (fresh ephemeral key) and publish
 *  it. The plaintext is whatever the MACI command format encodes (a vote or a
 *  key-change); it's opaque on-chain. Returns the tx signature. */
export async function publishMaciCommand(
  wallet: SigningWallet,
  proposal: PublicKey,
  coordinator: Uint8Array,
  command: Uint8Array
): Promise<string> {
  const round = maciRoundPda(proposal);
  const info = await getMaciRound(proposal.toBase58());
  if (!info) throw new Error("No MACI round for this proposal.");
  if (info.processed) throw new Error("This MACI round is closed.");
  const { ephPubkey, ciphertext } = sealMaciCommand(pad(command), coordinator);
  if (ciphertext.length !== MACI_CT_LEN) throw new Error("internal: MACI ciphertext length mismatch");
  // F55: relay when possible — a coercion-resistant command should not carry
  // its author's wallet as fee-payer.
  const relayer = await relayerPubkey();
  const message = maciMessagePda(round, info.messageCount);
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.publishMaciMessage([...ephPubkey], Buffer.from(ciphertext))
      .accounts({ round, message, payer: relayer, systemProgram: SystemProgram.programId })
      .instruction();
    return relayInstruction(ix);
  }
  return programWith(wallet)
    .methods.publishMaciMessage([...ephPubkey], Buffer.from(ciphertext))
    .accounts({ round, message, payer: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}

/** What a voter needs to keep between commands: their sign-up key (the state
 *  index, permanent) and the key that currently signs for them. */
export interface MaciVoterKeys {
  signupPubkey: Uint8Array;
  currentSecret: Uint8Array;
  nonce: number;
}

/** Publish a vote. The command is signed with the voter's CURRENT key and keeps
 *  that key (`newKey = current`). */
export async function publishMaciVote(
  wallet: SigningWallet,
  proposal: PublicKey,
  coordinator: Uint8Array,
  keys: MaciVoterKeys,
  vote: number
): Promise<{ signature: string; nonce: number }> {
  const round = maciRoundPda(proposal);
  const nonce = keys.nonce + 1;
  const current = nacl.sign.keyPair.fromSecretKey(keys.currentSecret);
  const cmd: MaciCommand = {
    stateKey: keys.signupPubkey,
    newKey: current.publicKey,
    nonce,
    vote,
  };
  const bytes = encodeMaciCommand(cmd, round.toBytes(), keys.currentSecret);
  const signature = await publishMaciCommand(wallet, proposal, coordinator, bytes);
  return { signature, nonce };
}

/**
 * Publish a key change — the move that makes coercion pointless.
 *
 * The command is signed with the key the voter holds NOW and rotates authority
 * to a freshly generated key. Everything signed with the old key afterwards is
 * invalid, including anything a coercer watched the voter sign or was handed
 * outright. Nothing on chain distinguishes this message from an ordinary vote:
 * same size, same shape, same sealed bytes.
 *
 * It carries a vote too (MACI has one command type on purpose — a "key change"
 * that looked different would be a signal). Pass the voter's true choice.
 *
 * Returns the new secret key; store it somewhere the coercer has no access to,
 * and treat the old one as burnt.
 */
export async function publishMaciKeyChange(
  wallet: SigningWallet,
  proposal: PublicKey,
  coordinator: Uint8Array,
  keys: MaciVoterKeys,
  vote: number
): Promise<{ signature: string; nonce: number; newSecret: Uint8Array; newPublic: Uint8Array }> {
  const round = maciRoundPda(proposal);
  const nonce = keys.nonce + 1;
  const next = nacl.sign.keyPair();
  const cmd: MaciCommand = {
    stateKey: keys.signupPubkey,
    newKey: next.publicKey,
    nonce,
    vote,
  };
  const bytes = encodeMaciCommand(cmd, round.toBytes(), keys.currentSecret);
  const signature = await publishMaciCommand(wallet, proposal, coordinator, bytes);
  return { signature, nonce, newSecret: next.secretKey, newPublic: next.publicKey };
}

// ---------------------------------------------------------------------------
// Crank: close → process → commit → finalize
// ---------------------------------------------------------------------------

/** Freeze the round at its deadline. Permissionless; anyone should be able to
 *  run it, so the coordinator cannot hold the queue open or shut it early. */
export async function closeMaciRound(wallet: SigningWallet, round: PublicKey): Promise<string> {
  return programWith(wallet)
    .methods.closeMaciRound()
    .accounts({ round, state: maciStatePda(round), caller: wallet.publicKey })
    .rpc();
}

/** Fold every remaining message into the on-chain chain digest, in batches.
 *  Permissionless; returns the signatures in order. */
export async function crankMaciMessages(
  wallet: SigningWallet,
  round: PublicKey,
  batch = MACI_CRANK_BATCH
): Promise<string[]> {
  const sigs: string[] = [];
  const state = await getMaciState(round);
  if (!state) throw new Error("No MACI state for this round.");
  let index = state.processedCount;
  const end = state.frozenMessageCount;
  const program = programWith(wallet);
  while (index < end) {
    const n = Math.min(batch, end - index);
    const remaining = [];
    for (let i = 0; i < n; i++) {
      remaining.push({ pubkey: maciMessagePda(round, index + i), isSigner: false, isWritable: false });
    }
    sigs.push(
      await program.methods
        .processMaciMessages(n)
        .accounts({ round, state: maciStatePda(round), caller: wallet.publicKey })
        .remainingAccounts(remaining)
        .rpc()
    );
    index += n;
  }
  return sigs;
}

/** Coordinator: decrypt the frozen queue, run the state machine, and commit the
 *  result. Everything it publishes is recomputable by anyone holding the same
 *  public data plus the decryption witnesses (docs/maci.md).
 *
 *  **This currently reverts on chain with `MaciTallyUnverified`** — the program
 *  refuses to record a tally it cannot verify (docs/maci.md §4.1), pending the
 *  process/tally circuits (F44). Use `coordinatorTally` directly to compute and
 *  publish the result off chain; the UI must NOT present a round as tallied. */
export async function commitMaciTally(
  wallet: SigningWallet,
  round: PublicKey,
  coordinatorSecret: Uint8Array
): Promise<{ signature: string; yes: number; no: number; tallyHash: Uint8Array }> {
  const signups = await listMaciSignups(round);
  const messages = await listMaciMessages(round);
  const tally = await coordinatorTally(round.toBytes(), signups, messages, coordinatorSecret);
  const signature = await programWith(wallet)
    .methods.commitMaciTally(new anchor.BN(tally.yes), new anchor.BN(tally.no), [...tally.plaintextDigest])
    .accounts({ round, state: maciStatePda(round), coordinator: wallet.publicKey })
    .rpc();
  return { signature, yes: tally.yes, no: tally.no, tallyHash: tally.tallyHash };
}

/** Record the outcome in `MaciState` after the dispute window. Permissionless —
 *  a coordinator cannot sit on a result it dislikes. It never touches
 *  `MemberProposal.passed`, so a MACI round moves nothing by itself.
 *
 *  **This currently reverts on chain with `MaciTallyUnverified`** — see
 *  `commitMaciTally` and docs/maci.md §4.1. */
export async function finalizeMaciRound(
  wallet: SigningWallet,
  round: PublicKey,
  proposal: PublicKey,
  circle: PublicKey
): Promise<string> {
  const config = PublicKey.findProgramAddressSync([seed("config"), circle.toBytes()], PROGRAM_ID)[0];
  return programWith(wallet)
    .methods.finalizeMaciRound()
    .accounts({
      round,
      state: maciStatePda(round),
      proposal,
      config,
      finalizer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/**
 * Auditor's check: does the tally on chain match what the published inputs
 * produce? Anyone can run this with the coordinator's decryption witnesses; a
 * mismatch is proof the coordinator lied.
 *
 * Without the witnesses it still checks the two things that need no secret: the
 * message chain the program folded, and the electorate digest.
 */
export async function auditMaciRound(
  round: PublicKey,
  coordinatorSecret?: Uint8Array
): Promise<{ chainDigestMatches: boolean; signupDigestMatches: boolean; tallyMatches: boolean | null }> {
  const state = await getMaciState(round);
  if (!state) throw new Error("No MACI state for this round.");
  const signups = await listMaciSignups(round);
  const messages = await listMaciMessages(round);

  const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

  const { maciChainDigest, maciSignupDigest } = await import("./maci-command");
  const chainDigestMatches =
    state.processedCount === state.frozenMessageCount &&
    eq(await maciChainDigest(round.toBytes(), messages.slice(0, state.frozenMessageCount)), state.chainDigest);
  const signupDigestMatches = eq(await maciSignupDigest(signups), state.signupDigest);

  if (!coordinatorSecret) return { chainDigestMatches, signupDigestMatches, tallyMatches: null };
  const tally = await coordinatorTally(round.toBytes(), signups, messages, coordinatorSecret);
  return {
    chainDigestMatches,
    signupDigestMatches,
    tallyMatches: eq(tally.tallyHash, state.tallyHash) && tally.yes === state.tallyYes && tally.no === state.tallyNo,
  };
}
