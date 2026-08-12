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
import { memberAuthority, sendMemberTx } from "./shielded";

const seed = (s: string) => new TextEncoder().encode(s);
const toBytes = (hex: string) => Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** Little-endian u64 seed bytes (no Buffer dependency). */
const leU64 = (n: number): Uint8Array => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
};

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
): Promise<{ signature: string; relayed: boolean }> {
  const newcomer = toBytes(newcomerCommitmentHex);
  // Authorised by whichever key the PARRAIN's membership answers to — the
  // derived key when it is shielded (F61), so shielding does not cost a member
  // the ability to sponsor a newcomer. This is still the NAMED path: the
  // parrain's commitment is recorded on chain by design (confirm_admission
  // needs it for the distinct-persons rule). What the shield changes is only
  // that no wallet of theirs is in the transaction.
  const auth = await memberAuthority(wallet, circle, parrainCommitmentHex);
  const program = programWith(wallet);
  return sendMemberTx(wallet, auth, (payer) =>
    program.methods
      .attestAdmission([...newcomer])
      .accounts({
        circle,
        parrainMembership: membershipPda(circle, toBytes(parrainCommitmentHex)),
        attestation: attestPda(circle, newcomer),
        parrain: auth.authority,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
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
  const rootsPda = PublicKey.findProgramAddressSync([seed("roots"), circle.toBytes()], PROGRAM_ID)[0];
  const memberTree = memberTreePda(circle);

  // recent_roots is now REQUIRED by confirm_admission — it seeds the F54b
  // anti-double-insert marker and pins the epoch, and making it mandatory stops
  // a seat omitting it. Crank note_root once to create the ring buffer if the
  // circle has none yet (a no-op cost for circles that already have one).
  let rootsAcct: any = await (readOnlyProgram().account as any).recentRoots
    .fetchNullable(rootsPda)
    .catch(() => null);
  if (!rootsAcct) {
    await programWith(wallet)
      .methods.noteRoot()
      .accounts({ circle, memberTree, recentRoots: rootsPda, caller: wallet.publicKey })
      .rpc();
    rootsAcct = await (readOnlyProgram().account as any).recentRoots.fetch(rootsPda);
  }
  const epoch = rootsAcct.epoch as anchor.BN;
  const epochLeaf = PublicKey.findProgramAddressSync(
    [seed("epochleaf"), circle.toBytes(), leU64(Number(epoch)), newcomer],
    PROGRAM_ID
  )[0];

  return programWith(wallet)
    .methods.confirmAdmission(epoch)
    .accounts({
      circle,
      membership: membershipPda(circle, newcomer),
      provisional: provisionalPda(circle, newcomer),
      attestation: attestPda(circle, newcomer),
      parrainMembership: anonymous ? null : membershipPda(circle, toBytes(parrainCommitmentHex)),
      memberTree,
      recentRoots: rootsPda,
      epochLeaf,
      servant: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
}
