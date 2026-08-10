// Epic 0 — the faucet ledger drop-box (see lib/faucetLedger.ts for the model).
//
// A deliberately dumb store: it accepts FIXED-SIZE sealed blobs and hands them
// back per circle. It cannot read them (sealed to the treasurer's key), it
// stores no identities, and it records nothing beyond the blob itself — no IP,
// no timestamps in the data. What the process can't avoid observing (arrival
// order, file mtime) is blurred by the client-side submission jitter and is an
// acknowledged pilot limit pending the Epic 10 relayer decision.
//
// Storage: append-only JSONL per circle under FAUCET_LEDGER_DIR (default
// .data/faucet-ledger — mount it as a volume in Docker to persist).

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// Must equal lib/faucetLedger.ts LEDGER_BLOB_LEN, base64-encoded.
const BLOB_LEN = 32 + 24 + 192 + 16;
const BLOB_B64_LEN = Math.ceil(BLOB_LEN / 3) * 4;
const MAX_ENTRIES_PER_CIRCLE = 10_000;

const DIR = process.env.FAUCET_LEDGER_DIR || path.join(process.cwd(), ".data", "faucet-ledger");

// Same shape of in-memory rate limit as the circle-email route.
const RATE_LIMIT = 20;
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

function circleFile(circle: string): string | null {
  try {
    // Validates base58 + length; the base58 string is then a safe filename.
    return path.join(DIR, `${new PublicKey(circle).toBase58()}.jsonl`);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { circle, blob } = body ?? {};
  const file = typeof circle === "string" ? circleFile(circle) : null;
  if (!file) return NextResponse.json({ ok: false, error: "circle is not an address" }, { status: 400 });
  if (typeof blob !== "string" || blob.length !== BLOB_B64_LEN || !/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) {
    return NextResponse.json({ ok: false, error: "blob must be a sealed entry of the fixed size" }, { status: 400 });
  }

  await fs.mkdir(DIR, { recursive: true });
  // Bound the file so one hostile client cannot grow it without limit.
  let count = 0;
  try {
    const existing = await fs.readFile(file, "utf8");
    count = existing.split("\n").filter(Boolean).length;
  } catch {
    /* first entry */
  }
  if (count >= MAX_ENTRIES_PER_CIRCLE) {
    return NextResponse.json({ ok: false, error: "ledger full" }, { status: 507 });
  }

  await fs.appendFile(file, blob + "\n");
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });

  const circle = req.nextUrl.searchParams.get("circle") || "";
  const file = circleFile(circle);
  if (!file) return NextResponse.json({ ok: false, error: "circle is not an address" }, { status: 400 });

  let blobs: string[] = [];
  try {
    blobs = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean);
  } catch {
    /* no ledger yet — empty is a fine answer */
  }
  return NextResponse.json({ ok: true, blobs });
}
