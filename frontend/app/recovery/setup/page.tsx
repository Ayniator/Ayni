"use client";

// Shard ceremony (Trust Platform Epic 11 / F72–F74 + F78) — the ONE-TIME,
// IN-PERSON setup that makes sponsor recovery possible.
//
// EVERYTHING ON THIS PAGE IS LOCAL. Splitting the master secret and handing
// shards to sponsors emits NOTHING on chain and takes NO network path: this
// file imports no fetch, no socket, no wallet/web3/anchor API (CLAUDE.md locked
// position; Sentinel Layer F asserts the absence statically). A shard leaves
// this device only through <ShardSend/> — NFC tap or QR across a table.
//
// The split is Shamir 2-of-3 via lib/sharding.ts (the vetted constant-time
// library — never hand-written field arithmetic). One shard stays with the
// member, one goes to each of the two sponsors. Any single shard alone
// reconstructs nothing, and the UI says so out loud.
//
// SEALING: a shard at rest is an opaque blob encrypted under a key the holder
// does not have (lib/shardCustody contract). The seal/unseal pair lives in the
// shared lib/shardSeal.ts (key = SHA-256("aha-shard-seal-v1:<role>:" + code),
// nacl.secretbox, blob = nonce(24) || box) so the recovery flow (/recovery,
// F75/F76) unseals with the exact same derivation. The one-time code is shown
// ONCE to the member and stored NOWHERE — without it, neither this device nor a
// sponsor can open the blob they hold.
//
// F78 (provisional members): with ONE sponsor there is no valid 2-of-3 split,
// so there is NO sponsor recovery. This page asks early, refuses to fake a
// ceremony, and says so honestly — the same disclosure onboarding makes before
// a provisional member finishes.

import { useState } from "react";
import Link from "next/link";
import ShardSend from "../../../components/ShardSend";
import { useT } from "../../../components/SettingsProvider";
import { splitMaster } from "../../../lib/sharding";
import { getOrCreateMaster } from "../../../lib/masterSecret";
import { localShardCustody } from "../../../lib/shardCustody";
import { encodeShardPayload } from "../../../lib/shardHandover";
import { sponsorRecoveryAvailable } from "../../../lib/recovery";
import { sealShard } from "../../../lib/shardSeal";

// --- one-time code -----------------------------------------------------------
// Human-writable, shown once, stored nowhere. Alphabet drops lookalikes
// (I/L/O/0/1). 16 chars ≈ 78 bits — a capability, not a password to memorise.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newOneTimeCode(): string {
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  const chars = Array.from(raw, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12).join("")}`;
}

// --- the ceremony state machine ----------------------------------------------
//
//   intro ──(one sponsor)──▶ provisional            (F78 dead-end, honest)
//     └────(two sponsors)──▶ code ─▶ sponsorA ─▶ sponsorB ─▶ done
//
// The master secret and the three raw shards exist ONLY inside beginCeremony():
// generated, split, sealed, then fill(0)-wiped in a finally block before any
// state is set. React state holds only the sealed artefacts (two framed payload
// strings) and the one-time code string — never key material.

type Phase = "intro" | "provisional" | "code" | "sponsorA" | "sponsorB" | "done";

export default function RecoverySetupPage() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("intro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [payloadA, setPayloadA] = useState<string>("");
  const [payloadB, setPayloadB] = useState<string>("");

  async function beginCeremony() {
    setBusy(true);
    setErr(null);
    // MASTER-SECRET SOURCE — adopt, do not invent (F61).
    //
    // This used to generate a fresh master every time and wipe it in the same
    // function, which was harmless while nothing else derived from it. It stopped
    // being harmless the moment shielding shipped: a shielded membership answers
    // to a key derived from the master, so sharding a DIFFERENT master would hand
    // the sponsors shards that restore an identity which cannot sign for the
    // member's own memberships — and nobody would find out until recovery day.
    // `getOrCreateMaster()` seals one device-local copy (lib/masterSecret.ts) and
    // every consumer takes it from there.
    const { master } = await getOrCreateMaster();
    let shards: Uint8Array[] = [];
    try {
      const oneTime = newOneTimeCode();
      const [mine, forA, forB] = await splitMaster(master);
      shards = [mine, forA, forB];

      // Member's shard → sealed, into local custody under the one-time code.
      // The code is never stored: custody indexes by its hash, and the seal key
      // derives from it, so this device alone can read nothing back.
      const sealedMine = await sealShard("member", oneTime, mine);
      await localShardCustody.put(oneTime, sealedMine);

      // Sponsor shards → sealed, framed for in-person device-to-device handover.
      const a = encodeShardPayload(await sealShard("sponsor-1", oneTime, forA));
      const b = encodeShardPayload(await sealShard("sponsor-2", oneTime, forB));

      setCode(oneTime);
      setPayloadA(a);
      setPayloadB(b);
      setPhase("code");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      // Buffer hygiene (locked position): every raw shard is wiped the moment
      // the sealed artefacts exist — nothing raw survives this function, in
      // state or anywhere else. The MASTER is deliberately not wiped here: it is
      // no longer this function's to destroy, it belongs to the sealed keystore
      // blob, and zeroing the shared buffer would break the member's own
      // shielded memberships on this device. `forgetMaster()` is the lock.
      for (const s of shards) s.fill(0);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>{t("recovery.setup.title")}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("recovery.setup.sub")}
      </p>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        {phase === "intro" && (
          <StepIntro
            busy={busy}
            onTwoSponsors={beginCeremony}
            onOneSponsor={() => setPhase("provisional")}
          />
        )}
        {phase === "provisional" && <StepProvisional onBack={() => setPhase("intro")} />}
        {phase === "code" && <StepCode code={code} onNext={() => setPhase("sponsorA")} />}
        {phase === "sponsorA" && (
          <StepSponsor which={1} payload={payloadA} onConfirmed={() => setPhase("sponsorB")} />
        )}
        {phase === "sponsorB" && (
          <StepSponsor which={2} payload={payloadB} onConfirmed={() => setPhase("done")} />
        )}
        {phase === "done" && <StepDone />}
      </div>

      {err && <p className="error sm" style={{ marginTop: 10 }}>{err}</p>}
    </div>
  );
}

/* ── Intro — the model in three sentences, then the F78 fork ─────────────── */

function StepIntro({
  busy,
  onTwoSponsors,
  onOneSponsor,
}: {
  busy: boolean;
  onTwoSponsors: () => void;
  onOneSponsor: () => void;
}) {
  const t = useT();
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{t("recovery.setup.howTitle")}</h2>
      <p>
        {t("recovery.setup.howPre")} <strong>{t("recovery.setup.howStrong1")}</strong>{" "}
        {t("recovery.setup.howMid1")} <strong>{t("recovery.setup.howStrong2")}</strong>{" "}
        {t("recovery.setup.howMid2")}
        <strong> {t("recovery.setup.howStrong3")}</strong>{t("recovery.setup.howMid3")}
        <strong> {t("recovery.setup.howStrong4")}</strong>{t("recovery.setup.howSuf")}
      </p>
      <p className="muted sm">
        {t("recovery.setup.ceremonyNote")}
      </p>

      <div className="name" style={{ marginTop: 16 }}>{t("recovery.setup.howManyTitle")}</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn" onClick={onTwoSponsors} disabled={busy}>
          {busy ? t("recovery.setup.preparing") : t("recovery.setup.twoBtn")}
        </button>
        <button className="btn btn-ghost" onClick={onOneSponsor} disabled={busy}>
          {t("recovery.setup.oneBtn")}
        </button>
      </div>
    </section>
  );
}

/* ── F78 — provisional members get the truth, not a fake ceremony ────────── */

function StepProvisional({ onBack }: { onBack: () => void }) {
  const t = useT();
  // Guard is the shared lib predicate, not a re-derived rule.
  const available = sponsorRecoveryAvailable(1);
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{t("recovery.setup.prov.title")}</h2>
      {!available && (
        <div
          className="card"
          style={{
            borderColor: "var(--warn, #c98a2b)",
            background: "color-mix(in srgb, var(--warn, #c98a2b) 8%, transparent)",
            padding: 14,
          }}
        >
          <div className="name" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span aria-hidden>⚠️</span> {t("recovery.setup.prov.warnTitle")}
          </div>
          <p className="sm" style={{ margin: "8px 0 0" }}>
            {t("recovery.setup.prov.warnPre")} <strong>{t("recovery.setup.prov.warnStrong1")}</strong>{" "}
            {t("recovery.setup.prov.warnMid1")} <strong>{t("recovery.setup.prov.warnStrong2")}</strong>
            {t("recovery.setup.prov.warnMid2")}{" "}
            <strong>{t("recovery.setup.prov.warnStrong3")}</strong>.
          </p>
        </div>
      )}
      <p className="sm" style={{ marginTop: 12 }}>
        {t("recovery.setup.prov.comeBack")}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={onBack}>{t("recovery.setup.prov.backBtn")}</button>
        <Link className="btn" href="/me">{t("recovery.setup.prov.goMe")}</Link>
      </div>
    </section>
  );
}

/* ── One-time code — shown ONCE, written down, stored nowhere ────────────── */

function StepCode({ code, onNext }: { code: string; onNext: () => void }) {
  const t = useT();
  const [written, setWritten] = useState(false);
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{t("recovery.setup.code.title")}</h2>
      <p className="sm">
        {t("recovery.setup.code.introPre")} <strong>{t("recovery.setup.code.introStrong1")}</strong>{" "}
        {t("recovery.setup.code.introMid")} <strong>{t("recovery.setup.code.introStrong2")}</strong>
        {t("recovery.setup.code.introSuf")}
      </p>
      <div
        className="card"
        style={{ padding: 16, textAlign: "center", fontFamily: "monospace", fontSize: 22, letterSpacing: 2 }}
        aria-label={t("recovery.setup.code.aria")}
      >
        {code}
      </div>
      <p className="muted sm" style={{ marginTop: 8 }}>
        {t("recovery.setup.code.paperPre")} <strong>{t("recovery.setup.code.paperStrong")}</strong>.
      </p>
      <label className="row sm" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer", marginTop: 10 }}>
        <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{t("recovery.setup.code.writtenLabel")}</span>
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onNext} disabled={!written}>
          {t("recovery.setup.code.continueBtn")}
        </button>
      </div>
    </section>
  );
}

/* ── Sponsor handover — send, then a human checkpoint ────────────────────── */

function StepSponsor({
  which,
  payload,
  onConfirmed,
}: {
  which: 1 | 2;
  payload: string;
  onConfirmed: () => void;
}) {
  const t = useT();
  const [sent, setSent] = useState(false);
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{t("recovery.setup.sponsor.titlePre")} {which}</h2>
      <p className="sm">
        {t("recovery.setup.sponsor.bodyPre")} <strong>{t("recovery.setup.sponsor.bodyStrong")}</strong>
        {t("recovery.setup.sponsor.bodySuf")}
      </p>
      <ShardSend payload={payload} label={`${t("recovery.setup.sponsor.sendLabelPre")} ${which}`} onDone={() => setSent(true)} />
      {sent ? (
        <div className="card" style={{ padding: 14, marginTop: 12, borderColor: "var(--accent, #6b8f71)" }}>
          <p className="sm" style={{ margin: 0 }}>
            <strong>{t("recovery.setup.sponsor.checkpointStrong")}</strong>{" "}
            {t("recovery.setup.sponsor.checkpointPre")} {which}{" "}
            {t("recovery.setup.sponsor.checkpointMid")} <em>{t("recovery.setup.sponsor.checkpointEm")}</em>{" "}
            {t("recovery.setup.sponsor.checkpointSuf")}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={onConfirmed}>
              {t("recovery.setup.sponsor.confirmedPre")} {which} {t("recovery.setup.sponsor.confirmedMid")}{" "}
              {which === 1 ? t("recovery.setup.sponsor.confirmedNext") : t("recovery.setup.sponsor.confirmedFinish")}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted sm" style={{ marginTop: 12 }}>
          {t("recovery.setup.sponsor.sendFirst")}
        </p>
      )}
    </section>
  );
}

/* ── Finish — what exists now, and the lifecycle rule ────────────────────── */

function StepDone() {
  const t = useT();
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{t("recovery.setup.done.title")}</h2>
      <ul className="sm" style={{ lineHeight: 1.7 }}>
        <li>
          {t("recovery.setup.done.li1Pre")} <strong>{t("recovery.setup.done.li1Strong")}</strong>{" "}
          {t("recovery.setup.done.li1Suf")}
        </li>
        <li>
          <strong>{t("recovery.setup.done.li2Strong")}</strong> {t("recovery.setup.done.li2Suf")}
        </li>
        <li>
          <strong>{t("recovery.setup.done.li3Strong")}</strong> {t("recovery.setup.done.li3Suf")}
        </li>
        <li>
          {t("recovery.setup.done.li4")}
        </li>
      </ul>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <div className="name">{t("recovery.setup.done.replaceTitle")}</div>
        <p className="sm" style={{ margin: "6px 0 0" }}>
          {t("recovery.setup.done.replacePre")}
          <strong> {t("recovery.setup.done.replaceStrong")}</strong> {t("recovery.setup.done.replaceMid")}{" "}
          <Link href="/recovery">{t("recovery.setup.done.replaceLink")}</Link>.
        </p>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Link className="btn" href="/me">{t("recovery.setup.done.backMe")}</Link>
        <Link className="btn btn-ghost" href="/recovery">{t("recovery.setup.done.recoveryPage")}</Link>
      </div>
    </section>
  );
}
