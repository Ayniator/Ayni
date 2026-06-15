// Wallet-side helpers for the member experience: who am I on-chain, joining a
// Circle (home circle), and the 7th Tradition (donating SOL to any Circle's
// treasury, including the foundation).
//
// Program facts this file encodes:
// - A Membership is keyed by a ZK commitment; `owner` (offset 89) optionally
//   binds a wallet, which is how we find "my" memberships with one memcmp.
// - `issue_membership` must be signed by the Circle's Secretary seat
//   (council.seats[1]) — members cannot self-admit. So "joining" here means:
//   generate a commitment, and either issue directly (when the connected
//   wallet IS the Secretary) or produce a join request to hand to them.
// - `donate(lamports)` moves SOL into the per-Circle treasury PDA
//   ["treasury", circle]; anyone may give any amount to any Circle.

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./ayni.json";
import { RPC_URL, rpcConnection } from "./solana";

export const PROGRAM_ID = new PublicKey((idl as any).address);
export const SECRETARY_SEAT = 1; // [Treasurer, Secretary, RhythmKeeper, 4 Elders]

const seed = (s: string) => new TextEncoder().encode(s);

export const treasuryPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("treasury"), circle.toBytes()], PROGRAM_ID)[0];

/** The per-Circle policy PDA: ["config", circle]. */
export const circleConfigPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("config"), circle.toBytes()], PROGRAM_ID)[0];

export const memberTreePda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("members"), circle.toBytes()], PROGRAM_ID)[0];

/** The membership-policy marker PDA: ["openjoin", circle]. */
export const openMembershipPda = (circle: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("openjoin"), circle.toBytes()], PROGRAM_ID)[0];

export const membershipPda = (circle: PublicKey, commitment: Uint8Array) =>
  PublicKey.findProgramAddressSync(
    [seed("membership"), circle.toBytes(), commitment],
    PROGRAM_ID
  )[0];

/** A wallet that can sign (the shape `useAnchorWallet()` returns). */
export interface SigningWallet {
  publicKey: PublicKey;
  signTransaction: any;
  signAllTransactions: any;
}

export function connection(): Connection {
  return rpcConnection();
}

export function programWith(wallet: SigningWallet): anchor.Program {
  const provider = new anchor.AnchorProvider(connection(), wallet as any, {
    commitment: "confirmed",
  });
  return new anchor.Program(idl as anchor.Idl, provider);
}

// ---------------------------------------------------------------------------
// Circles (the Circle accounts themselves — every group, profile or not)
// ---------------------------------------------------------------------------

export interface CircleInfo {
  pubkey: string;
  name: string;
  parent: string;
  memberCount: number;
  membershipPeriod: number; // seconds
  requirePersonhood: boolean;
  seats: string[]; // 7 Council seats
  open: boolean; // true = permissionless join; false = Scribe-Secretary validates
}

export function readOnlyProgram(): anchor.Program {
  const provider = new anchor.AnchorProvider(
    connection(),
    { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
    { commitment: "confirmed" }
  );
  return new anchor.Program(idl as anchor.Idl, provider);
}

const CIRCLE_CACHE_KEY = "aha:circles:v1";

/** Last-known circles from localStorage (instant render before the RPC returns). */
export function cachedCircleInfos(): CircleInfo[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CIRCLE_CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}

// In-memory dedup + short TTL so the nav's seat-checkers and the page that
// mounts don't each fire their own getProgramAccounts (public devnet RPC
// rate-limits those hard → HTTP 429). One network call is shared for ~15s;
// writes call `invalidateCircles()` to force the next read fresh.
const CIRCLE_TTL_MS = 15_000;
let circleMemo: { data: CircleInfo[]; ts: number } | null = null;
let circleInflight: Promise<CircleInfo[]> | null = null;

/** Drop the in-memory circle cache (call after a tx that changes circles). */
export function invalidateCircles() {
  circleMemo = null;
  circleInflight = null;
}

async function fetchCircles(): Promise<CircleInfo[]> {
  const program = readOnlyProgram();
  const [rows, openRows] = await Promise.all([
    (program.account as any).circle.all(),
    (program.account as any).openMembership.all(),
  ]);
  // Circles whose policy marker exists and is set open (permissionless).
  const openCircles = new Set<string>(
    openRows.filter((r: any) => r.account.open).map((r: any) => r.account.circle.toBase58())
  );
  const result: CircleInfo[] = rows.map((r: any) => {
    const pubkey = r.publicKey.toBase58();
    return {
      pubkey,
      name: r.account.name,
      parent: r.account.parent.toBase58(),
      memberCount: Number(r.account.memberCount),
      membershipPeriod: Number(r.account.membershipPeriod),
      requirePersonhood: r.account.requirePersonhood,
      seats: r.account.council.seats.map((s: PublicKey) => s.toBase58()),
      open: openCircles.has(pubkey),
    };
  });
  if (typeof window !== "undefined") {
    try { localStorage.setItem(CIRCLE_CACHE_KEY, JSON.stringify(result)); } catch {}
  }
  return result;
}

export async function listCircles(force = false): Promise<CircleInfo[]> {
  const now = Date.now();
  if (!force) {
    if (circleMemo && now - circleMemo.ts < CIRCLE_TTL_MS) return circleMemo.data;
    if (circleInflight) return circleInflight;
  }
  const p = fetchCircles()
    .then((d) => { circleMemo = { data: d, ts: Date.now() }; circleInflight = null; return d; })
    .catch((e) => { circleInflight = null; throw e; });
  if (!force) circleInflight = p;
  return p;
}

/**
 * The foundation (World Service) Circle: `NEXT_PUBLIC_FOUNDATION_CIRCLE` if
 * set, otherwise the first Circle whose name reads like the foundation.
 */
export function foundationOf(circles: CircleInfo[]): CircleInfo | null {
  const pinned = process.env.NEXT_PUBLIC_FOUNDATION_CIRCLE;
  if (pinned) return circles.find((c) => c.pubkey === pinned) ?? null;
  return circles.find((c) => /world service|foundation/i.test(c.name)) ?? null;
}

// ---------------------------------------------------------------------------
// My memberships
// ---------------------------------------------------------------------------

// Membership layout: 8 discriminator + 32 circle + 32 commitment + 8 issued_at
// + 8 expires_at + 1 level → owner at offset 89.
const OWNER_OFFSET = 89;

export interface MyMembership {
  pubkey: string;
  circle: string;
  circleName: string;
  commitment: string; // hex
  issuedAt: number; // unix seconds
  expiresAt: number;
  level: number;
  active: boolean;
}

export async function findMyMemberships(
  owner: PublicKey,
  circles: CircleInfo[]
): Promise<MyMembership[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).membership.all([
    { memcmp: { offset: OWNER_OFFSET, bytes: owner.toBase58() } },
  ]);
  const byPubkey = new Map(circles.map((c) => [c.pubkey, c]));
  const now = Date.now() / 1000;
  return rows.map((r: any) => {
    const circle = r.account.circle.toBase58();
    const expiresAt = Number(r.account.expiresAt);
    return {
      pubkey: r.publicKey.toBase58(),
      circle,
      circleName: byPubkey.get(circle)?.name ?? circle.slice(0, 8) + "…",
      commitment: hex(Uint8Array.from(r.account.commitment)),
      issuedAt: Number(r.account.issuedAt),
      expiresAt,
      level: r.account.level,
      active: expiresAt > now,
    };
  });
}

// ---------------------------------------------------------------------------
// Joining (home circle)
// ---------------------------------------------------------------------------

/**
 * A fresh anonymous identity commitment: 32 random bytes with the top 3 bits
 * cleared so the value is < the BN254 field modulus (a valid Poseidon input).
 */
export function newCommitment(): Uint8Array {
  const c = new Uint8Array(32);
  crypto.getRandomValues(c);
  c[0] &= 0x1f;
  return c;
}

export const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Issue a membership in `circle` keyed by `commitment` and bound to `owner`.
 *
 * - Gated Circle (default): succeeds only when `wallet` holds the Scribe-Secretary
 *   seat (the program enforces it). Pass `open: false`.
 * - Permissionless Circle: pass `open: true` and the open-policy marker is sent,
 *   so any `wallet` may self-admit (no seat required).
 */
export async function issueMembership(
  wallet: SigningWallet,
  circle: PublicKey,
  commitment: Uint8Array,
  owner: PublicKey,
  open = false
): Promise<string> {
  const program = programWith(wallet);
  const noGuardians = [PublicKey.default, PublicKey.default];
  return program.methods
    .issueMembership([...commitment], owner, noGuardians, false)
    .accounts({
      circle,
      membership: membershipPda(circle, commitment),
      memberTree: memberTreePda(circle),
      personhood: null,
      openMembership: open ? openMembershipPda(circle) : null,
      secretary: wallet.publicKey,
    } as any)
    .rpc();
}

// ---------------------------------------------------------------------------
// 7th Tradition — donate SOL to a Circle's treasury
// ---------------------------------------------------------------------------

export async function donateSol(
  wallet: SigningWallet,
  circle: PublicKey,
  lamports: bigint
): Promise<string> {
  const program = programWith(wallet);
  return program.methods
    .donate(new anchor.BN(lamports.toString()))
    .accounts({ circle, treasury: treasuryPda(circle), donor: wallet.publicKey })
    .rpc();
}

/** Current SOL balance of a Circle's treasury, in lamports. */
export async function treasuryBalance(circle: PublicKey): Promise<number> {
  return connection().getBalance(treasuryPda(circle));
}

// ---------------------------------------------------------------------------
// Local state: home circle + pending join requests (browser-only)
// ---------------------------------------------------------------------------

const HOME_KEY = "aha:home-circle";
const REQUESTS_KEY = "aha:join-requests";

export const getHomeCircle = (): string | null =>
  typeof window === "undefined" ? null : localStorage.getItem(HOME_KEY);

export const setHomeCircle = (circle: string) => localStorage.setItem(HOME_KEY, circle);

export interface JoinRequest {
  circle: string;
  circleName: string;
  commitment: string; // hex — hand this + your wallet address to the Secretary
  owner: string;
  createdAt: number; // unix ms
}

export function getJoinRequests(): JoinRequest[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(REQUESTS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveJoinRequest(req: JoinRequest) {
  const all = getJoinRequests().filter((r) => r.circle !== req.circle);
  all.push(req);
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(all));
}

export function clearJoinRequest(circle: string) {
  localStorage.setItem(
    REQUESTS_KEY,
    JSON.stringify(getJoinRequests().filter((r) => r.circle !== circle))
  );
}

// Explorer links — derive the cluster from the RPC URL (devnet by default).
export function explorerTx(sig: string): string {
  const cluster = RPC_URL.includes("devnet")
    ? "?cluster=devnet"
    : RPC_URL.includes("testnet")
      ? "?cluster=testnet"
      : RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost")
        ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
        : "";
  return `https://explorer.solana.com/tx/${sig}${cluster}`;
}
