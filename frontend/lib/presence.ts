// F59 — the browser side of presence attestation: "last stood in circle:
// March 2026", vouched by a fellow member.
//
// WHAT AN ATTESTATION IS, in one paragraph. The chain cannot know who stood in
// a room. It records that two DIFFERENT members of a Circle each produced a
// Groth16 proof naming the same closed month, under the same external
// nullifier E — the subject consenting (a proof only the holder of the
// commitment's secret can make) and a fellow member vouching (a proof any
// member of the tree can make, named nowhere). Every string in the UI must use
// the vouching wording; none may say attendance was "verified", because it was
// not. Design of record: docs/presence.md.
//
// THE CEREMONY IS TWO DEVICES. The subject's secret and the witness's secret
// never share a device, so the attestation travels as a handoff: the subject
// generates their consent proof and shows it as a QR/paste code; the witness
// scans it, adds their own proof under the SAME E, and submits one transaction
// carrying both. The handoff payload contains the subject's raw commitment —
// their public pseudonym, but the handoff screen must say so before the scan
// (docs/presence.md §4.5).
//
// Proof machinery is entirely reused: `proveWingEndorsement` is a single-leaf
// proof (the F35-R2 consent trick — the tree with exactly one leaf, whose root
// the program recomputes from the commitment), and `proveMemberEndorsement` is
// the member-tree proof with the F54 ring-buffer crank. No new circuit, no new
// ceremony key.
//
// Submission goes through the F55 relayer whenever it is configured: a wallet
// that pays this fee links itself to the attestation's timing (docs/presence.md
// §4.4). The relay route prepends the compute budget (two Groth16 verifications
// exceed the 200k default); the self-paying fallback prepends its own, and the
// UI copy must say the fallback names a wallet.

import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID, SigningWallet, programWith, readOnlyProgram } from "./member";
import { relayInstruction, relayerPubkey } from "./relayer";
import { proveMemberEndorsement, proveWingEndorsement, recentRootsPda, haveVotingKey } from "./zk-vote";

const seed = (s: string) => new TextEncoder().encode(s);
const fromHex = (h: string) =>
  Uint8Array.from((h.replace(/^0x/, "").match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
const beToBig = (b: Uint8Array | number[]): bigint => {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
};

// Matches the compute figure declared for attest_presence_zk in the relay
// allowlist (lib/relayPolicy.ts) — the self-pay fallback must request the same
// budget the relayed path gets, or the two paths would differ in whether they
// fit.
const ATTEST_COMPUTE_UNITS = 600_000;

/** Months since 1970-01, from the device clock, in UTC.
 *
 *  UTC deliberately, mirroring `month.rs`: a per-Circle timezone would be a
 *  coarse location, and location plus month is exactly the join
 *  docs/presence.md warns about. The program recomputes this from ITS clock and
 *  rejects a month that has not closed, so a skewed device fails cleanly rather
 *  than writing a wrong month. */
export function currentMonthIndex(now = new Date()): number {
  return (now.getUTCFullYear() - 1970) * 12 + now.getUTCMonth();
}

/** The most recent CLOSED month — the only kind the program accepts. Attesting
 *  the current month would narrow a member to a window a public meeting
 *  calendar can resolve to one evening; that rule is the program's, not ours,
 *  and this helper just aims at it. */
export function lastClosedMonthIndex(now = new Date()): number {
  return currentMonthIndex(now) - 1;
}

/** "March 2026", in the viewer's language. The index is the only thing stored
 *  on chain; the wording is local. */
export function monthLabel(index: number, lang?: string): string {
  const d = new Date(Date.UTC(1970 + Math.floor(index / 12), index % 12, 1));
  try {
    return new Intl.DateTimeFormat(lang || undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
}

/** SHA-256(tag ‖ circle ‖ subjectCommitment ‖ month_le32), top three bits
 *  cleared so the value is a BN254 field element. MUST mirror
 *  `presence_external_nullifier` / `clear_external_nullifier` byte for byte —
 *  both sides are pinned to frozen vectors (clear_presence.rs tests,
 *  tests/presence-zk.test.mjs), and this masks identically. */
async function externalNullifier(
  tag: "AHA-presence-month" | "AHA-presence-clear",
  circle: PublicKey,
  subjectCommitment: Uint8Array,
  month: number
): Promise<bigint> {
  const le = new Uint8Array(4);
  new DataView(le.buffer).setUint32(0, month >>> 0, true);
  const preimage = new Uint8Array([...seed(tag), ...circle.toBytes(), ...subjectCommitment, ...le]);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage));
  d[0] &= 0x1f;
  return beToBig(d);
}

export const presencePda = (circle: PublicKey, subjectCommitment: Uint8Array) =>
  PublicKey.findProgramAddressSync(
    [seed("presence"), circle.toBytes(), subjectCommitment],
    PROGRAM_ID
  )[0];

/** The month a member last stood in circle, or null — and null is all a member
 *  who never attested OR erased their record looks like. The page renders a
 *  month, or nothing; there is deliberately no third state (docs/presence.md §5:
 *  reads by DERIVATION only, never enumeration). */
export async function getPresence(circle: string, subjectCommitmentHex: string): Promise<number | null> {
  try {
    const a: any = await (readOnlyProgram().account as any).presence.fetch(
      presencePda(new PublicKey(circle), fromHex(subjectCommitmentHex))
    );
    return Number(a.lastMonth);
  } catch {
    return null;
  }
}

/** Can this device produce the given member's proofs at all? (The voting key
 *  lives on the device that joined.) */
export const canProveFor = (commitmentHex: string) => haveVotingKey(commitmentHex);

// ---------------------------------------------------------------------------
// The two halves of the ceremony.
// ---------------------------------------------------------------------------

export interface SubjectHandoff {
  v: 1;
  kind: "aha-presence-attestation";
  circle: string;
  subject: string; // commitment hex — the subject's PUBLIC pseudonym; the handoff screen says so
  month: number;
  nullifier: number[];
  proofA: number[];
  proofB: number[];
  proofC: number[];
}

/** SUBJECT side: consent to being written about, for one closed month.
 *
 *  Produces the handoff payload the witness completes. Nothing touches the
 *  chain here — consent alone is not an attestation. */
export async function subjectConsentPayload(
  circle: string,
  subjectCommitmentHex: string,
  month = lastClosedMonthIndex()
): Promise<SubjectHandoff> {
  const circlePk = new PublicKey(circle);
  const subject = fromHex(subjectCommitmentHex);
  const e = await externalNullifier("AHA-presence-month", circlePk, subject, month);
  // The single-leaf consent proof — only the holder of Poseidon(secret) ==
  // commitment can make it, which is the whole of "nobody can be written about
  // involuntarily".
  const { nullifier, proofA, proofB, proofC } = await proveWingEndorsement(
    circle,
    subjectCommitmentHex,
    e
  );
  return {
    v: 1,
    kind: "aha-presence-attestation",
    circle,
    subject: subjectCommitmentHex,
    month,
    nullifier,
    proofA,
    proofB,
    proofC,
  };
}

export const encodeHandoff = (p: SubjectHandoff): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(p))));

export function decodeHandoff(code: string): SubjectHandoff {
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0))
  );
  const p = JSON.parse(json);
  if (p?.v !== 1 || p?.kind !== "aha-presence-attestation") {
    throw new Error("This is not a presence attestation code.");
  }
  return p as SubjectHandoff;
}

/** WITNESS side: add the membership proof under the SAME E and submit both.
 *
 *  The same-E rule is what makes "two different people" provable: the circuit's
 *  nullifier is Poseidon(secret, E), so two proofs under one E with different
 *  nullifiers can only come from two different secrets. The program enforces
 *  the inequality; checking it here too just fails faster and with a kinder
 *  message. */
export async function witnessCompleteAttestation(
  wallet: SigningWallet,
  payload: SubjectHandoff,
  witnessCommitmentHex: string
): Promise<{ signature: string; relayed: boolean }> {
  const circlePk = new PublicKey(payload.circle);
  const subject = fromHex(payload.subject);
  const e = await externalNullifier("AHA-presence-month", circlePk, subject, payload.month);

  const w = await proveMemberEndorsement(wallet, payload.circle, witnessCommitmentHex, e);

  if (JSON.stringify(w.nullifier) === JSON.stringify(payload.nullifier)) {
    throw new Error(
      "The subject and the witness must be two different people — this looks like the subject's own device."
    );
  }

  const memberTree = PublicKey.findProgramAddressSync(
    [seed("members"), circlePk.toBytes()],
    PROGRAM_ID
  )[0];
  const presence = presencePda(circlePk, subject);

  const args = [
    [...subject],
    payload.month,
    w.root,
    payload.nullifier,
    w.nullifier,
    payload.proofA,
    payload.proofB,
    payload.proofC,
    w.proofA,
    w.proofB,
    w.proofC,
  ] as const;

  // Relayed whenever possible: a self-paying wallet links itself to the
  // attestation's timing, and both writes land close together (§4.4). The
  // relay route prepends the compute budget from its own allowlist.
  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.attestPresenceZk(...args)
      .accounts({
        circle: circlePk,
        memberTree,
        recentRoots: recentRootsPda(circlePk),
        presence,
        payer: relayer,
      })
      .instruction();
    return { signature: await relayInstruction(ix), relayed: true };
  }

  const signature = await programWith(wallet)
    .methods.attestPresenceZk(...args)
    .accounts({
      circle: circlePk,
      memberTree,
      recentRoots: recentRootsPda(circlePk),
      presence,
      payer: wallet.publicKey,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: ATTEST_COMPUTE_UNITS })])
    .rpc();
  return { signature, relayed: false };
}

/** Erase your own record. One proof — erasing is a claim about nothing, and
 *  requiring a witness would let a member be held to a record because no fellow
 *  member would sit with them. The month erased is read from the CHAIN, never
 *  passed in, mirroring the program (a proof binds to the record actually being
 *  destroyed). Live state afterwards is identical to never-claimed; the ledger
 *  residual is the accepted risk recorded in docs/presence.md §1. */
export async function clearMyPresence(
  wallet: SigningWallet,
  circle: string,
  subjectCommitmentHex: string
): Promise<{ signature: string; relayed: boolean }> {
  const circlePk = new PublicKey(circle);
  const subject = fromHex(subjectCommitmentHex);

  const lastMonth = await getPresence(circle, subjectCommitmentHex);
  if (lastMonth === null) throw new Error("There is no presence record to erase.");

  const e = await externalNullifier("AHA-presence-clear", circlePk, subject, lastMonth);
  const { nullifier, proofA, proofB, proofC } = await proveWingEndorsement(
    circle,
    subjectCommitmentHex,
    e
  );

  const presence = presencePda(circlePk, subject);
  const relayer = await relayerPubkey();
  if (relayer) {
    const ix = await readOnlyProgram()
      .methods.clearPresence([...subject], nullifier, proofA, proofB, proofC)
      .accounts({ circle: circlePk, presence, payer: relayer })
      .instruction();
    return { signature: await relayInstruction(ix), relayed: true };
  }
  const signature = await programWith(wallet)
    .methods.clearPresence([...subject], nullifier, proofA, proofB, proofC)
    .accounts({ circle: circlePk, presence, payer: wallet.publicKey })
    .rpc();
  return { signature, relayed: false };
}
