// F63 (v1) — the mailbox relay: where a sealed envelope waits between send and
// fetch, so that NOTHING about a private message ever touches the public
// ledger (docs/messaging-migration.md §3's chosen delivery option).
//
// Built to know as little as possible:
//   * envelopes carry NO sender field (sealed sender — the author is named and
//     signed only inside the ciphertext);
//   * storage is keyed by an opaque mailbox id (16-byte hash of the recipient
//     IK), and there is NO enumeration op — no list-all, no counts, no
//     iteration; only exact-id lookups (the same rule the shard-custody layer
//     enforces);
//   * deletion (ack) requires the recipient wallet's signature;
//   * this file contains no logging call of any kind, and the privacy sweep
//     greps for that.
//
// What the relay still observes, honestly: which mailbox receives mail, when,
// and the fetcher's IP + timing. That is recipient-side traffic analysis AT
// THE RELAY — deletable, private infrastructure — instead of on a permanent
// public ledger, which is the entire point of F63. Mixing/batching is the
// documented next step.
//
// Storage: flat files under AHA_MAILBOX_DIR (default <cwd>/.mailbox — keep it
// out of git). TTL sweep is lazy, per touched mailbox.
//
// Env: AHA_MAILBOX_DIR, AHA_MAILBOX_TTL_SECS (default 30 days),
//      AHA_MAILBOX_MAX_PER_BOX (default 500).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import {
  MBX_CT_LEN,
  PrekeyBundle,
  SealedEnvelope,
  ackSignedBytes,
  getSignedBytes,
  mailboxIdForWallet,
  mbxUnb64,
  verifyBundle,
} from "../../../lib/mailboxCrypto";

export const runtime = "nodejs";

const DIR = process.env.AHA_MAILBOX_DIR || path.join(process.cwd(), ".mailbox");
const TTL_SECS = Number(process.env.AHA_MAILBOX_TTL_SECS || 30 * 24 * 3600);
const MAX_PER_BOX = Number(process.env.AHA_MAILBOX_MAX_PER_BOX || 500);

const MBX_ID = /^[0-9a-f]{32}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FILE_ID = /^[0-9a-f]{24}$/;

// Per-IP rate limit (same in-process pilot pattern as the other routes).
const RATE_LIMIT = 30;
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

const boxDir = (id: string) => path.join(DIR, "boxes", id);
const bundlePath = (wallet: string) => path.join(DIR, "directory", wallet + ".json");

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

/** Lazy TTL sweep for one mailbox. */
async function sweep(dir: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const keep: string[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const p = path.join(dir, n);
    try {
      const st = await fs.stat(p);
      if (now - st.mtimeMs > TTL_SECS * 1000) await fs.unlink(p);
      else keep.push(n);
    } catch {
      /* raced away */
    }
  }
  return keep;
}

function badEnvelope(env: any): boolean {
  if (!env || env.v !== 1) return true;
  if (typeof env.eph !== "string" || typeof env.nonce !== "string" || typeof env.ct !== "string") return true;
  if (!Number.isInteger(env.spkEpoch) || env.spkEpoch < 0) return true;
  if (typeof env.expiresAt !== "number") return true;
  try {
    if (mbxUnb64(env.eph).length !== 32) return true;
    if (mbxUnb64(env.nonce).length !== 24) return true;
    if (mbxUnb64(env.ct).length !== MBX_CT_LEN) return true;
  } catch {
    return true;
  }
  return false;
}

export async function GET() {
  return NextResponse.json({ ok: true, configured: true });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  switch (body?.op) {
    // --- prekey directory -------------------------------------------------
    case "publish": {
      const b = body.bundle as PrekeyBundle;
      if (!b || typeof b.wallet !== "string" || !BASE58.test(b.wallet)) {
        return NextResponse.json({ error: "bad bundle" }, { status: 400 });
      }
      let walletPk: PublicKey;
      try {
        walletPk = new PublicKey(b.wallet);
      } catch {
        return NextResponse.json({ error: "bad wallet" }, { status: 400 });
      }
      if (typeof b.ik !== "string" || b.ik.length > 64 || typeof b.spk !== "string" || b.spk.length > 64) {
        return NextResponse.json({ error: "bad bundle" }, { status: 400 });
      }
      if (!verifyBundle(b, walletPk.toBytes())) {
        return NextResponse.json({ error: "bundle signature invalid" }, { status: 400 });
      }
      // Monotonic epochs: an attacker cannot roll a victim's directory entry
      // back to an old prekey (they cannot sign a higher epoch either).
      try {
        const prev = JSON.parse(await fs.readFile(bundlePath(b.wallet), "utf8"));
        if (Number(prev?.epoch) >= b.epoch) {
          return NextResponse.json({ error: "epoch not newer" }, { status: 409 });
        }
      } catch {
        /* first publish */
      }
      await ensureDir(path.dirname(bundlePath(b.wallet)));
      const clean: PrekeyBundle = { v: 1, wallet: b.wallet, ik: b.ik, spk: b.spk, epoch: b.epoch, sig: b.sig };
      await fs.writeFile(bundlePath(b.wallet), JSON.stringify(clean));
      return NextResponse.json({ ok: true });
    }

    case "bundle": {
      const wallet = body.wallet;
      if (typeof wallet !== "string" || !BASE58.test(wallet)) {
        return NextResponse.json({ error: "bad wallet" }, { status: 400 });
      }
      try {
        const b = JSON.parse(await fs.readFile(bundlePath(wallet), "utf8"));
        return NextResponse.json({ bundle: b });
      } catch {
        return NextResponse.json({ bundle: null });
      }
    }

    // --- mail -------------------------------------------------------------
    case "put": {
      const to = body.to;
      if (typeof to !== "string" || !MBX_ID.test(to)) {
        return NextResponse.json({ error: "bad mailbox" }, { status: 400 });
      }
      if (badEnvelope(body.envelope)) {
        return NextResponse.json({ error: "bad envelope" }, { status: 400 });
      }
      const dir = boxDir(to);
      await ensureDir(dir);
      const existing = await sweep(dir);
      if (existing.length >= MAX_PER_BOX) {
        return NextResponse.json({ error: "mailbox full" }, { status: 507 });
      }
      const e = body.envelope as SealedEnvelope;
      const clean: SealedEnvelope = { v: 1, eph: e.eph, nonce: e.nonce, spkEpoch: e.spkEpoch, ct: e.ct, expiresAt: e.expiresAt };
      const id = crypto.randomBytes(12).toString("hex");
      await fs.writeFile(path.join(dir, id + ".json"), JSON.stringify(clean));
      return NextResponse.json({ ok: true });
    }

    case "get": {
      const { to, wallet, sig, window } = body;
      if (typeof to !== "string" || !MBX_ID.test(to)) {
        return NextResponse.json({ error: "bad mailbox" }, { status: 400 });
      }
      if (typeof wallet !== "string" || !BASE58.test(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
      if (typeof sig !== "string" || !Number.isInteger(window)) return NextResponse.json({ error: "bad request" }, { status: 400 });
      // READ REQUIRES THE RECIPIENT'S SIGNATURE. The mailbox id is derived from
      // the WALLET (not the bundle IK — that was attacker-suppliable), so
      // ownership is exactly: this wallet's key signs getSignedBytes(to,
      // window), and mailboxIdForWallet(wallet) == to. Window is the current
      // or previous 10-minute bucket (bounded replay, no server nonce). Without
      // this, anyone who knew the address could enumerate a member's envelope
      // count and timing — the metadata F63 exists to hide.
      {
        const nowWin = Math.floor(Date.now() / 1000 / 600);
        let ok = false;
        try {
          const pk = new PublicKey(wallet).toBytes();
          if (mailboxIdForWallet(pk) === to && (window === nowWin || window === nowWin - 1)) {
            ok = nacl.sign.detached.verify(getSignedBytes(to, window), mbxUnb64(sig), pk);
          }
        } catch {
          ok = false;
        }
        if (!ok) return NextResponse.json({ error: "read refused" }, { status: 403 });
      }

      const dir = boxDir(to);
      const names = (await sweep(dir)).slice(0, 100);
      const out: { id: string; ts: number; envelope: SealedEnvelope }[] = [];
      for (const n of names) {
        try {
          const p = path.join(dir, n);
          const st = await fs.stat(p);
          out.push({ id: n.replace(/\.json$/, ""), ts: Math.floor(st.mtimeMs / 1000), envelope: JSON.parse(await fs.readFile(p, "utf8")) });
        } catch {
          /* raced away */
        }
      }
      out.sort((a, b) => a.ts - b.ts);
      return NextResponse.json({ messages: out });
    }

    case "ack": {
      const { to, wallet, ids, sig } = body;
      if (typeof to !== "string" || !MBX_ID.test(to)) return NextResponse.json({ error: "bad mailbox" }, { status: 400 });
      if (typeof wallet !== "string" || !BASE58.test(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((i: any) => typeof i === "string" && FILE_ID.test(i))) {
        return NextResponse.json({ error: "bad ids" }, { status: 400 });
      }
      if (typeof sig !== "string") return NextResponse.json({ error: "bad sig" }, { status: 400 });
      // The wallet must own this mailbox: mailboxIdForWallet(wallet) == to, and
      // the ack carries that wallet's Ed25519 signature over the id set. Same
      // wallet-derived ownership as `get` — no attacker-suppliable IK in the
      // middle.
      let ok = false;
      try {
        const pk = new PublicKey(wallet).toBytes();
        ok =
          mailboxIdForWallet(pk) === to &&
          nacl.sign.detached.verify(ackSignedBytes(to, ids), mbxUnb64(sig), pk);
      } catch {
        ok = false;
      }
      if (!ok) return NextResponse.json({ error: "ack refused" }, { status: 403 });
      for (const id of ids) {
        try {
          await fs.unlink(path.join(boxDir(to), id + ".json"));
        } catch {
          /* already gone */
        }
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}
