// Seat-gated administration of a Circle. A wallet is an "admin" of a Circle
// when it holds one of the 7 Council seats; the program is the authority, so
// everything here maps to a real instruction:
//
//   Council votes (4-of-7)      propose / approve / execute_proposal / cancel_proposal
//   Group-conscience votes      create_member_proposal / finalize_member_proposal
//   Members                     issue_membership (add) / renew_membership (renew)
//
// There is intentionally NO on-chain suspend/delete for a membership (they are
// soulbound and anonymous); the console surfaces that honestly. See BACKLOG F24.

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SigningWallet,
  circleConfigPda,
  invalidateCircles,
  memberTreePda,
  openMembershipPda,
  programWith,
  readOnlyProgram,
  treasuryPda,
} from "./member";
import { SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "./multisig";

// ---------------------------------------------------------------------------
// Council seats / roles
// ---------------------------------------------------------------------------

/** The 7 seats, in council.seats index order. */
export const SEAT_ROLES = [
  "Treasurer",
  "Scribe-Secretary",
  "Rhythm Keeper",
  "Elder of the North",
  "Elder of the East",
  "Elder of the South",
  "Elder of the West",
] as const;

export const TREASURER = 0;
export const SECRETARY = 1;

/** Seat indices held by `wallet` in a circle's seat list (usually 0 or 1). */
export function mySeatIndices(seats: string[], wallet: string): number[] {
  return seats.map((s, i) => (s === wallet ? i : -1)).filter((i) => i >= 0);
}

export const seed = (s: string) => new TextEncoder().encode(s);

const proposalPda = (circle: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("proposal"), circle.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

const memberProposalPda = (circle: PublicKey, nonce: anchor.BN) =>
  PublicKey.findProgramAddressSync(
    [seed("mproposal"), circle.toBytes(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

/** A monotonic-ish nonce for a new proposal PDA (ms since epoch). */
export function freshNonce(): anchor.BN {
  return new anchor.BN(Date.now());
}

// ---------------------------------------------------------------------------
// Council proposals (the 4-of-7 votes)
// ---------------------------------------------------------------------------

export type CouncilActionKind = "rotateSeat" | "migrateWallet" | "withdrawTreasury" | "setTreasuryWallet";

export interface CouncilProposal {
  pubkey: string;
  nonce: string;
  kind: CouncilActionKind;
  summary: string; // human-readable action
  approvals: number; // popcount of the bitmask
  approvedSeats: number[]; // which seat indices approved
  threshold: number;
  executed: boolean;
  cancelled: boolean;
  drained: boolean;
  createdAt: number;
  eligibleAt: number; // 0 = not armed
  status: "running" | "passed" | "executed" | "cancelled";
}

function describeAction(action: any): { kind: CouncilActionKind; summary: string } {
  if (action.rotateSeat) {
    const i = action.rotateSeat.seatIndex;
    return {
      kind: "rotateSeat",
      summary: `Rotate ${SEAT_ROLES[i] ?? `seat ${i}`} → ${short(action.rotateSeat.newHolder)}`,
    };
  }
  if (action.migrateWallet) {
    return {
      kind: "migrateWallet",
      summary: `Migrate wallet ${short(action.migrateWallet.oldWallet)} → ${short(action.migrateWallet.newWallet)}`,
    };
  }
  if (action.setTreasuryWallet) {
    return {
      kind: "setTreasuryWallet",
      summary: `Set treasury wallet → ${short(action.setTreasuryWallet.newWallet)}`,
    };
  }
  const amt = action.withdrawTreasury.amount;
  return {
    kind: "withdrawTreasury",
    summary: `Withdraw ${Number(amt) / 1e9} SOL → ${short(action.withdrawTreasury.recipient)}`,
  };
}

const short = (k: PublicKey | string) => {
  const s = k.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

const seatsFromMask = (mask: number) =>
  Array.from({ length: 7 }, (_, i) => i).filter((i) => (mask >> i) & 1);

export async function listCouncilProposals(
  circle: string,
  threshold: number
): Promise<CouncilProposal[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).proposal.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  return rows
    .map((r: any): CouncilProposal => {
      const a = r.account;
      const { kind, summary } = describeAction(a.action);
      const approvals = countBits(a.approvals);
      const status: CouncilProposal["status"] = a.cancelled
        ? "cancelled"
        : a.executed
          ? "executed"
          : approvals >= threshold
            ? "passed"
            : "running";
      return {
        pubkey: r.publicKey.toBase58(),
        nonce: a.nonce.toString(),
        kind,
        summary,
        approvals,
        approvedSeats: seatsFromMask(a.approvals),
        threshold,
        executed: a.executed,
        cancelled: a.cancelled,
        drained: a.drained,
        createdAt: Number(a.createdAt),
        eligibleAt: Number(a.eligibleAt),
        status,
      };
    })
    .sort((x: CouncilProposal, y: CouncilProposal) => y.createdAt - x.createdAt);
}

const countBits = (n: number) => {
  let c = 0;
  for (let i = 0; i < 8; i++) c += (n >> i) & 1;
  return c;
};

/** Open a Council proposal; the proposer's seat approval is recorded by the program. */
export async function propose(
  wallet: SigningWallet,
  circle: PublicKey,
  action: any
): Promise<string> {
  const program = programWith(wallet);
  const nonce = freshNonce();
  return program.methods
    .propose(nonce, action)
    .accounts({ circle, proposal: proposalPda(circle, nonce), proposer: wallet.publicKey })
    .rpc();
}

export const actionRotateSeat = (seatIndex: number, newHolder: PublicKey) => ({
  rotateSeat: { seatIndex, newHolder },
});
export const actionMigrateWallet = (oldWallet: PublicKey, newWallet: PublicKey) => ({
  migrateWallet: { oldWallet, newWallet },
});
export const actionWithdrawTreasury = (lamports: bigint, recipient: PublicKey) => ({
  withdrawTreasury: { amount: new anchor.BN(lamports.toString()), recipient },
});
export const actionSetTreasuryWallet = (newWallet: PublicKey) => ({
  setTreasuryWallet: { newWallet },
});

export const treasuryConfigPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("treasurycfg"), circle.toBytes()], PROGRAM_ID)[0];

/** The Circle's designated treasury steward wallet, or null if none set. */
export async function getTreasuryWallet(circle: string): Promise<string | null> {
  const program = readOnlyProgram();
  try {
    const cfg = await (program.account as any).treasuryConfig.fetch(treasuryConfigPda(new PublicKey(circle)));
    const w = cfg.wallet.toBase58();
    return w === PublicKey.default.toBase58() ? null : w;
  } catch {
    return null; // no config account yet
  }
}

/** Apply an executed SetTreasuryWallet proposal (writes TreasuryConfig). The
 * voted wallet is read from the proposal and passed as the `multisig` account so
 * the program can verify it really is an m-of-n multisig (else TreasuryNotMultisig). */
export async function applyTreasuryWallet(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey
): Promise<string> {
  const program = programWith(wallet);
  const p: any = await (program.account as any).proposal.fetch(proposal);
  const newWallet: PublicKey = p.action?.setTreasuryWallet?.newWallet;
  if (!newWallet) throw new Error("proposal is not a SetTreasuryWallet action");
  return program
    .methods.setTreasuryWallet()
    .accounts({
      circle,
      proposal,
      multisig: newWallet,
      treasuryConfig: treasuryConfigPda(circle),
      payer: wallet.publicKey,
    } as any)
    .rpc();
}

/** The Circle's soulbound membership mint, or null if none created yet. */
export async function getMembershipMint(circle: string): Promise<string | null> {
  const program = readOnlyProgram();
  try {
    const c: any = await (program.account as any).circle.fetch(new PublicKey(circle));
    const m = c.membershipMint?.toBase58?.();
    return !m || m === PublicKey.default.toBase58() ? null : m;
  } catch {
    return null;
  }
}

/**
 * Create the Circle's soulbound (Token-2022 NonTransferable) membership mint and
 * register it — one instruction (F3). Treasurer-gated on-chain. The connected
 * wallet pays + signs as Treasurer; a fresh mint keypair co-signs its creation.
 * Returns the new mint address.
 */
export async function createMembershipMint(
  wallet: SigningWallet,
  circle: PublicKey
): Promise<{ sig: string; mint: string }> {
  const mint = Keypair.generate();
  const sig = await programWith(wallet)
    .methods.createMembershipMint()
    .accounts({
      circle,
      mint: mint.publicKey,
      treasurer: wallet.publicKey,
      payer: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .signers([mint])
    .rpc();
  return { sig, mint: mint.publicKey.toBase58() };
}

export async function approveProposal(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.approve()
    .accounts({ circle, proposal, seat: wallet.publicKey })
    .rpc();
}

export async function executeProposal(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey
): Promise<string> {
  const sig = await programWith(wallet)
    .methods.executeProposal()
    .accounts({ circle, proposal, executor: wallet.publicKey })
    .rpc();
  invalidateCircles(); // a RotateSeat/MigrateWallet may have changed the seats
  return sig;
}

export async function cancelProposal(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.cancelProposal()
    .accounts({ circle, proposal, seat: wallet.publicKey })
    .rpc();
}

// ---------------------------------------------------------------------------
// Group-conscience (member) proposals
// ---------------------------------------------------------------------------

export interface MemberProposal {
  pubkey: string;
  nonce: string;
  descriptionHash: string; // hex
  description: string | null; // resolved from local text store, if known
  yes: number;
  no: number;
  eligibleCount: number;
  deadline: number; // unix s
  finalized: boolean;
  passed: boolean;
  status: "running" | "ended-unfinalized" | "passed" | "failed";
}

export async function listMemberProposals(circle: string): Promise<MemberProposal[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).memberProposal.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): MemberProposal => {
      const a = r.account;
      const descriptionHash = hexOf(a.descriptionHash);
      const deadline = Number(a.deadline);
      const status: MemberProposal["status"] = a.finalized
        ? a.passed
          ? "passed"
          : "failed"
        : now >= deadline
          ? "ended-unfinalized"
          : "running";
      return {
        pubkey: r.publicKey.toBase58(),
        nonce: a.nonce.toString(),
        descriptionHash,
        description: recallProposalText(descriptionHash),
        yes: Number(a.yes),
        no: Number(a.no),
        eligibleCount: Number(a.eligibleCount),
        deadline,
        finalized: a.finalized,
        passed: a.passed,
        status,
      };
    })
    .sort((x: MemberProposal, y: MemberProposal) => y.deadline - x.deadline);
}

const hexOf = (b: ArrayLike<number>) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** sha256 of the proposal text → the on-chain description_hash. */
export async function hashDescription(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

export async function createMemberProposal(
  wallet: SigningWallet,
  circle: PublicKey,
  description: string,
  votingPeriodSecs: number
): Promise<string> {
  const program = programWith(wallet);
  const nonce = freshNonce();
  const hashBytes = await hashDescription(description);
  rememberProposalText(hexOf(hashBytes), description);
  return program.methods
    .createMemberProposal(nonce, [...hashBytes], new anchor.BN(votingPeriodSecs))
    .accounts({
      circle,
      memberTree: memberTreePda(circle),
      proposal: memberProposalPda(circle, nonce),
      proposer: wallet.publicKey,
    })
    .rpc();
}

// --- F28: member election of a Council seat (anonymous ZK ballot installs a seat) ---

/** H("AHA-elect" || seat_index || candidate) — the proposal's description_hash. */
async function electionHash(seatIndex: number, candidate: PublicKey): Promise<Uint8Array> {
  const data = new Uint8Array([...new TextEncoder().encode("AHA-elect"), seatIndex & 0xff, ...candidate.toBytes()]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export const electionPda = (proposal: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("election"), proposal.toBytes()], PROGRAM_ID)[0];

/** Open a seat election: create the member-vote proposal (committing to seat+candidate)
 *  and link it as a SeatElection, so a passing ballot installs the candidate. */
export async function proposeSeatElection(
  wallet: SigningWallet,
  circle: PublicKey,
  seatIndex: number,
  candidate: PublicKey,
  votingPeriodSecs: number
): Promise<string> {
  const program = programWith(wallet);
  const nonce = freshNonce();
  const proposal = memberProposalPda(circle, nonce);
  const hashBytes = await electionHash(seatIndex, candidate);
  rememberProposalText(hexOf(hashBytes), `Elect ${candidate.toBase58()} to ${SEAT_ROLES[seatIndex] ?? `seat ${seatIndex}`}`);
  await program.methods
    .createMemberProposal(nonce, [...hashBytes], new anchor.BN(votingPeriodSecs))
    .accounts({ circle, memberTree: memberTreePda(circle), proposal, proposer: wallet.publicKey })
    .rpc();
  return program.methods
    .linkSeatElection(seatIndex, candidate)
    .accounts({ circle, proposal, election: electionPda(proposal), payer: wallet.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}

/** Install the winner of a passed seat election into the Council. */
export async function installElectedSeat(wallet: SigningWallet, circle: PublicKey, proposal: PublicKey): Promise<string> {
  return programWith(wallet)
    .methods.installElectedSeat()
    .accounts({ circle, proposal, election: electionPda(proposal), caller: wallet.publicKey })
    .rpc();
}

export interface SeatElectionInfo { pubkey: string; proposal: string; seatIndex: number; candidate: string; installed: boolean }

/** Every seat election recorded for a Circle. */
export async function listSeatElections(circle: string): Promise<SeatElectionInfo[]> {
  const rows = await (readOnlyProgram().account as any).seatElection.all([{ memcmp: { offset: 8, bytes: circle } }]);
  return rows.map((r: any): SeatElectionInfo => ({
    pubkey: r.publicKey.toBase58(),
    proposal: r.account.proposal.toBase58(),
    seatIndex: r.account.seatIndex,
    candidate: r.account.candidate.toBase58(),
    installed: Boolean(r.account.installed),
  }));
}

export async function finalizeMemberProposal(
  wallet: SigningWallet,
  circle: PublicKey,
  proposal: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.finalizeMemberProposal()
    .accounts({
      proposal,
      config: circleConfigPda(circle),
      finalizer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

// Member-proposal text lives off-chain (only its hash is on-chain). Mirror the
// join-request pattern: keep what this browser authored so the list can show it.
const TEXT_KEY = "aha:proposal-text";
function rememberProposalText(hash: string, text: string) {
  if (typeof window === "undefined") return;
  const all = readTextStore();
  all[hash] = text;
  localStorage.setItem(TEXT_KEY, JSON.stringify(all));
}
function recallProposalText(hash: string): string | null {
  return readTextStore()[hash] ?? null;
}
function readTextStore(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(TEXT_KEY) || "{}");
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Members of a circle (for the management table)
// ---------------------------------------------------------------------------

export interface CircleMember {
  pubkey: string; // membership PDA
  commitment: string; // hex (anonymous identity)
  owner: string | null; // bound wallet, if any
  issuedAt: number;
  expiresAt: number;
  level: number;
  active: boolean;
}

export async function listCircleMembers(circle: string): Promise<CircleMember[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).membership.all([
    { memcmp: { offset: 8, bytes: circle } },
  ]);
  const now = Date.now() / 1000;
  return rows
    .map((r: any): CircleMember => {
      const a = r.account;
      const owner = a.owner.toBase58();
      const expiresAt = Number(a.expiresAt);
      return {
        pubkey: r.publicKey.toBase58(),
        commitment: hexOf(a.commitment),
        owner: owner === PublicKey.default.toBase58() ? null : owner,
        issuedAt: Number(a.issuedAt),
        expiresAt,
        level: a.level,
        active: expiresAt > now,
      };
    })
    .sort((x: CircleMember, y: CircleMember) => y.issuedAt - x.issuedAt);
}

/** Renew a membership for another term (anyone may pay; gift-renewals allowed). */
export async function renewMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  membership: PublicKey
): Promise<string> {
  return programWith(wallet)
    .methods.renewMembership()
    .accounts({
      circle,
      membership,
      config: circleConfigPda(circle),
      treasury: treasuryPda(circle),
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Revoke (delete) a membership — Scribe-Secretary seat only. Closes the account. */
export async function revokeMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  membership: PublicKey
): Promise<string> {
  const sig = await programWith(wallet)
    .methods.revokeMembership()
    .accounts({ circle, membership, secretary: wallet.publicKey })
    .rpc();
  invalidateCircles(); // member_count changed
  return sig;
}

// ---------------------------------------------------------------------------
// Membership-admission policy (permissionless vs Scribe-Secretary-gated)
// ---------------------------------------------------------------------------

/**
 * Toggle a Circle's admission policy. `open = true` → permissionless (anyone may
 * self-admit); `open = false` → the Scribe-Secretary validates. Any Council seat
 * may set it (the program enforces seat membership).
 */
export async function setOpenMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  open: boolean
): Promise<string> {
  const sig = await programWith(wallet)
    .methods.setOpenMembership(open)
    .accounts({ circle, openMembership: openMembershipPda(circle), seat: wallet.publicKey })
    .rpc();
  invalidateCircles(); // the `open` flag changed
  return sig;
}
