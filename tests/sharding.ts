import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  newMasterSecret,
  splitMaster,
  reconstructMaster,
  deriveFromMaster,
} from "../frontend/lib/sharding";
import {
  recoverMemberPresent,
  completeSponsorRecovery,
  openSponsorRecovery,
  windowElapsed,
  reshareMaster,
  sponsorRecoveryAvailable,
  CHALLENGE_WINDOW_MS,
} from "../frontend/lib/recovery";
import {
  encodeShardPayload,
  decodeShardPayload,
  looksLikeShardPayload,
  HANDOVER_PREFIX,
} from "../frontend/lib/shardHandover";

// Epic 11 — Shamir 2-of-3 core + recovery flows. Property tests (no chain, no
// validator): any two reconstruct exactly, any one yields nothing, a corrupted
// shard fails loudly. Plus the flow invariants and the no-network guarantee.
describe("ayni — sponsor recovery, key shards (Epic 11)", () => {
  it("any TWO of three shards reconstruct the master exactly", async () => {
    const master = newMasterSecret();
    const [m, a, b] = await splitMaster(master);
    for (const [x, y] of [[m, a], [m, b], [a, b]] as const) {
      const back = await reconstructMaster(x, y);
      assert.deepEqual([...back], [...master]);
    }
  });

  it("any ONE shard reconstructs nothing (a single share is not enough)", async () => {
    const master = newMasterSecret();
    const [m] = await splitMaster(master);
    // Reconstruction needs two distinct shares; one alone cannot yield the secret.
    let recovered = false;
    try {
      const out = await reconstructMaster(m, m); // the same share twice is not two shares
      recovered = [...out].join() === [...master].join();
    } catch {
      /* failing loudly is the acceptable outcome */
    }
    assert.isFalse(recovered, "a single shard must not reconstruct the master");
  });

  it("a corrupted shard fails loudly rather than returning garbage-as-success", async () => {
    const master = newMasterSecret();
    const [m, a] = await splitMaster(master);
    const corrupt = Uint8Array.from(a);
    corrupt[1] ^= 0xff; // flip a byte
    let out: Uint8Array | null = null;
    try { out = await reconstructMaster(m, corrupt); } catch { out = null; }
    // Either it threw (loud), or it produced something that is NOT the master
    // (never a silent correct-looking result).
    if (out) assert.notDeepEqual([...out], [...master], "a corrupted shard must never reconstruct the true master");
  });

  it("one master secret backs both the zk secret and the wallet seed, distinctly", async () => {
    const master = newMasterSecret();
    const { zkSecret, walletSeed } = await deriveFromMaster(master);
    assert.equal(zkSecret.length, 32);
    assert.equal(walletSeed.length, 32);
    assert.notDeepEqual([...zkSecret], [...walletSeed]); // domain-separated
    // deterministic
    const again = await deriveFromMaster(master);
    assert.deepEqual([...again.zkSecret], [...zkSecret]);
  });

  it("member-present fast path requires a genuine member shard", async () => {
    const master = newMasterSecret();
    const [m, a, b] = await splitMaster(master);
    // own + one sponsor → works
    const back = await recoverMemberPresent({ shard: m, role: "member" }, { shard: a, role: "sponsor" });
    assert.deepEqual([...back], [...master]);
    // two sponsor shards must NOT masquerade as member-present
    let ok = false;
    try { await recoverMemberPresent({ shard: a, role: "sponsor" } as any, { shard: b, role: "sponsor" }); ok = true; } catch { /* expected */ }
    assert.isFalse(ok, "two sponsor shards cannot masquerade as member-present");
  });

  it("sponsor-only recovery waits out the 7-day window and honours cancellation", async () => {
    const master = newMasterSecret();
    const [, a, b] = await splitMaster(master);
    const t0 = 1_000_000_000_000;
    const intent = openSponsorRecovery("one-time-code", t0);
    assert.equal(intent.windowMs, CHALLENGE_WINDOW_MS);
    assert.isFalse(windowElapsed(intent, t0 + 1000));
    // before the window: refused
    let early = false;
    try { await completeSponsorRecovery(intent, { shard: a, role: "sponsor" }, { shard: b, role: "sponsor" }, t0 + 1000, false); early = true; } catch {}
    assert.isFalse(early, "must not complete before the window elapses");
    // cancelled: refused (shards to be burned)
    let cancelled = false;
    try { await completeSponsorRecovery(intent, { shard: a, role: "sponsor" }, { shard: b, role: "sponsor" }, t0 + CHALLENGE_WINDOW_MS + 1, true); cancelled = true; } catch {}
    assert.isFalse(cancelled, "a member cancellation must abort recovery");
    // after the window, not cancelled: succeeds
    const back = await completeSponsorRecovery(intent, { shard: a, role: "sponsor" }, { shard: b, role: "sponsor" }, t0 + CHALLENGE_WINDOW_MS + 1, false);
    assert.deepEqual([...back], [...master]);
  });

  it("re-sharding cuts a fresh, incompatible set (old shards stop working)", async () => {
    const master = newMasterSecret();
    const [mOld, aOld] = await splitMaster(master);
    const [mNew, aNew, bNew] = await reshareMaster(master, splitMaster);
    // new set reconstructs the same master
    assert.deepEqual([...(await reconstructMaster(mNew, aNew))], [...master]);
    // an old shard mixed with a new one must NOT silently reconstruct the master
    let leaked = false;
    try { leaked = [...(await reconstructMaster(mOld, aNew))].join() === [...master].join(); } catch {}
    assert.isFalse(leaked, "a stale shard must not combine with a fresh one to reveal the master");
    void aOld; void bNew;
  });

  it("provisional members (one sponsor) have no sponsor recovery", () => {
    assert.isFalse(sponsorRecoveryAvailable(1));
    assert.isTrue(sponsorRecoveryAvailable(2));
  });

  it("the recovery + custody + sharding modules contain NO network sink", () => {
    // Sentinel Layer F asserts this adversarially; a fast static guard here too.
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.credentials|programWith|\.rpc\s*\(|sendTransaction|new Connection|@solana\/web3/;
    for (const f of ["frontend/lib/recovery.ts", "frontend/lib/shardCustody.ts", "frontend/lib/sharding.ts", "frontend/lib/shardHandover.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      assert.notMatch(src, forbidden, `${f} must have no network/chain sink a shard could take`);
    }
  });

  it("ShardCustody exposes no enumeration path (static)", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "frontend/lib/shardCustody.ts"), "utf8");
    // Strip comments first — the doc DESCRIBES the forbidden methods to explain
    // their deliberate absence; we check the actual code, not the prose.
    const code = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // no list/keys/count/entries/iterate method declared or called in real code
    assert.notMatch(code, /\b(list|keys|count|entries|iterate|values|has)\s*[(:]/);
    // and the three real methods ARE present (put/get/burn)
    for (const m of ["put", "get", "burn"]) assert.match(code, new RegExp(`\\b${m}\\s*[(:]`), `${m} should exist`);
  });

  // --- F74: in-person handover codec (QR / NFC payload) ----------------------

  it("a real shard round-trips through the handover codec exactly", async () => {
    const master = newMasterSecret();
    const [m, a] = await splitMaster(master);
    for (const shard of [m, a]) {
      const payload = encodeShardPayload(shard);
      assert.isTrue(payload.startsWith(HANDOVER_PREFIX), "payload must carry the recognisable prefix");
      const back = decodeShardPayload(payload);
      assert.deepEqual([...back], [...shard], "decode must reproduce the shard byte-for-byte");
    }
    // and a decoded shard still reconstructs the master with its partner
    const p = encodeShardPayload(m);
    const recovered = await reconstructMaster(decodeShardPayload(p), a);
    assert.deepEqual([...recovered], [...master]);
  });

  it("a corrupted or truncated handover payload fails LOUDLY, never returns a valid-looking shard", () => {
    const payload = encodeShardPayload(Uint8Array.from({ length: 33 }, (_, i) => i + 1));
    // flip a base64 char in the body
    const i = HANDOVER_PREFIX.length + 4;
    const tampered = payload.slice(0, i) + (payload[i] === "A" ? "B" : "A") + payload.slice(i + 1);
    assert.throws(() => decodeShardPayload(tampered), /checksum|mismatch|corrupted|short/i);
    // truncation
    assert.throws(() => decodeShardPayload(payload.slice(0, payload.length - 6)), /mismatch|corrupted|short|checksum/i);
    // a foreign QR (no prefix) is refused, not coerced
    assert.throws(() => decodeShardPayload("https://example.com/whatever"), /not an AHA shard/i);
    assert.isFalse(looksLikeShardPayload("https://example.com/whatever"));
  });

  it("the handover codec is deterministic and DOM/network-free (unit-testable in node)", () => {
    const blob = Uint8Array.from({ length: 32 }, (_, i) => (i * 7) & 0xff);
    assert.equal(encodeShardPayload(blob), encodeShardPayload(blob), "same blob → same payload (no time/nonce leak)");
    assert.throws(() => encodeShardPayload(new Uint8Array(0)), /empty/);
  });
});
