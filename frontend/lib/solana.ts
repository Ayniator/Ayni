// Read-only on-chain access for the AHA directory. One getProgramAccounts call
// (via Anchor's account.all(), filtered by the CircleProfile discriminator)
// returns every Circle that has published a profile — fast enough for thousands.
// For very large deployments, swap this for an indexer with the same shape.

import * as anchor from "@coral-xyz/anchor";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import idl from "./ayni.json";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// Which cluster the app is wired to (derived from the RPC URL, devnet by
// default). Used to warn, before a wallet signs, that its selected network must
// match — otherwise Solflare/Phantom raise a "Network mismatch" and refuse.
export const CLUSTER: "mainnet" | "testnet" | "devnet" = /mainnet/i.test(RPC_URL)
  ? "mainnet"
  : /testnet/i.test(RPC_URL)
    ? "testnet"
    : "devnet";

// Helius (and most RPCs) rate-limit getProgramAccounts / getSignaturesForAddress.
// Retry 429/502/503 with exponential backoff + jitter so the heavy pages
// (inbox, foundation directory) don't surface transient "Too many requests".
const RETRY_STATUS = new Set([429, 502, 503]);
export async function rpcFetch(input: any, init?: any): Promise<Response> {
  let delay = 350;
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(input, init);
    } catch (e) {
      if (attempt >= 5) throw e;
    }
    if (res && !RETRY_STATUS.has(res.status)) return res;
    if (attempt >= 5) return res as Response;
    await new Promise((r) => setTimeout(r, delay + Math.random() * 250));
    delay = Math.min(delay * 2, 3000);
  }
}

/** A Connection that transparently retries rate-limited (429) RPC calls. */
export function rpcConnection(commitment: Commitment = "confirmed"): Connection {
  return new Connection(RPC_URL, { commitment, fetch: rpcFetch as any });
}

export interface Circle {
  pubkey: string; // the CircleProfile PDA
  circle: string; // the Circle account it describes
  lat: number; // degrees
  lon: number; // degrees
  name: string;
  city: string;
  address: string;
  twelveStepsCid: string;
  preambleCid: string;
  dailyReflectionsCid: string;
}

function readOnlyProgram(): anchor.Program {
  const connection = rpcConnection();
  // A provider with no wallet — fine for account reads.
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (t: any) => t,
      signAllTransactions: async (t: any) => t,
    } as any,
    { commitment: "confirmed" }
  );
  return new anchor.Program(idl as anchor.Idl, provider);
}

const PROFILE_CACHE_KEY = "aha:profiles:v1";

/** Last-known circles from localStorage (instant render before the RPC returns). */
export function cachedCircles(): Circle[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}

// Dedup + short TTL (see member.ts) to avoid hammering the public RPC (429).
const PROFILE_TTL_MS = 15_000;
let profileMemo: { data: Circle[]; ts: number } | null = null;
let profileInflight: Promise<Circle[]> | null = null;

/** Drop the in-memory profile cache (call after a profile upsert). */
export function invalidateProfiles() {
  profileMemo = null;
  profileInflight = null;
}

async function fetchAllCircles(): Promise<Circle[]> {
  const program = readOnlyProgram();
  const rows = await (program.account as any).circleProfile.all();
  const result: Circle[] = rows.map((r: any) => ({
    pubkey: r.publicKey.toBase58(),
    circle: r.account.circle.toBase58(),
    lat: r.account.latMicrodeg / 1e6,
    lon: r.account.lonMicrodeg / 1e6,
    name: r.account.name,
    city: r.account.city,
    address: r.account.address,
    twelveStepsCid: r.account.twelveStepsCid,
    preambleCid: r.account.preambleCid,
    dailyReflectionsCid: r.account.dailyReflectionsCid,
  }));
  if (typeof window !== "undefined") {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(result)); } catch {}
  }
  return result;
}

/** Every Circle with a published directory profile. One RPC round-trip; cached + deduped. */
export async function listAllCircles(force = false): Promise<Circle[]> {
  const now = Date.now();
  if (!force) {
    if (profileMemo && now - profileMemo.ts < PROFILE_TTL_MS) return profileMemo.data;
    if (profileInflight) return profileInflight;
  }
  const p = fetchAllCircles()
    .then((d) => { profileMemo = { data: d, ts: Date.now() }; profileInflight = null; return d; })
    .catch((e) => { profileInflight = null; throw e; });
  if (!force) profileInflight = p;
  return p;
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface CircleWithDistance extends Circle {
  distanceKm: number;
}

/** The `k` nearest circles to (lat, lon), closest first. */
export function nearest(circles: Circle[], lat: number, lon: number, k = 10): CircleWithDistance[] {
  return circles
    .map((c) => ({ ...c, distanceKm: distanceKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, k);
}
