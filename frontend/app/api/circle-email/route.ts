// Server route that sends a Circle's mail (F25). Runs in the Node runtime so it
// can use SMTP. Two events:
//   provision — a Circle was created → greet its newly-assigned address.
//   join      — a member registered  → notify the Circle with the member's wallet.
//
// Configure via env (server-side, NOT NEXT_PUBLIC):
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" for 465), SMTP_USER,
//   SMTP_PASS, SMTP_FROM, AHA_EMAIL_DOMAIN (falls back to NEXT_PUBLIC_AHA_EMAIL_DOMAIN).
// With no SMTP_HOST the route still returns the derived address (configured:false)
// so the UI degrades honestly instead of faking a send.

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../../lib/ayni.json";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey((idl as any).address);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// This route holds SMTP credentials and is reachable by anyone, so it trusts
// NOTHING the caller says. Every claim is checked against the chain before a
// message goes out: the Circle must exist and carry the name given, and a
// "join" must correspond to a real Membership of that Circle. Verifying against
// the chain (rather than a shared secret) is what lets the browser and the
// indexer worker both call it without either holding a credential.

// Anchor layout offsets in the Circle account (see programs/ayni/src/state.rs):
// 8 discriminator + 32 parent + 233 Council + 8 period + 8 count + 1 personhood
// + 32 root + 32 mint = 354, then a 4-byte LE length and the name bytes.
const CIRCLE_NAME_OFFSET = 354;
// Membership: 8 + 32 circle + 32 commitment + 8 issued + 8 expires + 1 level.
const MEMBERSHIP_CIRCLE_OFFSET = 8;
const MEMBERSHIP_OWNER_OFFSET = 89;

// Bounded outbound mail: a burst from one source can neither flood a Circle's
// inbox nor get the sending domain listed as a spam source.
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

function emailFor(name: string, pubkey: string): string {
  const domain = process.env.AHA_EMAIL_DOMAIN || process.env.NEXT_PUBLIC_AHA_EMAIL_DOMAIN || "aha.community";
  const slug =
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "circle";
  return `${slug}-${pubkey.slice(0, 6).toLowerCase()}@${domain}`;
}

/** The Circle's on-chain name, or null if the account is absent/undecodable. */
async function onChainCircleName(conn: Connection, circle: PublicKey): Promise<string | null> {
  const info = await conn.getAccountInfo(circle);
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  const d = info.data;
  if (d.length < CIRCLE_NAME_OFFSET + 4) return null;
  const len = d.readUInt32LE(CIRCLE_NAME_OFFSET);
  if (len > 32 || d.length < CIRCLE_NAME_OFFSET + 4 + len) return null;
  return d.subarray(CIRCLE_NAME_OFFSET + 4, CIRCLE_NAME_OFFSET + 4 + len).toString("utf8");
}

/** Does `owner` really hold a Membership of `circle`? */
async function ownsMembership(conn: Connection, circle: PublicKey, owner: PublicKey): Promise<boolean> {
  const found = await conn.getProgramAccounts(PROGRAM_ID, {
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: MEMBERSHIP_CIRCLE_OFFSET, bytes: circle.toBase58() } },
      { memcmp: { offset: MEMBERSHIP_OWNER_OFFSET, bytes: owner.toBase58() } },
    ],
  });
  return found.length > 0;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { kind, circleName, circlePubkey, memberAddress } = body ?? {};
  if (!circleName || !circlePubkey) {
    return NextResponse.json({ ok: false, error: "circleName and circlePubkey are required" }, { status: 400 });
  }

  // --- verify against the chain before anything is sent ---------------------
  let circle: PublicKey;
  try {
    circle = new PublicKey(String(circlePubkey));
  } catch {
    return NextResponse.json({ ok: false, error: "circlePubkey is not an address" }, { status: 400 });
  }

  const conn = new Connection(RPC_URL, "confirmed");
  let onChainName: string | null;
  try {
    onChainName = await onChainCircleName(conn, circle);
  } catch {
    return NextResponse.json({ ok: false, error: "could not verify the Circle on-chain" }, { status: 503 });
  }
  if (onChainName === null) {
    return NextResponse.json({ ok: false, error: "no such Circle" }, { status: 404 });
  }
  // The name decides the destination address, so a forged one would redirect
  // mail to an address of the caller's choosing.
  if (onChainName !== String(circleName)) {
    return NextResponse.json({ ok: false, error: "circleName does not match the Circle" }, { status: 400 });
  }

  const isJoin = kind === "join";
  if (isJoin && memberAddress) {
    let member: PublicKey;
    try {
      member = new PublicKey(String(memberAddress));
    } catch {
      return NextResponse.json({ ok: false, error: "memberAddress is not an address" }, { status: 400 });
    }
    let real = false;
    try {
      real = await ownsMembership(conn, circle, member);
    } catch {
      return NextResponse.json({ ok: false, error: "could not verify the membership" }, { status: 503 });
    }
    if (!real) {
      return NextResponse.json({ ok: false, error: "no such membership in this Circle" }, { status: 400 });
    }
  }

  const to = emailFor(onChainName, String(circlePubkey));

  const host = process.env.SMTP_HOST;
  if (!host) {
    // Address is assigned regardless; we just can't deliver mail here.
    return NextResponse.json({ ok: false, configured: false, to });
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  const from =
    process.env.SMTP_FROM ||
    `Ayni <no-reply@${process.env.AHA_EMAIL_DOMAIN || process.env.NEXT_PUBLIC_AHA_EMAIL_DOMAIN || "aha.community"}>`;

  const subject = isJoin ? `New member registered — ${onChainName}` : `Circle registered — ${onChainName}`;
  const text = isJoin
    ? `A new member has registered with ${onChainName}.\n\n` +
      `Member wallet: ${memberAddress || "(fully anonymous — no wallet bound)"}\n` +
      `Circle account: ${circlePubkey}\n\n— Ayni (AHA on Solana)`
    : `${onChainName} has been created on-chain and assigned this contact address (${to}).\n\n` +
      `Circle account: ${circlePubkey}\n\n— Ayni (AHA on Solana)`;

  try {
    const info = await transport.sendMail({ from, to, subject, text });
    return NextResponse.json({ ok: true, configured: true, to, id: info.messageId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, configured: true, to, error: String(e?.message || e) }, { status: 502 });
  }
}
