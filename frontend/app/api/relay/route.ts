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
// instance only — honest pilot limitation).
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

// Daily budget: a count, not lamports — rent varies per instruction and the
// count is what an abuser multiplies. Resets at UTC midnight, per instance.
let dayKey = "";
let dayCount = 0;
function overDailyBudget(): boolean {
  const cap = Number(process.env.AHA_RELAYER_DAILY_TXS || 500);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  dayCount += 1;
  return dayCount > cap;
}

export async function GET() {
  const kp = relayerKeypair();
  return NextResponse.json({ configured: kp !== null, relayer: kp ? kp.publicKey.toBase58() : null });
}

export async function POST(req: NextRequest) {
  const kp = relayerKeypair();
  if (!kp) return NextResponse.json({ error: "relayer not configured" }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  if (overDailyBudget()) return NextResponse.json({ error: "relayer daily budget exhausted" }, { status: 503 });

  let body: RelayRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const verdict = validateRelayRequest(body, kp.publicKey.toBase58());
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });

  const conn = new Connection(RPC_URL, "confirmed");

  // Solvency floor: keep enough to stay operable rather than draining to zero.
  const minBalance = Number(process.env.AHA_RELAYER_MIN_LAMPORTS || 50_000_000);
  const balance = await conn.getBalance(kp.publicKey);
  if (balance < minBalance) {
    return NextResponse.json({ error: "relayer balance too low" }, { status: 503 });
  }

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
    return NextResponse.json({ signature });
  } catch (e: any) {
    // Surface the failure class without echoing accounts or data back.
    return NextResponse.json({ error: "relay failed" }, { status: 502 });
  }
}
