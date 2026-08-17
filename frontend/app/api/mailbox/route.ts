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
// F63 v2 adds METADATA MIXING on top (frontend/lib/mailboxMixing.ts,
// docs/messaging.md). The relay's half of it, all of it stateless:
//   * DELIVERY BUCKETS — an envelope is not readable the instant it lands; it
//     is released on the next boundary of a fixed grid (AHA_MAILBOX_DELIVERY_
//     BUCKET_SECS, default 60, 0 = off). The grid is a monotone ceiling, so
//     ordering is never inverted and `get` stays FIFO.
//   * PADDED REQUESTS — every request body arrives padded to a 2 KiB block, so
//     put/get/ack/bundle are the same size on the wire. `pad` is validated,
//     bounded and DISCARDED; nothing about it is stored.
//   * PADDED REPLIES — every reply is padded to a fixed size, and `get` to a
//     power-of-two size class, so an on-path observer cannot read a mailbox's
//     envelope count, nor tell an enrolled wallet from an unenrolled one, off
//     a response length.
//   * COVER TRAFFIC is a pure client matter BY DESIGN: a dummy is a genuine
//     sealed envelope with the marker inside the ciphertext, so this file has
//     no notion of a dummy and cannot acquire one. That is what makes it
//     indistinguishable here.
//
// What the relay still observes, honestly: which mailbox receives an envelope,
// when it lands, and the requester's IP. Cover traffic means "an envelope
// landed" no longer implies "somebody wrote a message", but an operator who
// correlates SOURCE IPs over time still learns which addresses talk to which
// mailboxes — that residual needs Tor/a mixnet and is out of scope (§5 of
// docs/messaging.md). It is at least on deletable, private infrastructure
// instead of a permanent public ledger, which is the point of F63.
//
// Storage: flat files under AHA_MAILBOX_DIR (default <cwd>/.mailbox — keep it
// out of git). TTL sweep is lazy, per touched mailbox.
//
// Env: AHA_MAILBOX_DIR, AHA_MAILBOX_TTL_SECS (default 30 days),
//      AHA_MAILBOX_MAX_PER_BOX (default 500),
//      AHA_MAILBOX_DELIVERY_BUCKET_SECS (default 60, 0 = release immediately).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import {
  MBX_CT_LEN,
  MLKEM_CT_LEN,
  MLKEM_PUB_LEN,
  PrekeyBundle,
  SealedEnvelope,
  ackSignedBytes,
  getSignedBytes,
  mailboxIdForWallet,
  mbxUnb64,
  verifyBundle,
} from "../../../lib/mailboxCrypto";
import {
  MBX_BUNDLE_RESP_BYTES,
  MBX_DELIVERY_BUCKET_SECS,
  MBX_GLOBAL_LIMIT,
  MBX_RATE_LIMIT,
  MBX_RATE_WINDOW_MS,
  MBX_REQ_MAX_PAD,
  mbxReleaseAt,
  mbxRespTarget,
  padJson,
} from "../../../lib/mailboxMixing";

export const runtime = "nodejs";

const DIR = process.env.AHA_MAILBOX_DIR || path.join(process.cwd(), ".mailbox");
const TTL_SECS = Number(process.env.AHA_MAILBOX_TTL_SECS || 30 * 24 * 3600);
const MAX_PER_BOX = Number(process.env.AHA_MAILBOX_MAX_PER_BOX || 500);
const BUCKET_SECS = Number(
  process.env.AHA_MAILBOX_DELIVERY_BUCKET_SECS ?? MBX_DELIVERY_BUCKET_SECS
);

/** Every reply is padded, so a reply's LENGTH says nothing: "no bundle" and "a
 *  bundle" are the same size, an error and an ok are the same size, and a `get`
 *  is padded to a power-of-two size class of rows. */
function reply(
  obj: Record<string, unknown>,
  status = 200,
  target = MBX_BUNDLE_RESP_BYTES,
  extra: Record<string, string> = {}
): NextResponse {
  return new NextResponse(padJson(obj, target), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

const RATE_429 = { "retry-after": "60" };

const MBX_ID = /^[0-9a-f]{32}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FILE_ID = /^[0-9a-f]{24}$/;

// Per-IP rate limit (same in-process pilot pattern as the other routes). The IP
// comes from X-Forwarded-For and is SPOOFABLE, so it is only the first gate; the
// GLOBAL limiter below is the unspoofable backstop that bounds directory-probe
// (enrollment-oracle) and put-flood abuse regardless of header rotation.
// The limits live in lib/mailboxMixing.ts so the cover-traffic budget and the
// limiter it must fit inside can never drift apart (tests/mailbox-mixing).
const RATE_LIMIT = MBX_RATE_LIMIT;
const RATE_WINDOW_MS = MBX_RATE_WINDOW_MS;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return recent.length > RATE_LIMIT;
}

// Global limiter across all callers — unspoofable (no per-IP key). Applied ONLY
// to `bundle` and `put` in POST (see there): it bounds enrollment-oracle probing
// and inbox flooding that X-Forwarded-For rotation would otherwise let an
// attacker scale freely, WITHOUT coupling read/delete availability to it.
const GLOBAL_LIMIT = MBX_GLOBAL_LIMIT;
let globalHits: number[] = [];
function globallyRateLimited(): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < RATE_WINDOW_MS);
  globalHits.push(now);
  return globalHits.length > GLOBAL_LIMIT;
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

/**
 * On-disk row. v2 wraps the envelope with its RELEASE TIME (the delivery
 * bucket); v1 files are bare envelopes and are read as "release immediately",
 * so an existing .mailbox directory keeps working across the upgrade.
 */
interface StoredRow {
  v: 2;
  releaseAt: number; // unix secs; 0 = immediately
  env: SealedEnvelope;
}

function readStored(raw: string): { releaseAt: number; env: SealedEnvelope } | null {
  try {
    const j = JSON.parse(raw);
    if (j && j.v === 2 && j.env && typeof j.env.ct === "string") {
      return { releaseAt: Number(j.releaseAt) || 0, env: j.env as SealedEnvelope };
    }
    if (j && typeof j.ct === "string") return { releaseAt: 0, env: j as SealedEnvelope }; // v1 file
    return null;
  } catch {
    return null;
  }
}

/** Request bodies are padded to a fixed block; `pad` is bounded and dropped. */
function badPad(body: any): boolean {
  if (body?.pad === undefined) return false; // mixing off / older client
  return typeof body.pad !== "string" || body.pad.length > MBX_REQ_MAX_PAD;
}

function badEnvelope(env: any): boolean {
  if (!env || (env.v !== 1 && env.v !== 2)) return true;
  if (typeof env.eph !== "string" || typeof env.nonce !== "string" || typeof env.ct !== "string") return true;
  if (!Number.isInteger(env.spkEpoch) || env.spkEpoch < 0) return true;
  if (typeof env.expiresAt !== "number") return true;
  try {
    if (mbxUnb64(env.eph).length !== 32) return true;
    if (mbxUnb64(env.nonce).length !== 24) return true;
    if (mbxUnb64(env.ct).length !== MBX_CT_LEN) return true;
    // F103 hybrid: a v2 envelope carries exactly one ML-KEM-768 ciphertext;
    // a v1 envelope must not carry one at all (no smuggled fields).
    if (env.v === 2) {
      if (typeof env.kct !== "string" || mbxUnb64(env.kct).length !== MLKEM_CT_LEN) return true;
    } else if (env.kct !== undefined) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export async function GET() {
  return reply({ ok: true, configured: true });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // Per-IP gate applies to EVERY op (spoofable, first line of defence).
  if (rateLimited(ip)) return reply({ error: "rate limited" }, 429, MBX_BUNDLE_RESP_BYTES, RATE_429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad json" }, 400);
  }
  // F63 v2: bodies arrive padded to a fixed block so op sizes are uniform on
  // the wire. Bound it (a padded body must not become free relay storage or an
  // amplification lever) and then forget it — `pad` is never read again.
  if (badPad(body)) return reply({ error: "bad pad" }, 400);

  const op = body?.op;
  // The unspoofable GLOBAL cap is scoped to the two abuse-prone ops it exists to
  // bound — `bundle` (enrollment-oracle probing) and `put` (inbox flooding).
  // It deliberately does NOT gate `get`/`ack`/`publish`: coupling all ops to one
  // bucket let a cheap bundle/put flood (~4 req/s, no header to rotate) return
  // 429 for message READS and DELETES for every member, service-wide (ultracode
  // MEDIUM, 2026-08-11d). Keeping reads/deletes on the per-IP gate means a
  // write-path flood can churn throughput but cannot take down delivery.
  if ((op === "bundle" || op === "put") && globallyRateLimited()) {
    return reply({ error: "rate limited" }, 429, MBX_BUNDLE_RESP_BYTES, RATE_429);
  }

  switch (op) {
    // --- prekey directory -------------------------------------------------
    case "publish": {
      const b = body.bundle as PrekeyBundle;
      if (!b || typeof b.wallet !== "string" || !BASE58.test(b.wallet)) {
        return reply({ error: "bad bundle" }, 400);
      }
      let walletPk: PublicKey;
      try {
        walletPk = new PublicKey(b.wallet);
      } catch {
        return reply({ error: "bad wallet" }, 400);
      }
      if (typeof b.ik !== "string" || b.ik.length > 64 || typeof b.spk !== "string" || b.spk.length > 64) {
        return reply({ error: "bad bundle" }, 400);
      }
      // F103 hybrid (v2): the ML-KEM-768 key is 1184 bytes → 1580 base64
      // chars; bound it before verifying so a garbage field cannot balloon
      // storage. verifyBundle enforces the exact decoded length and that the
      // wallet signature covers spk AND pqk together (no strip/swap).
      if (b.v === 2 && (typeof b.pqk !== "string" || b.pqk.length > Math.ceil(MLKEM_PUB_LEN / 3) * 4 + 4)) {
        return reply({ error: "bad bundle" }, 400);
      }
      if (!verifyBundle(b, walletPk.toBytes())) {
        return reply({ error: "bundle signature invalid" }, 400);
      }
      // Monotonic epochs: an attacker cannot roll a victim's directory entry
      // back to an old prekey (they cannot sign a higher epoch either).
      try {
        const prev = JSON.parse(await fs.readFile(bundlePath(b.wallet), "utf8"));
        if (Number(prev?.epoch) >= b.epoch) {
          return reply({ error: "epoch not newer" }, 409);
        }
      } catch {
        /* first publish */
      }
      await ensureDir(path.dirname(bundlePath(b.wallet)));
      const clean: PrekeyBundle =
        b.v === 2
          ? { v: 2, wallet: b.wallet, ik: b.ik, spk: b.spk, pqk: b.pqk, epoch: b.epoch, sig: b.sig }
          : { v: 1, wallet: b.wallet, ik: b.ik, spk: b.spk, epoch: b.epoch, sig: b.sig };
      await fs.writeFile(bundlePath(b.wallet), JSON.stringify(clean));
      return reply({ ok: true });
    }

    case "bundle": {
      // ACCEPTED, BOUNDED RESIDUAL (ultracode 2026-08-11c): a sender must fetch
      // the recipient's prekey bundle to seal to them, and the recipient is named
      // by wallet — so `bundle` is inherently an enrollment oracle (a non-null
      // reply proves that wallet has enrolled in F63). This is the same property
      // every prekey directory has (Signal's contact discovery included); the
      // mailbox id is a public derivation of the wallet, so keying the directory
      // by a hash does NOT blind it. It cannot be eliminated without private
      // contact discovery (PIR / OPRF), which is the F63 v2 item in
      // docs/messaging-migration.md. What we DO here: the global limiter above
      // bounds mass-probe throughput regardless of X-Forwarded-For rotation, so
      // enumeration is throttled rather than free.
      const wallet = body.wallet;
      if (typeof wallet !== "string" || !BASE58.test(wallet)) {
        return reply({ error: "bad wallet" }, 400);
      }
      try {
        const b = JSON.parse(await fs.readFile(bundlePath(wallet), "utf8"));
        return reply({ bundle: b });
      } catch {
        return reply({ bundle: null });
      }
    }

    // --- mail -------------------------------------------------------------
    case "put": {
      const to = body.to;
      if (typeof to !== "string" || !MBX_ID.test(to)) {
        return reply({ error: "bad mailbox" }, 400);
      }
      if (badEnvelope(body.envelope)) {
        return reply({ error: "bad envelope" }, 400);
      }
      const dir = boxDir(to);
      await ensureDir(dir);
      let existing = await sweep(dir);
      // FIFO eviction instead of hard-reject (ultracode 2026-08-11c): `put` is
      // unauthenticated (sealed sender — the server cannot tell a real sender
      // from a flood), and the mailbox id is derivable from a known wallet. If a
      // full box returned 507, an attacker could pin it full and BLOCK all honest
      // delivery. Evicting the oldest envelope(s) to make room means newest
      // legitimate mail always lands; a flood can churn old mail but cannot stop
      // inbound messaging. The global limiter above throttles the flood rate.
      if (existing.length >= MAX_PER_BOX) {
        const stamped = await Promise.all(
          existing.map(async (n) => {
            try {
              return { n, ts: (await fs.stat(path.join(dir, n))).mtimeMs };
            } catch {
              return { n, ts: Infinity }; // raced away — treat as newest, skip
            }
          })
        );
        stamped.sort((a, b) => a.ts - b.ts); // oldest first
        const evict = stamped.slice(0, existing.length - MAX_PER_BOX + 1);
        for (const { n } of evict) {
          try {
            await fs.unlink(path.join(dir, n));
          } catch {
            /* already gone */
          }
        }
      }
      const e = body.envelope as SealedEnvelope;
      // Field-allowlist re-serialization — but PRESERVE the version and, for a
      // hybrid (v2) envelope, the ML-KEM ciphertext. The first F103 build
      // hardcoded `v: 1` here and dropped `kct`, so the relay silently
      // destroyed every hybrid message it accepted (Sentinel CRITICAL,
      // NRR-2026-08-17-f103-hybrid-pq): badEnvelope validated the kct, this
      // line threw it away, and the recipient's openSealed() returned null —
      // indistinguishable from "sealed to a deleted prekey". badEnvelope has
      // already enforced v ∈ {1,2} and the exact kct length for v2.
      const clean: SealedEnvelope =
        e.v === 2
          ? { v: 2, eph: e.eph, nonce: e.nonce, kct: e.kct, spkEpoch: e.spkEpoch, ct: e.ct, expiresAt: e.expiresAt }
          : { v: 1, eph: e.eph, nonce: e.nonce, spkEpoch: e.spkEpoch, ct: e.ct, expiresAt: e.expiresAt };
      const id = crypto.randomBytes(12).toString("hex");
      // DELIVERY BUCKET (F63 v2 §1): the envelope is stored now but becomes
      // readable only at the next grid boundary, so the moment a `get` returns
      // it is not the moment it was written. `mbxReleaseAt` is a monotone
      // ceiling — earlier arrivals never release later than later ones — so the
      // FIFO order `get` sorts by is preserved exactly. BUCKET_SECS = 0 turns
      // the delay off and the relay behaves like v1.
      const row: StoredRow = { v: 2, releaseAt: mbxReleaseAt(Date.now() / 1000, BUCKET_SECS), env: clean };
      await fs.writeFile(path.join(dir, id + ".json"), JSON.stringify(row));
      return reply({ ok: true });
    }

    case "get": {
      const { to, wallet, sig, window } = body;
      if (typeof to !== "string" || !MBX_ID.test(to)) {
        return reply({ error: "bad mailbox" }, 400);
      }
      if (typeof wallet !== "string" || !BASE58.test(wallet)) return reply({ error: "bad wallet" }, 400);
      if (typeof sig !== "string" || !Number.isInteger(window)) return reply({ error: "bad request" }, 400);
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
        if (!ok) return reply({ error: "read refused" }, 403);
      }

      const dir = boxDir(to);
      const nowSecs = Date.now() / 1000;
      // Stat everything (cheap), order on the FULL-precision arrival time, then
      // read only as far as the page needs. Ordering before the cap means the
      // 100 returned are the 100 oldest RELEASED envelopes, and two that landed
      // in the same second still come back in the order they arrived (v1 sorted
      // on the whole-second `ts` alone, leaving same-second order to readdir).
      // Constant-rate polling makes `get` the hot path, so this reads ~100 files
      // instead of the whole box.
      const stamped: { n: string; ms: number }[] = [];
      for (const n of await sweep(dir)) {
        try {
          stamped.push({ n, ms: (await fs.stat(path.join(dir, n))).mtimeMs });
        } catch {
          /* raced away */
        }
      }
      stamped.sort((a, b) => a.ms - b.ms);
      const page: { id: string; ts: number; envelope: SealedEnvelope }[] = [];
      for (const { n, ms } of stamped) {
        if (page.length >= 100) break;
        try {
          const row = readStored(await fs.readFile(path.join(dir, n), "utf8"));
          if (!row) continue;
          if (row.releaseAt > nowSecs) continue; // still in its delivery bucket
          page.push({ id: n.replace(/\.json$/, ""), ts: Math.floor(ms / 1000), envelope: row.env });
        } catch {
          /* raced away */
        }
      }
      // Reply padded to a power-of-two size class of rows: an on-path observer
      // reads only log2(count) off the length, not the count. (The relay itself
      // obviously knows it — this closes the wire leak, not the operator's.)
      return reply({ messages: page }, 200, mbxRespTarget(page.length));
    }

    case "ack": {
      const { to, wallet, ids, sig } = body;
      if (typeof to !== "string" || !MBX_ID.test(to)) return reply({ error: "bad mailbox" }, 400);
      if (typeof wallet !== "string" || !BASE58.test(wallet)) return reply({ error: "bad wallet" }, 400);
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((i: any) => typeof i === "string" && FILE_ID.test(i))) {
        return reply({ error: "bad ids" }, 400);
      }
      if (typeof sig !== "string") return reply({ error: "bad sig" }, 400);
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
      if (!ok) return reply({ error: "ack refused" }, 403);
      for (const id of ids) {
        try {
          await fs.unlink(path.join(boxDir(to), id + ".json"));
        } catch {
          /* already gone */
        }
      }
      return reply({ ok: true });
    }

    default:
      return reply({ error: "unknown op" }, 400);
  }
}
