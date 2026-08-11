// F55 — the relayer (ADR 0005's second half): submits allowlisted Ayni
// transactions with ITS key as fee-payer, so an anonymous action (ZK ballot,
// anonymous attestation, sealed message, visit proof, crank) is not
// deanonymized by whoever paid for it.
//
// Configure via env (server-side, NOT NEXT_PUBLIC):
//   AHA_RELAYER_SECRET       the relayer keypair — either the JSON byte array a
//                            `solana-keygen` file holds, or a base58 secret key.
//   AHA_RELAYER_DAILY_TXS    max relayed transactions per UTC day (default 500).
//   AHA_RELAYER_MIN_LAMPORTS refuse below this balance (default 50_000_000).
// With no secret the route reports {configured:false} and clients fall back to
// self-paying (named on chain — the pilot honesty the UI must state).
//
// What the relayer can and cannot see, stated plainly: it sees the caller's IP,
// the instruction, and the timing — it can therefore correlate "someone at this
// IP voted around 12:03". It CANNOT see ballot contents (ZK), message plaintext
// (sealed), or which member acted (no wallet signature ever reaches it). It
// must NOT log — this file deliberately contains no logging call of any kind,
// and the privacy sweep greps for that. Batching/mixing to blunt the timing
// channel is the documented next step (docs/messaging-migration.md §3).
//
// Why the policy is strict (see lib/relayPolicy.ts for the allowlist): this
// route signs attacker-supplied bytes with a funded key. The policy pins the
// program, the instruction set, the account shapes, and "the relayer is the
// ONLY signer" — its signature can only ever mean "paid the fee", never
// authority.

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import idl from "../../../lib/ayni.json";
import { validateRelayRequest, RelayRequest } from "../../../lib/relayPolicy";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey((idl as any).address);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

function relayerKeypair(): Keypair | null {
  const raw = process.env.AHA_RELAYER_SECRET;
  if (!raw) return null;
  try {
    if (raw.trim().startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    // base58 secret key
    const bs58 = require("bs58");
    const decode = bs58.decode ?? bs58.default?.decode;
    return Keypair.fromSecretKey(Uint8Array.from(decode(raw.trim())));
  } catch {
    return null;
  }
}

// Per-IP rate limit (same in-process pattern as the circle-email route: per
// instance only — honest pilot limitation). The IP is taken from X-Forwarded-For
// and is therefore SPOOFABLE (ultracode 2026-08-11c): an attacker rotating the
// header defeats the per-IP bucket. So the per-IP limit is only the first,
// best-effort gate; the GLOBAL limiter below (which no header can rotate around)
// is the real backstop, and the daily tx/lamports caps bound total loss.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return recent.length > RATE_LIMIT;
}

// Global rate limit across ALL callers — unspoofable (no per-IP key), so
// X-Forwarded-For rotation cannot exhaust throughput or the daily budget with a
// flood of requests. Sized well above the per-IP limit for a small pilot.
const GLOBAL_LIMIT = 60;
let globalHits: number[] = [];
function globallyRateLimited(): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < RATE_WINDOW_MS);
  globalHits.push(now);
  return globalHits.length > GLOBAL_LIMIT;
}

// Daily budget: BOTH a transaction count and a LAMPORTS cap, reset at UTC
// midnight (per instance). The lamports cap is the money backstop — an
// allowlisted instruction still creates program-owned PDAs whose rent the
// relayer pays and cannot reclaim (ultracode MEDIUM, 2026-08-11b: a caller can
// pick the most rent-expensive allowlisted instruction to burn funds). Counting
// transactions alone doesn't bound the loss; counting lamports does.
let dayKey = "";
let dayCount = 0;
let daySpent = 0;
function newDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
    daySpent = 0;
  }
}
// Pure CHECK — no side effect (ultracode 2026-08-11d): incrementing here, before
// the balance/lamports checks and the send, let a policy-valid request that is
// then rejected (balance too low, lamports exhausted, or a deliberate on-chain
// failure like an init-collision) still permanently consume the count — ~500
// cheap failing requests would exhaust the daily budget and 503 every honest
// caller until UTC midnight. The increment is committed on the SUCCESS path only
// (recordTx, next to recordSpend).
function wouldExceedDailyTxBudget(): boolean {
  newDay();
  return dayCount + 1 > Number(process.env.AHA_RELAYER_DAILY_TXS || 500);
}
function recordTx(): void {
  newDay();
  dayCount += 1;
}
function overDailyLamports(pending: number): boolean {
  newDay();
  const cap = Number(process.env.AHA_RELAYER_DAILY_LAMPORTS || 200_000_000); // ~0.2 SOL/day default
  return daySpent + pending > cap;
}
function recordSpend(lamports: number): void {
  daySpent += lamports;
}

// TOCTOU guard (ultracode 2026-08-11c): balance-floor and lamports-cap checks
// used to read state, then sign — so N concurrent relays all passed the same
// pre-check and overshot the cap together. We now RESERVE a conservative cost
// up front (so concurrent requests see each other's in-flight spend) and
// reconcile to the actual cost after confirmation. EST_COST bounds one relay's
// worst case: the largest allowlisted account's rent (send_message, 528-byte
// ciphertext ≈ 0.005 SOL) plus fees, rounded up.
const EST_COST = 6_000_000;
let outstanding = 0;

export async function GET() {
  const kp = relayerKeypair();
  return NextResponse.json({ configured: kp !== null, relayer: kp ? kp.publicKey.toBase58() : null });
}

export async function POST(req: NextRequest) {
  const kp = relayerKeypair();
  if (!kp) return NextResponse.json({ error: "relayer not configured" }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // Per-IP (spoofable, first gate) AND global (unspoofable, real backstop).
  if (rateLimited(ip) || globallyRateLimited()) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let body: RelayRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Validate BEFORE spending any budget: an invalid or spoofed request must not
  // consume the daily transaction count (ultracode 2026-08-11c).
  const verdict = validateRelayRequest(body, kp.publicKey.toBase58());
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });

  // Only a well-formed, allowlisted request MAY count toward the day — but the
  // count is committed after a successful relay (recordTx below), not here, so a
  // request that passes validation and then fails cannot inflate the budget.
  if (wouldExceedDailyTxBudget()) return NextResponse.json({ error: "relayer daily budget exhausted" }, { status: 503 });

  const conn = new Connection(RPC_URL, "confirmed");

  // Solvency floor + lamports cap, evaluated against in-flight RESERVATIONS so
  // concurrent relays cannot all pass the same pre-check and overshoot together.
  const minBalance = Number(process.env.AHA_RELAYER_MIN_LAMPORTS || 50_000_000);
  const balanceBefore = await conn.getBalance(kp.publicKey);
  if (balanceBefore - outstanding - EST_COST < minBalance) {
    return NextResponse.json({ error: "relayer balance too low" }, { status: 503 });
  }
  if (overDailyLamports(outstanding + EST_COST)) {
    return NextResponse.json({ error: "relayer daily lamports budget exhausted" }, { status: 503 });
  }

  // Reserve this relay's worst-case cost for the duration it is in flight.
  outstanding += EST_COST;
  try {
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID, // server-pinned: a request cannot target another program
      keys: body.keys.map((k) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(body.data, "base64"),
    });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: kp.publicKey }).add(ix);
    tx.sign(kp);
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    // Reconcile: release the reservation and charge the ACTUAL cost (fee + any
    // rent) against the daily lamports cap; once exhausted, further relays are
    // refused until UTC midnight — the money backstop against rent-burn drain.
    outstanding = Math.max(0, outstanding - EST_COST);
    try {
      const spent = Math.max(0, balanceBefore - (await conn.getBalance(kp.publicKey)));
      recordSpend(spent);
    } catch {
      recordSpend(6000); // conservative fee estimate if the balance re-read fails
    }
    // Commit the tx-count budget now that a relay has actually landed.
    recordTx();
    if (overDailyLamports(0)) {
      return NextResponse.json({ signature, warning: "relayer daily lamports budget reached" });
    }
    return NextResponse.json({ signature });
  } catch (e: any) {
    // Release the reservation on failure too, so a failed relay doesn't
    // permanently subtract from the budget.
    outstanding = Math.max(0, outstanding - EST_COST);
    // Surface the failure class without echoing accounts or data back.
    return NextResponse.json({ error: "relay failed" }, { status: 502 });
  }
}
