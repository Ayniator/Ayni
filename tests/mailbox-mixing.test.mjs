// F63 v2 — MAILBOX METADATA MIXING: plain-node property tests.
// Run: node tests/mailbox-mixing.test.mjs   (no framework, exits non-zero on failure)
//
// The modules under test (frontend/lib/mailboxMixing.ts and its dependency
// frontend/lib/mailboxCrypto.ts) are deliberately pure — no DOM, no network, no
// chain — so the relay route, the client transport and this file all exercise
// the SAME code. Anything asserted here IS the contract.
//
// The load-bearing claims proved below:
//   1. a dummy is byte-shaped exactly like real mail AT THE RELAY;
//   2. a dummy NEVER reaches the inbox — partitionCover is the single gate, and
//      frontend/lib/mailbox.ts really routes the fetch through it;
//   3. the delivery-bucket delay can never reorder mail (FIFO preserved);
//   4. cover traffic fits inside the relay's existing rate limits with room to
//      spare for the member's own real traffic;
//   5. mixing degrades to exact v1 behaviour when disabled.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const libDir = path.join(repoRoot, "frontend", "lib");
const frontendRequire = createRequire(path.join(repoRoot, "frontend", "package.json"));
const rootRequire = createRequire(path.join(repoRoot, "package.json"));
const requireDep = (id) => {
  try { return frontendRequire(id); } catch { return rootRequire(id); }
};
const ts = frontendRequire("typescript");

// --- load the pure TS modules as CJS, resolving their relative imports ------
const tsCache = new Map();

/** Minimal `next/server` so the relay route itself can be exercised in plain
 *  node (Next needs node >= 20; the repo's test runtime is 18). */
class NextResponse {
  constructor(body, init = {}) {
    this.body = String(body);
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
  }
  async json() { return JSON.parse(this.body); }
  static json(obj, init = {}) { return new NextResponse(JSON.stringify(obj), init); }
}
const nextServerStub = { NextResponse, NextRequest: class {} };

function loadTsFile(file, key) {
  if (tsCache.has(key)) return tsCache.get(key);
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  tsCache.set(key, mod.exports);
  const req = (id) => {
    if (id === "next/server") return nextServerStub;
    const rel = id.match(/(?:\.\.\/)*(?:\.\/)?(?:lib\/)?([A-Za-z0-9_]+)$/);
    if (id.startsWith(".") && rel) return loadTs(rel[1]);
    return requireDep(id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  tsCache.set(key, mod.exports);
  return mod.exports;
}
const loadTs = (name) => loadTsFile(path.join(libDir, name + ".ts"), name);

const nacl = requireDep("tweetnacl");
const C = loadTs("mailboxCrypto");
const M = loadTs("mailboxMixing");

// --- tiny harness ----------------------------------------------------------
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

// --- fixtures: a recipient with a published prekey -------------------------
const wallet = nacl.sign.keyPair();
const spk = nacl.box.keyPair();
const ik = nacl.box.keyPair();
const EPOCH = 7;
const bundle = {
  v: 1,
  wallet: "TESTWALLETBASE58PLACEHOLDERxxxxxxxxxxxxxxxx",
  ik: C.mbxB64(ik.publicKey),
  spk: C.mbxB64(spk.publicKey),
  epoch: EPOCH,
  sig: C.mbxB64(nacl.sign.detached(C.spkSignedBytes(spk.publicKey, EPOCH), wallet.secretKey)),
};
const sender = nacl.sign.keyPair();
const realEnvelope = (body, expiresAt = 0) => {
  const tsSec = 1_700_000_000;
  const inner = {
    v: 3,
    from: "SENDERWALLETBASE58PLACEHOLDERxxxxxxxxxxxxxx",
    ts: tsSec,
    body,
    sig: C.mbxB64(nacl.sign.detached(C.innerSignedBytes(ik.publicKey, tsSec, body), sender.secretKey)),
  };
  return C.sealToBundle(bundle, inner, expiresAt);
};

// ===========================================================================
// 1. Cover traffic is indistinguishable AT THE RELAY
// ===========================================================================

await test("a dummy is byte-shaped exactly like real mail: same fields, same lengths", () => {
  const real = realEnvelope("a genuine message from one member to another");
  const cover = M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1_700_000_000);

  assert(
    JSON.stringify(Object.keys(real).sort()) === JSON.stringify(Object.keys(cover).sort()),
    "field sets differ — the relay could tell a dummy from real mail by shape"
  );
  eq(cover.v, real.v, "envelope version differs");
  eq(C.mbxUnb64(cover.ct).length, C.MBX_CT_LEN, "dummy ciphertext is not the fixed length");
  eq(C.mbxUnb64(cover.ct).length, C.mbxUnb64(real.ct).length, "ciphertext lengths differ");
  eq(C.mbxUnb64(cover.eph).length, 32, "ephemeral key length differs");
  eq(C.mbxUnb64(cover.nonce).length, 24, "nonce length differs");
  eq(cover.spkEpoch, real.spkEpoch, "epoch differs — dummies must sit in the live epoch");
  // `expiresAt` is the one envelope field with real variety that the relay can
  // read, so a dummy must draw from exactly the menu the compose form offers —
  // otherwise "expiry set" would mean "definitely a real message".
  const now = 1_700_000_000;
  const allowed = new Set(M.MBX_EXPIRY_DAYS.map((d) => (d === 0 ? 0 : now + d * 86400)));
  const drawn = new Set();
  for (let i = 0; i < 400; i++) drawn.add(M.buildCoverEnvelope(bundle.spk, bundle.epoch, now).expiresAt);
  for (const v of drawn) assert(allowed.has(v), `a dummy produced an expiry (${v}) no real send can produce`);
  eq(drawn.size, allowed.size, "dummies do not span every expiry a real send can produce");
  eq(M.coverExpiresAt(now, 0), 0, "the modal dummy expiry is not Never");
  assert(M.coverExpiresAt(now, 0.999999) === now + 30 * 86400, "the longest dummy expiry is not the form's longest");
  // Two dummies are not each other: fresh ephemeral key and nonce every time,
  // so the relay cannot fingerprint cover by repetition.
  const cover2 = M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1_700_000_001);
  assert(cover.ct !== cover2.ct && cover.eph !== cover2.eph && cover.nonce !== cover2.nonce, "dummies repeat themselves");
});

await test("every real body length yields one ciphertext size, dummy included", () => {
  const sizes = new Set(
    ["", "x", "medium length note", "y".repeat(700)].map((b) => C.mbxUnb64(realEnvelope(b).ct).length)
  );
  sizes.add(C.mbxUnb64(M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1).ct).length);
  eq(sizes.size, 1, "message length leaks through the ciphertext size");
});

await test("the relay has no notion of cover: route.ts cannot recognise a dummy", () => {
  const route = read("frontend/app/api/mailbox/route.ts");
  for (const forbidden of ["partitionCover", "isCoverInner", "MBX_COVER_MARKER", "makeCoverInner", "buildCoverEnvelope"]) {
    assert(!route.includes(forbidden), `route.ts references ${forbidden} — the relay must not be able to identify cover`);
  }
  // …and it never stores or echoes the padding it receives.
  assert(!/pad\s*:\s*body\.pad/.test(route), "route.ts persists or echoes the request pad");
});

// ===========================================================================
// 2. A dummy NEVER reaches the inbox
// ===========================================================================

await test("dummy: recipient decrypts it, recognises it, drops it, and it never surfaces", () => {
  const secrets = [spk.secretKey];
  const rows = [
    { id: "aa".repeat(12), envelope: realEnvelope("real one") },
    { id: "bb".repeat(12), envelope: M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1_700_000_000) },
    { id: "cc".repeat(12), envelope: realEnvelope("real two") },
  ];
  // Exactly what fetchMailboxMessages does: decrypt, then partition.
  const opened = rows.map((r) => ({ id: r.id, inner: C.openSealed(r.envelope, secrets) }));

  // The dummy DID decrypt (it is a genuine sealed envelope, not garbage)…
  assert(opened[1].inner !== null, "the dummy did not decrypt — then it would be litter, not cover");
  assert(M.isCoverInner(opened[1].inner), "the dummy was not recognised as cover");
  assert(!M.isCoverInner(opened[0].inner) && !M.isCoverInner(opened[2].inner), "real mail was misread as cover");

  // …and is still dropped before the inbox.
  const { mail, coverIds } = M.partitionCover(opened);
  eq(mail.length, 2, "wrong number of deliverable messages");
  assert(!mail.some((m) => m.id === "bb".repeat(12)), "THE DUMMY REACHED THE INBOX");
  assert(mail.every((m) => !M.isCoverInner(m.inner)), "cover survived the partition");
  eq(coverIds.length, 1, "the dummy id was not queued for the sweep");
  eq(coverIds[0], "bb".repeat(12), "the wrong id was queued for the sweep");
  eq(mail[0].inner.body, "real one", "real mail was corrupted by the partition");
  eq(mail[1].inner.body, "real two", "real mail was corrupted by the partition");
});

await test("a dummy carries no identity, no body and no signature even to its recipient", () => {
  const inner = C.openSealed(M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1_700_000_000), [spk.secretKey]);
  eq(inner.from, "", "a dummy names a sender");
  eq(inner.body, "", "a dummy carries a body");
  eq(inner.sig, "", "a dummy carries a signature");
  eq(inner.cover, M.MBX_COVER_MARKER, "the marker is missing");
  // It must never be mistaken for authentic mail if it ever escaped the filter.
  assert(!C.verifyInner(inner, ik.publicKey, sender.publicKey), "a dummy verified as authored mail");
});

await test("a dummy is opaque to everyone but the mailbox it addresses", () => {
  const cover = M.buildCoverEnvelope(bundle.spk, bundle.epoch, 1);
  assert(C.openSealed(cover, [nacl.box.keyPair().secretKey]) === null, "a stranger opened a dummy");
  assert(C.openSealed(cover, [ik.secretKey]) === null, "the identity key opened a dummy");
});

await test("the inbox path really goes through partitionCover (no second, unfiltered route)", () => {
  const src = read("frontend/lib/mailbox.ts");
  assert(src.includes("partitionCover("), "fetchMailboxMessages does not call partitionCover");
  const fetchFn = src.slice(src.indexOf("export async function fetchMailboxMessages"));
  const body = fetchFn.slice(0, fetchFn.indexOf("\n}\n"));
  assert(body.includes("partitionCover("), "the fetch path bypasses partitionCover");
  // Every push into the returned array must come from the partitioned `mail`.
  assert(/for \(const \{ row: r, inner \} of mail\)/.test(body), "the delivery loop does not iterate the partitioned mail");
  assert(!/for \(const r of rows\)/.test(body), "an unpartitioned loop over raw relay rows still exists");
});

// ===========================================================================
// 3. Timing decorrelation — delay without reordering
// ===========================================================================

await test("delivery buckets never reorder mail (FIFO preserved) and always delay", () => {
  const B = 60;
  let prev = -1;
  for (let t = 1_700_000_000; t < 1_700_000_600; t += 7) {
    const rel = M.mbxReleaseAt(t, B);
    assert(rel >= prev, "an earlier arrival released AFTER a later one — FIFO broken");
    assert(rel > t, "an envelope was released at or before it arrived — no delay applied");
    assert(rel - t <= B, "the delay exceeded one bucket");
    eq(rel % B, 0, "release time is off the bucket grid");
    prev = rel;
  }
});

await test("delivery buckets: 0 / negative / NaN disable the delay (relay behaves like v1)", () => {
  for (const b of [0, -1, NaN, undefined]) eq(M.mbxReleaseAt(1_700_000_000, b), 0, `bucket ${b} did not disable the delay`);
});

await test("send jitter is bounded, non-negative, and zero when mixing is off", () => {
  const cfg = M.MIX_DEFAULTS;
  for (let i = 0; i < 200; i++) {
    const j = M.sendJitterMs(cfg);
    assert(j >= 0 && j <= cfg.maxSendJitterMs, `jitter ${j} out of bounds`);
  }
  eq(M.sendJitterMs(cfg, 0), 0, "jitter floor is not 0");
  eq(M.sendJitterMs(cfg, 0.999999), cfg.maxSendJitterMs, "jitter ceiling is not maxSendJitterMs");
  eq(M.sendJitterMs({ ...cfg, enabled: false }), 0, "jitter applied while mixing is disabled");
  eq(M.sendJitterMs({ ...cfg, maxSendJitterMs: 0 }), 0, "jitter applied with a 0 budget");
});

// ===========================================================================
// 4. Size padding
// ===========================================================================

await test("every op leaves the device at the same padded size", () => {
  const env = realEnvelope("hello");
  const bodies = {
    put: M.padRequestBody({ op: "put", to: "ab".repeat(16), envelope: env }),
    get: M.padRequestBody({ op: "get", to: "ab".repeat(16), wallet: "W".repeat(44), sig: "S".repeat(88), window: 2833333 }),
    bundle: M.padRequestBody({ op: "bundle", wallet: "W".repeat(44) }),
    publish: M.padRequestBody({ op: "publish", bundle }),
  };
  const sizes = new Set(Object.values(bodies).map((b) => b.length));
  eq(sizes.size, 1, "op sizes differ on the wire: " + JSON.stringify(Object.entries(bodies).map(([k, v]) => [k, v.length])));
  eq([...sizes][0], M.MBX_REQ_BLOCK, "padded body is not one block");
  for (const [op, b] of Object.entries(bodies)) {
    const parsed = JSON.parse(b);
    eq(parsed.op, op, "padding corrupted the payload");
    assert(parsed.pad.length <= M.MBX_REQ_MAX_PAD, "pad exceeds the relay's bound");
  }
  // A big ack still lands on a block boundary and inside the relay's pad bound.
  const bigAck = M.padRequestBody({ op: "ack", to: "ab".repeat(16), ids: Array.from({ length: 100 }, (_, i) => String(i).padStart(24, "0")), sig: "S".repeat(88) });
  eq(bigAck.length % M.MBX_REQ_BLOCK, 0, "a large ack is not block-aligned");
  assert(JSON.parse(bigAck).pad.length <= M.MBX_REQ_MAX_PAD, "a large ack exceeds the relay's pad bound");
});

await test("replies leak neither enrolment nor envelope count by length", () => {
  const present = M.padJson({ bundle }, M.MBX_BUNDLE_RESP_BYTES);
  const absent = M.padJson({ bundle: null }, M.MBX_BUNDLE_RESP_BYTES);
  eq(present.length, absent.length, "an enrolled wallet is distinguishable from an unenrolled one by reply length");
  eq(present.length, M.MBX_BUNDLE_RESP_BYTES, "bundle reply is not the fixed size");
  eq(JSON.parse(present).bundle.spk, bundle.spk, "padding corrupted the bundle reply");
  assert(JSON.parse(absent).bundle === null, "padding corrupted the empty reply");

  // `get` replies collapse to power-of-two size classes: 3, 4 and even 1..4
  // envelopes are one length, so an observer reads log2(count) at best.
  const row = (i) => ({ id: String(i).padStart(24, "0"), ts: 1_700_000_000 + i, envelope: realEnvelope("m" + i) });
  const lens = [1, 2, 3, 4].map((n) => {
    const msgs = Array.from({ length: n }, (_, i) => row(i));
    return M.padJson({ messages: msgs }, M.mbxRespTarget(n)).length;
  });
  eq(new Set([lens[2], lens[3]]).size, 1, "3 and 4 envelopes are distinguishable by reply length");
  assert(lens[0] < lens[3], "size classes do not grow with the box");
  // Padding must never truncate: the target always exceeds the real content.
  for (const n of [0, 1, 5, 17, 100]) {
    const msgs = Array.from({ length: n }, (_, i) => row(i));
    const out = M.padJson({ messages: msgs }, M.mbxRespTarget(n));
    eq(JSON.parse(out).messages.length, n, "padding lost messages");
    assert(out.length >= JSON.stringify({ messages: msgs }).length, "padded reply is shorter than its content");
  }
});

// ===========================================================================
// 5. Constant-rate scheduler
// ===========================================================================

const runSession = (cfg, opts = {}) => {
  const t0 = 1_000_000;
  const s = M.newMixState(t0, opts.phase ?? 0);
  let polls = 0, covers = 0, slots = 0, now = t0, stopped = false;
  const until = opts.durationMs ?? cfg.maxSessionMs;
  while (now - t0 < until) {
    const plan = M.planTick(s, cfg, now);
    if (plan.stop) { stopped = true; break; }
    M.applyTick(s, plan, now);
    if (plan.poll) polls++;
    if (plan.coverSlotDue) slots++;
    if (plan.cover) covers++;
    if (opts.onTick) opts.onTick(s, now, plan);
    now += plan.nextDelayMs;
  }
  return { s, polls, covers, slots, stopped, now };
};

await test("polling is constant-rate: the same number of gets whether or not mail exists", () => {
  const cfg = { ...M.MIX_DEFAULTS, maxOutstandingCover: 10_000 };
  const a = runSession(cfg, { durationMs: 30 * 60_000 });
  const b = runSession(cfg, { durationMs: 30 * 60_000 });
  eq(a.polls, b.polls, "poll count varied between identical sessions");
  const expected = Math.floor((30 * 60_000) / cfg.pollPeriodMs);
  assert(Math.abs(a.polls - expected) <= 1, `polled ${a.polls} times in 30 min, expected ~${expected}`);
  // Nothing in the plan depends on mailbox contents — planTick takes only
  // (state, config, clock), so "you have mail" cannot change the schedule.
  assert(M.planTick.length === 3, "planTick took an input other than (state, config, now)");
});

await test("a real send claims the next dummy, so the put RATE does not rise when writing", () => {
  const cfg = { ...M.MIX_DEFAULTS, maxOutstandingCover: 10_000 };
  const quiet = runSession(cfg, { durationMs: 60 * 60_000 });
  const busy = runSession(cfg, {
    durationMs: 60 * 60_000,
    onTick: (s, now) => { if (Math.floor(now / cfg.coverPeriodMs) % 2 === 0) M.noteRealPut(s); },
  });
  assert(busy.covers < quiet.covers, "real sends did not suppress any dummies");
  // Total puts (real + cover) stay within one slot of the quiet-session rate.
  const realPuts = busy.slots - busy.covers;
  assert(Math.abs(busy.covers + realPuts - quiet.covers) <= 1, "put rate changed when the member started writing");
});

await test("cover is capped so dummies can never FIFO-evict real mail from an uncleared box", () => {
  const cfg = M.MIX_DEFAULTS;
  const { s, covers } = runSession(cfg, { durationMs: 8 * 60 * 60_000 });
  eq(covers, cfg.maxOutstandingCover, "cover ignored the outstanding cap");
  eq(s.outstandingCover, cfg.maxOutstandingCover, "outstanding counter drifted from the cap");
  assert(cfg.maxOutstandingCover < 500, "the cap is not below the relay's MAX_PER_BOX");
  // Acking dummies frees the budget again.
  const s2 = M.newMixState(0, 0);
  s2.outstandingCover = cfg.maxOutstandingCover;
  assert(!M.planTick(s2, cfg, cfg.coverPeriodMs + 1).coverSlotDue, "cover ran on with the budget exhausted");
  M.noteCoverAcked(s2, cfg.maxOutstandingCover);
  eq(s2.outstandingCover, 0, "acking cover did not free the budget");
  assert(M.planTick(s2, cfg, cfg.coverPeriodMs + 1).coverSlotDue, "cover did not resume after the sweep");
  M.noteCoverAcked(s2, 99);
  eq(s2.outstandingCover, 0, "the outstanding counter went negative");
});

await test("the session stops itself, so a forgotten tab is not an open-ended data plan", () => {
  const cfg = { ...M.MIX_DEFAULTS, maxOutstandingCover: 10_000 };
  const r = runSession(cfg, { durationMs: cfg.maxSessionMs * 4 });
  assert(r.stopped, "the mixing session never stopped");
  assert(r.now - 1_000_000 <= cfg.maxSessionMs + cfg.pollPeriodMs, "the session ran well past its cap");
});

await test("a 429 backs cover off instead of competing with the member's real traffic", () => {
  const cfg = { ...M.MIX_DEFAULTS, maxOutstandingCover: 10_000 };
  const s = M.newMixState(0, 0);
  const base = M.planTick(s, cfg, 0).nextDelayMs;
  for (let i = 0; i < 10; i++) M.noteRateLimited(s);
  eq(s.backoff, M.MIX_MAX_BACKOFF, "backoff is not clamped");
  assert(M.planTick(s, cfg, 0).nextDelayMs > base, "backoff did not slow the schedule");
  assert(!M.planTick(s, cfg, cfg.pollPeriodMs + 1).poll, "backed-off client polled at the base rate");
  for (let i = 0; i < 10; i++) M.noteOk(s);
  eq(s.backoff, 1, "backoff never recovered");
});

// ===========================================================================
// 6. Cover traffic fits inside the relay's existing rate limits
// ===========================================================================

await test("cover traffic cannot trip the relay's rate limits", () => {
  const b = M.mixBudget();
  // Per-IP gate (30/min, ALL ops): mixing must leave at least half the budget
  // for the member's own sends, reads and deletes.
  assert(b.perClientPerMin <= M.MBX_RATE_LIMIT / 2, `mixing uses ${b.perClientPerMin} req/min of a ${M.MBX_RATE_LIMIT}/min per-IP budget`);
  assert(b.clientsPerIp >= 8, `only ${b.clientsPerIp} mixing clients fit behind one NAT address`);
  // Global gate (240/min, scoped to bundle+put): only COVER PUTS reach it —
  // constant-rate polling is a `get` and is deliberately not globally capped.
  assert(b.coverPutsPerMin <= 1, "a client emits more than one dummy per minute");
  assert(b.clientsGlobal >= 300, `only ${b.clientsGlobal} concurrently-mixing clients fit under the global cap`);
  // The limits the budget is computed against must be the ones the relay runs.
  const route = read("frontend/app/api/mailbox/route.ts");
  assert(/const RATE_LIMIT = MBX_RATE_LIMIT;/.test(route), "route.ts no longer uses the shared per-IP limit");
  assert(/const GLOBAL_LIMIT = MBX_GLOBAL_LIMIT;/.test(route), "route.ts no longer uses the shared global limit");
  eq(M.MBX_RATE_WINDOW_MS, 60_000, "the rate window changed — the budget above assumes per-minute");
});

// ===========================================================================
// 7. Degradation and hygiene
// ===========================================================================

await test("mixing disabled ⇒ exact v1 behaviour, messaging still works", () => {
  const off = { ...M.MIX_DEFAULTS, enabled: false, maxSendJitterMs: 0 };
  eq(M.sendJitterMs(off), 0, "a disabled client still jittered");
  assert(M.planTick(M.newMixState(0, 0), off, 0).stop, "a disabled client still scheduled traffic");
  // The relay-side switch is the same shape: bucket 0 = release immediately.
  eq(M.mbxReleaseAt(1_700_000_000, 0), 0, "a disabled relay still delayed delivery");
  // And the crypto path is untouched by any of it — real mail still round-trips.
  const opened = C.openSealed(realEnvelope("still works"), [spk.secretKey]);
  eq(opened.body, "still works", "disabling mixing broke delivery");
  assert(C.verifyInner(opened, ik.publicKey, sender.publicKey), "disabling mixing broke authorship");
});

await test("mixConfig honours the device kill switch and never throws without a browser", () => {
  eq(M.mixConfig().enabled, true, "mixing is not on by default");
  const had = "localStorage" in globalThis;
  globalThis.localStorage = { getItem: (k) => (k === "aha:mbx:mix" ? "off" : null) };
  eq(M.mixConfig().enabled, false, "the device kill switch did not disable mixing");
  globalThis.localStorage = { getItem: () => { throw new Error("blocked"); } };
  eq(M.mixConfig().enabled, true, "a blocked storage API broke messaging instead of degrading");
  if (!had) delete globalThis.localStorage;
});

await test("the mixing module has no network sink (same static rule as mailboxCrypto)", () => {
  const src = read("frontend/lib/mailboxMixing.ts");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "axios", "http.request"]) {
    assert(!src.includes(forbidden), `mailboxMixing.ts must not contain ${forbidden}`);
  }
});

await test("mixing introduces no persistent identifier: session state is memory-only", () => {
  const mix = read("frontend/lib/mailboxMixing.ts");
  assert(!/localStorage\.setItem/.test(mix), "mailboxMixing.ts writes to localStorage");
  const client = read("frontend/lib/mailbox.ts");
  // The cover cohort, the cached read-signature and the scheduler must not be
  // written anywhere — only the pre-existing SPK store may touch localStorage.
  const writes = client.match(/localStorage\.setItem\([^)]*\)/g) ?? [];
  eq(writes.length, 1, "mailbox.ts gained a new persistent store: " + writes.join(", "));
  assert(writes[0].includes("SPK_STORE"), "the one persistent write is no longer the SPK store");
  for (const decl of ["const coverPeers = new Map", "let getAuth", "let mixSession", "let pendingCoverAck"]) {
    assert(client.includes(decl), `session state ${decl} is missing — check it did not become persistent`);
  }
  assert(/stopMailboxMixing[\s\S]*coverPeers\.clear\(\)/.test(client), "stopping mixing does not clear the cover cohort");
});

await test("cover destinations are only mailboxes we hold a live prekey for", () => {
  const client = read("frontend/lib/mailbox.ts");
  // Dummies must be openable by their recipient (so they can be acked away).
  // That means every target comes from a VERIFIED bundle or from our own SPK.
  assert(/rememberCoverPeer\(b\)/.test(client), "cover peers are not sourced from verified bundles");
  eq((client.match(/rememberCoverPeer\(/g) ?? []).length, 2, "rememberCoverPeer gained a second, possibly unverified call site");
  const recipientFn = client.slice(client.indexOf("export async function recipientBundle"));
  const verifyIdx = recipientFn.indexOf("verifyBundle(b");
  const rememberIdx = recipientFn.indexOf("rememberCoverPeer(b)");
  assert(verifyIdx >= 0 && rememberIdx > verifyIdx, "a bundle is remembered as a cover target before it is verified");
});

// ===========================================================================
// 8. End to end against the REAL relay route (loaded with a next/server stub)
// ===========================================================================

const BUCKET = 1; // seconds — keep the wait short
process.env.AHA_MAILBOX_DIR = path.join(
  process.env.TMPDIR || "/tmp",
  "aha-mailbox-mixing-test-" + process.pid
);
process.env.AHA_MAILBOX_DELIVERY_BUCKET_SECS = String(BUCKET);
const route = loadTsFile(path.join(repoRoot, "frontend", "app", "api", "mailbox", "route.ts"), "route");
const web3 = requireDep("@solana/web3.js");

const call = async (payload) => {
  const res = await route.POST({
    headers: { get: () => null },
    json: async () => JSON.parse(M.padRequestBody(payload)),
  });
  return { status: res.status, len: res.body.length, body: await res.json() };
};
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const me = nacl.sign.keyPair();
const meB58 = new web3.PublicKey(me.publicKey).toBase58();
const myBox = C.mailboxIdForWallet(me.publicKey);
const mySpk = nacl.box.keyPair();
const MY_EPOCH = 2;
const myBundle = {
  v: 1,
  wallet: meB58,
  ik: C.mbxB64(nacl.box.keyPair().publicKey),
  spk: C.mbxB64(mySpk.publicKey),
  epoch: MY_EPOCH,
  sig: C.mbxB64(nacl.sign.detached(C.spkSignedBytes(mySpk.publicKey, MY_EPOCH), me.secretKey)),
};
const myGet = () => {
  const w = C.mailboxGetWindow(Math.floor(Date.now() / 1000));
  return { op: "get", to: myBox, wallet: meB58, window: w, sig: C.mbxB64(nacl.sign.detached(C.getSignedBytes(myBox, w), me.secretKey)) };
};
const coverTo = (b) => M.buildCoverEnvelope(b.spk, b.epoch, Math.floor(Date.now() / 1000));
const realTo = (b, body) => {
  const tsSec = Math.floor(Date.now() / 1000);
  return C.sealToBundle(b, { v: 3, from: meB58, ts: tsSec, body, sig: C.mbxB64(nacl.sign.detached(C.innerSignedBytes(C.mbxUnb64(b.ik), tsSec, body), me.secretKey)) }, 0);
};

await test("relay e2e: an envelope is held for its delivery bucket, then released in FIFO order", async () => {
  assert((await call({ op: "publish", bundle: myBundle })).body.ok, "publish failed");
  assert((await call({ op: "put", to: myBox, envelope: realTo(myBundle, "first") })).body.ok, "put 1 failed");
  assert((await call({ op: "put", to: myBox, envelope: coverTo(myBundle) })).body.ok, "cover put failed");
  assert((await call({ op: "put", to: myBox, envelope: realTo(myBundle, "second") })).body.ok, "put 2 failed");

  const held = await call(myGet());
  eq(held.body.messages.length, 0, "an envelope was readable before its bucket released");

  await sleepMs(BUCKET * 1000 + 250);
  const out = await call(myGet());
  eq(out.body.messages.length, 3, "the bucket did not release everything it held");
  const tsList = out.body.messages.map((m) => m.ts);
  assert(tsList.every((t, i) => i === 0 || t >= tsList[i - 1]), "the relay returned mail out of FIFO order");

  // The client half: the dummy is dropped, the two real messages survive.
  const opened = out.body.messages.map((m) => ({ id: m.id, inner: C.openSealed(m.envelope, [mySpk.secretKey]) }));
  const { mail, coverIds } = M.partitionCover(opened);
  eq(mail.length, 2, "wrong number of deliverable messages after a real relay round trip");
  eq(coverIds.length, 1, "the relay round trip lost the dummy");
  eq(mail.map((m) => m.inner.body).join(","), "first,second", "message bodies came back wrong");

  // The ack sweeps real mail and the dummy together, in one signature.
  const ids = [...mail.map((m) => m.id), ...coverIds];
  const ackSig = C.mbxB64(nacl.sign.detached(C.ackSignedBytes(myBox, ids), me.secretKey));
  assert((await call({ op: "ack", to: myBox, wallet: meB58, ids, sig: ackSig })).body.ok, "ack failed");
  eq((await call(myGet())).body.messages.length, 0, "the mailbox was not swept clean");
});

await test("relay e2e: a v1 envelope file already on disk still delivers (no silent data loss)", async () => {
  const fs = await import("node:fs/promises");
  const dir = path.join(process.env.AHA_MAILBOX_DIR, "boxes", myBox);
  await fs.mkdir(dir, { recursive: true });
  // Exactly what F63 v1 wrote: the bare envelope, no wrapper, no release time.
  await fs.writeFile(path.join(dir, "ff".repeat(12) + ".json"), JSON.stringify(realTo(myBundle, "legacy")));
  const out = await call(myGet());
  eq(out.body.messages.length, 1, "a v1 file on disk was dropped by the v2 reader");
  eq(C.openSealed(out.body.messages[0].envelope, [mySpk.secretKey]).body, "legacy", "the v1 file decoded wrong");
  const ids = [out.body.messages[0].id];
  await call({ op: "ack", to: myBox, wallet: meB58, ids, sig: C.mbxB64(nacl.sign.detached(C.ackSignedBytes(myBox, ids), me.secretKey)) });
});

await test("relay e2e: padding is bounded and never stored; replies are uniform", async () => {
  const over = await route.POST({
    headers: { get: () => null },
    json: async () => ({ op: "put", to: myBox, envelope: coverTo(myBundle), pad: "A".repeat(M.MBX_REQ_MAX_PAD + 1) }),
  });
  eq(over.status, 400, "an oversized pad was accepted");
  eq((await over.json()).error, "bad pad", "the wrong error was returned for an oversized pad");

  // An unpadded (mixing-off) client is still served — mixing is never required.
  const legacy = await route.POST({ headers: { get: () => null }, json: async () => ({ op: "bundle", wallet: meB58 }) });
  eq(legacy.status, 200, "an unpadded client was refused — mixing must degrade safely");
  assert((await legacy.json()).bundle.spk === myBundle.spk, "an unpadded bundle lookup returned the wrong bundle");

  // Enrolled vs not enrolled: same reply length.
  const stranger = new web3.PublicKey(nacl.sign.keyPair().publicKey).toBase58();
  const hit = await call({ op: "bundle", wallet: meB58 });
  const miss = await call({ op: "bundle", wallet: stranger });
  assert(hit.body.bundle && miss.body.bundle === null, "the directory fixture is wrong");
  eq(hit.len, miss.len, "an enrolled wallet is distinguishable from an unenrolled one by reply length");
  eq(hit.len, M.MBX_BUNDLE_RESP_BYTES, "the bundle reply is not the fixed size");
  // Nothing about the pad survives into storage.
  const stored = JSON.parse(readFileSync(path.join(process.env.AHA_MAILBOX_DIR, "directory", meB58 + ".json"), "utf8"));
  assert(stored.pad === undefined, "the relay stored the request pad");
  eq(Object.keys(stored).sort().join(","), "epoch,ik,sig,spk,v,wallet", "the stored bundle gained a field");
});

await test("relay e2e: a dummy put is authenticated and shaped exactly like a real one", async () => {
  // Same op, same acceptance, same reply — the relay's own validator cannot
  // separate them, which is the whole point of cover traffic.
  const a = await call({ op: "put", to: myBox, envelope: realTo(myBundle, "real") });
  const b = await call({ op: "put", to: myBox, envelope: coverTo(myBundle) });
  eq(a.status, b.status, "the relay answered a dummy differently");
  eq(a.len, b.len, "the relay's reply to a dummy is a different length");
  eq(JSON.stringify(a.body), JSON.stringify(b.body), "the relay's reply to a dummy differs in content");
  // And a `get` is refused to anyone but the owner, dummy or not.
  const w = C.mailboxGetWindow(Math.floor(Date.now() / 1000));
  const impostor = nacl.sign.keyPair();
  const bad = await call({ op: "get", to: myBox, wallet: new web3.PublicKey(impostor.publicKey).toBase58(), window: w, sig: C.mbxB64(nacl.sign.detached(C.getSignedBytes(myBox, w), impostor.secretKey)) });
  eq(bad.status, 403, "a stranger read a mailbox");
});

// ---------------------------------------------------------------------------
try {
  const fs = await import("node:fs/promises");
  await fs.rm(process.env.AHA_MAILBOX_DIR, { recursive: true, force: true });
} catch { /* nothing to clean */ }
console.log(failed === 0 ? "\nAll F63 v2 mailbox-mixing tests passed." : `\n${failed} test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
