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

export const runtime = "nodejs";

function emailFor(name: string, pubkey: string): string {
  const domain = process.env.AHA_EMAIL_DOMAIN || process.env.NEXT_PUBLIC_AHA_EMAIL_DOMAIN || "aha.community";
  const slug =
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "circle";
  return `${slug}-${pubkey.slice(0, 6).toLowerCase()}@${domain}`;
}

export async function POST(req: NextRequest) {
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

  const to = emailFor(String(circleName), String(circlePubkey));

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

  const isJoin = kind === "join";
  const subject = isJoin ? `New member registered — ${circleName}` : `Circle registered — ${circleName}`;
  const text = isJoin
    ? `A new member has registered with ${circleName}.\n\n` +
      `Member wallet: ${memberAddress || "(fully anonymous — no wallet bound)"}\n` +
      `Circle account: ${circlePubkey}\n\n— Ayni (AHA on Solana)`
    : `${circleName} has been created on-chain and assigned this contact address (${to}).\n\n` +
      `Circle account: ${circlePubkey}\n\n— Ayni (AHA on Solana)`;

  try {
    const info = await transport.sendMail({ from, to, subject, text });
    return NextResponse.json({ ok: true, configured: true, to, id: info.messageId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, configured: true, to, error: String(e?.message || e) }, { status: 502 });
  }
}
