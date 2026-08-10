// Two-sponsor admission (Trust Platform Epic 1, amended v0.2) — client helpers.
//
// The asymmetric pair: the PARRAIN (any member in good standing) attests first;
// the newcomer then enters PROVISIONALLY (page live, faucet usable, but their
// commitment is not in the member tree, so every members-only proof fails by
// construction); finally a TRUSTED SERVANT (any of the 7 Council seats, a
// different person than the parrain — program-enforced) confirms, which inserts
// the commitment into the votable set and closes the provisional marker.

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SigningWallet,
  membershipPda,
  memberTreePda,
  programWith,
  readOnlyProgram,
  twoSponsorPda,
} from "./member";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const attestPda = (circle: PublicKey, newcomer: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("attest"), circle.toBytes(), newcomer], PROGRAM_ID)[0];

export const provisionalPda = (circle: PublicKey, commitment: Uint8Array) =>
  PublicKey.findProgramAddressSync([seed("provisional"), circle.toBytes(), commitment], PROGRAM_ID)[0];

/** Is two-sponsor admission required in this Circle? */
export async function getTwoSponsorPolicy(circle: PublicKey): Promise<boolean> {
  try {
    const a: any = await (readOnlyProgram().account as any).twoSponsorAdmission.fetch(twoSponsorPda(circle));
    return Boolean(a.required);
  } catch {
    return false;
  }
}

/** Any Council seat toggles the policy. */
export async function setTwoSponsorAdmission(wallet: SigningWallet, circle: PublicKey, required: boolean): Promise<string> {
  return programWith(wallet)
    .methods.setTwoSponsorAdmission(required)
    .accounts({ circle, policy: twoSponsorPda(circle), seat: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}

/** The parrain (holding a key of their own membership) attests for a newcomer. */
export async function attestAdmission(
  wallet: SigningWallet,
  circle: PublicKey,
  parrainCommitmentHex: string,
  newcomerCommitmentHex: string
): Promise<string> {
  const newcomer = toBytes(newcomerCommitmentHex);
  return programWith(wallet)
    .methods.attestAdmission([...newcomer])
    .accounts({
      circle,
      parrainMembership: membershipPda(circle, toBytes(parrainCommitmentHex)),
      attestation: attestPda(circle, newcomer),
      parrain: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Has a parrain already attested for this newcomer commitment? */
export async function hasAttestation(circle: PublicKey, newcomerCommitmentHex: string): Promise<boolean> {
  const info = await (readOnlyProgram().provider.connection as any).getAccountInfo(
    attestPda(circle, toBytes(newcomerCommitmentHex))
  );
  return info !== null;
}

/** The newcomer (or anyone) creates the provisional membership after attestation. */
export async function issueProvisionalMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  commitment: Uint8Array,
  owner: PublicKey
): Promise<string> {
  const noGuardians = [PublicKey.default, PublicKey.default];
  return programWith(wallet)
    .methods.issueProvisionalMembership([...commitment], owner, noGuardians, false)
    .accounts({
      circle,
      policy: twoSponsorPda(circle),
      attestation: attestPda(circle, commitment),
      membership: membershipPda(circle, commitment),
      provisional: provisionalPda(circle, commitment),
      personhood: null,
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}

export interface PendingAdmission {
  commitment: string; // hex
  parrain: string; // hex commitment of the attesting parrain
  issuedAt: number;
}

/** Provisional members of a Circle awaiting a trusted servant's confirmation. */
export async function listProvisionals(circle: string): Promise<PendingAdmission[]> {
  const rows = await (readOnlyProgram().account as any).provisionalMember.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  const out: PendingAdmission[] = [];
  for (const r of rows) {
    const commitment = toHex(Uint8Array.from(r.account.commitment));
    let parrain = "";
    try {
      const a: any = await (readOnlyProgram().account as any).admissionAttestation.fetch(
        attestPda(new PublicKey(circle), Uint8Array.from(r.account.commitment))
      );
      parrain = toHex(Uint8Array.from(a.parrain));
    } catch {
      /* attestation missing — should not happen, listed anyway */
    }
    out.push({ commitment, parrain, issuedAt: Number(r.account.issuedAt) });
  }
  return out.sort((a, b) => a.issuedAt - b.issuedAt);
}

/** A trusted servant confirms: the newcomer joins the votable set.
 *  `parrainCommitmentHex` is empty/zero for an ANONYMOUS (Epic 2) attestation —
 *  there is no parrain account to pass, by design. */
export async function confirmAdmission(
  wallet: SigningWallet,
  circle: PublicKey,
  newcomerCommitmentHex: string,
  parrainCommitmentHex: string
): Promise<string> {
  const newcomer = toBytes(newcomerCommitmentHex);
  const anonymous = !parrainCommitmentHex || /^0*$/.test(parrainCommitmentHex);
  return programWith(wallet)
    .methods.confirmAdmission()
    .accounts({
      circle,
      membership: membershipPda(circle, newcomer),
      provisional: provisionalPda(circle, newcomer),
      attestation: attestPda(circle, newcomer),
      parrainMembership: anonymous ? null : membershipPda(circle, toBytes(parrainCommitmentHex)),
      memberTree: memberTreePda(circle),
      servant: wallet.publicKey,
    } as any)
    .rpc();
}
