#!/usr/bin/env node
// F25 send-worker — fires the Circle emails for events that don't pass through
// the web UI. It polls the program for Circle + Membership accounts and, when a
// NEW one appears, POSTs to the frontend's /api/circle-email route (which holds
// the SMTP creds). This closes the gap where a membership issued by a script,
// another client, or directly on-chain would otherwise send no notification.
//
// Safety: on first run (no state file) it BASELINES — it records every existing
// account as already-seen WITHOUT emailing, so it never blasts the back-catalog.
// Only accounts that appear after the baseline trigger mail. State persists to
// STATE_FILE so restarts don't re-send.
//
// Env:
//   RPC_URL          Solana RPC (default devnet)
//   EMAIL_ENDPOINT   e.g. https://aha.a13z.org:8443/api/circle-email  (required)
//   POLL_SECONDS     poll interval (default 60)
//   STATE_FILE       seen-set path (default ./indexer-state.json)
//   IDL_PATH         path to ayni.json (default ../frontend/lib/ayni.json)
//   INSECURE_TLS     "1" to accept the self-signed/alt-port cert on EMAIL_ENDPOINT
//
// Run:  EMAIL_ENDPOINT=https://aha.a13z.org:8443/api/circle-email node indexer/email-indexer.js

const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const EMAIL_ENDPOINT = process.env.EMAIL_ENDPOINT;
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "indexer-state.json");
const IDL_PATH = process.env.IDL_PATH || path.join(__dirname, "..", "frontend", "lib", "ayni.json");

if (!EMAIL_ENDPOINT) {
  console.error("EMAIL_ENDPOINT is required (e.g. https://aha.a13z.org:8443/api/circle-email)");
  process.exit(1);
}
if (process.env.INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { circles: new Set(s.circles || []), members: new Set(s.members || []), baselined: !!s.baselined };
  } catch {
    return { circles: new Set(), members: new Set(), baselined: false };
  }
}
function saveState(st) {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ circles: [...st.circles], members: [...st.members], baselined: st.baselined }));
  fs.renameSync(tmp, STATE_FILE);
}

async function postEmail(body) {
  try {
    const res = await fetch(EMAIL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    log(`  → ${body.kind} ${body.circleName} : ${res.status} ${j.ok ? "ok" : j.error || ""}${j.to ? " → " + j.to : ""}`);
  } catch (e) {
    log("  → email POST failed:", String(e?.message || e));
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  // Read-only provider — a throwaway wallet; we never sign.
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const program = new anchor.Program(idl, provider);

  log("email-indexer up. RPC:", RPC_URL, "endpoint:", EMAIL_ENDPOINT, "poll:", POLL_SECONDS + "s");

  const st = loadState();

  async function tick() {
    const [circles, members] = await Promise.all([
      program.account.circle.all(),
      program.account.membership.all(),
    ]);
    const nameByCircle = new Map(circles.map((c) => [c.publicKey.toBase58(), c.account.name]));

    if (!st.baselined) {
      circles.forEach((c) => st.circles.add(c.publicKey.toBase58()));
      members.forEach((m) => st.members.add(m.publicKey.toBase58()));
      st.baselined = true;
      saveState(st);
      log(`baselined: ${st.circles.size} circles, ${st.members.size} memberships (no mail sent for existing records)`);
      return;
    }

    let sent = 0;
    for (const c of circles) {
      const key = c.publicKey.toBase58();
      if (st.circles.has(key)) continue;
      st.circles.add(key);
      await postEmail({ kind: "provision", circleName: c.account.name, circlePubkey: key });
      sent++;
    }
    for (const m of members) {
      const key = m.publicKey.toBase58();
      if (st.members.has(key)) continue;
      st.members.add(key);
      const circlePubkey = m.account.circle.toBase58();
      const owner = m.account.owner?.toBase58?.();
      await postEmail({
        kind: "join",
        circleName: nameByCircle.get(circlePubkey) || "a Circle",
        circlePubkey,
        memberAddress: owner && owner !== PublicKey.default.toBase58() ? owner : null,
      });
      sent++;
    }
    if (sent) saveState(st);
    log(`tick: ${circles.length} circles, ${members.length} memberships; ${sent} new notification(s)`);
  }

  // run forever
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      log("tick error:", String(e?.message || e));
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
