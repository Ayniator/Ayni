"use client";

// Recovery (Trust Platform Epic 11 / F75–F78) — restore a member's identity
// through the two humans who admitted them.
//
// EVERYTHING ON THIS PAGE IS LOCAL (CLAUDE.md locked positions):
//   - Reconstructing the master secret emits NOTHING on chain: no transaction,
//     no key rotation, no commitment change, no Merkle-root republication. This
//     file imports no web3/anchor/wallet module and makes no network call.
//   - Member-present recovery requires a GENUINE member shard + one sponsor
//     shard; two sponsor shards cannot masquerade (lib/recovery enforces it —
//     its errors are surfaced verbatim here, never softened).
//   - Sponsor-only recovery waits out a 7-day challenge window. The window is
//     CHALLENGE_WINDOW_MS, full stop — there is no dev/skip affordance and the
//     countdown is display-only; the gate is windowElapsed() in the lib.
//   - The pending intent lives OFF-CHAIN in this device's shard-custody layer /
//     localStorage. It is never published or correlated anywhere.
//   - Provisional members (one sponsor) have no sponsor recovery — said plainly
//     on the page, not hidden.
//   - Reconstructed secrets and raw shards are never logged, displayed, or
//     persisted beyond what the flow strictly needs; buffers are fill(0)-wiped
//     the moment they are no longer needed.
//
// ShardReceive / ShardSend are the in-person device-to-device handover
// components (QR/NFC, no network code path). Contracts:
//   ShardReceive: { onPayload: (text: string) => void; label?: string }
//   ShardSend:    { payload: string; label?: string; onDone?: () => void }
//
// SEALING: every shard at rest or in transit is an opaque blob sealed by the
// shared lib/shardSeal.ts (same derivation as the ceremony at /recovery/setup:
// key = SHA-256("aha-shard-seal-v1:<role>:" + code), nacl.secretbox,
// blob = nonce(24) || box). This page unseals with the member's one-time code
// before reconstruction, and re-seals the fresh set it cuts afterwards. Role-
// separated keys make the "genuine member shard" rule cryptographic, not just
// declarative: a sponsor blob can never open under the "member" key. A received
// sponsor blob carries no role marker (shard bytes are indistinguishable by
// design), so openSponsorShard tries both sponsor role keys and reports which
// one opened — which also catches the same sponsor's shard presented twice.

import { useCallback, useEffect, useRef, useState } from "react";
import ShardReceive from "../../components/ShardReceive";
import ShardSend from "../../components/ShardSend";
import { useT } from "../../components/SettingsProvider";
import {
  CHALLENGE_WINDOW_MS,
  HeldShard,
  RecoveryIntent,
  completeSponsorRecovery,
  openSponsorRecovery,
  recoverMemberPresent,
  reshareMaster,
  sponsorRecoveryAvailable,
  windowElapsed,
} from "../../lib/recovery";
import { deriveFromMaster, splitMaster } from "../../lib/sharding";
import { localShardCustody } from "../../lib/shardCustody";
import { decodeShardPayload, encodeShardPayload } from "../../lib/shardHandover";
import { openShard, openSponsorShard, sealShard } from "../../lib/shardSeal";
import {
  clearPendingRecovery,
  formatRemaining,
  intentShardCode,
  loadPendingRecovery,
  newOneTimeCode,
  savePendingRecovery,
  wipe,
} from "../../lib/recoveryUi";

type Flow = "home" | "present" | "sponsor" | "cancel" | "recovered";

/** A ticking clock for countdown DISPLAY. Never a gate by itself — every gate
 *  re-checks windowElapsed() with a fresh Date.now() at click time. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function RecoveryPage() {
  const t = useT();
  const [flow, setFlow] = useState<Flow>("home");
  const [pending, setPending] = useState<RecoveryIntent | null>(null);

  // The reconstructed master secret, held ONLY in this ref between recovery and
  // re-issue, then wiped. Never in React state, never rendered, never persisted.
  const masterRef = useRef<Uint8Array | null>(null);
  // Member-present: the old one-time code whose custody blob becomes stale after
  // re-issue and must be burned.
  const [oldMemberCode, setOldMemberCode] = useState<string | null>(null);

  useEffect(() => {
    setPending(loadPendingRecovery());
  }, []);

  // Wipe the master if the page unmounts before the flow finished.
  useEffect(
    () => () => {
      wipe(masterRef.current);
      masterRef.current = null;
    },
    []
  );

  const onRecovered = useCallback((master: Uint8Array, burnCode: string | null) => {
    masterRef.current = master;
    setOldMemberCode(burnCode);
    setFlow("recovered");
  }, []);

  const backHome = useCallback(() => {
    wipe(masterRef.current);
    masterRef.current = null;
    setOldMemberCode(null);
    setFlow("home");
  }, []);

  return (
    <>
      <h1>{t("recovery.title")}</h1>
      <p className="lede">
        {t("recovery.ledePre")}{" "}
        <strong>{t("recovery.ledeStrong")}</strong> {t("recovery.ledeSuf")}
      </p>

      {flow === "home" && (
        <RecoveryHome
          pending={pending}
          onPick={(f) => setFlow(f)}
        />
      )}

      {flow === "present" && (
        <MemberPresentFlow onRecovered={onRecovered} onBack={backHome} />
      )}

      {flow === "sponsor" && (
        <SponsorOnlyFlow
          pending={pending}
          setPending={setPending}
          onRecovered={(master) => onRecovered(master, null)}
          onBack={backHome}
        />
      )}

      {flow === "cancel" && (
        <CancelFlow pending={pending} setPending={setPending} onBack={backHome} />
      )}

      {flow === "recovered" && (
        <RecoveredPanel masterRef={masterRef} oldMemberCode={oldMemberCode} onDone={backHome} />
      )}
    </>
  );
}

// --- entry --------------------------------------------------------------------

function RecoveryHome({
  pending,
  onPick,
}: {
  pending: RecoveryIntent | null;
  onPick: (f: Flow) => void;
}) {
  const t = useT();
  return (
    <div className="grid">
      <section className="card">
        <div className="row">
          <div className="meta">
            <div className="name">{t("recovery.home.presentTitle")}</div>
            <div className="sub">
              {t("recovery.home.presentSub")}
            </div>
          </div>
        </div>
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => onPick("present")}>
            {t("recovery.home.presentBtn")}
          </button>
        </p>
      </section>

      <section className="card">
        <div className="row">
          <div className="meta">
            <div className="name">{t("recovery.home.sponsorTitle")}</div>
            <div className="sub">
              {t("recovery.home.sponsorSub")}
            </div>
          </div>
        </div>
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => onPick("sponsor")}>
            {pending ? t("recovery.home.sponsorBtnContinue") : t("recovery.home.sponsorBtnStart")}
          </button>
        </p>
      </section>

      <section className="card">
        <div className="row">
          <div className="meta">
            <div className="name">{t("recovery.home.cancelTitle")}</div>
            <div className="sub">
              {t("recovery.home.cancelSubPre")} <em>{t("recovery.home.cancelSubEm")}</em>{" "}
              {t("recovery.home.cancelSubSuf")}
            </div>
          </div>
        </div>
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => onPick("cancel")}>
            {t("recovery.home.cancelBtn")}
          </button>
        </p>
      </section>

      {!sponsorRecoveryAvailable(1) && (
        <p className="muted sm">
          <strong>{t("recovery.home.provStrong1")}</strong> {t("recovery.home.provA")}{" "}
          <strong>{t("recovery.home.provStrong2")}</strong>
          {t("recovery.home.provB")}
        </p>
      )}
    </div>
  );
}

// --- flow 1: member-present (immediate) --------------------------------------

function MemberPresentFlow({
  onRecovered,
  onBack,
}: {
  onRecovered: (master: Uint8Array, burnCode: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<"code" | "receive">("code");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The member's own RAW shard, unsealed from local custody with the one-time
  // code. Held in a ref only for the duration of the flow, wiped on success,
  // on error, and on unmount — never in React state.
  const mineRef = useRef<Uint8Array | null>(null);

  useEffect(
    () => () => {
      wipe(mineRef.current);
      mineRef.current = null;
    },
    []
  );

  const unlock = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const c = code.trim();
      const sealed = await localShardCustody.get(c);
      if (!sealed) {
        setErr(t("recovery.present.errNoShard"));
        return;
      }
      // Unseal under the MEMBER role key — only the genuine member shard,
      // sealed at the ceremony for this code, can open here.
      const raw = await openShard("member", c, sealed);
      wipe(sealed);
      if (!raw) {
        setErr(t("recovery.present.errNotMemberShard"));
        return;
      }
      mineRef.current = raw;
      setStep("receive");
    } finally {
      setBusy(false);
    }
  }, [code, t]);

  const onPayload = useCallback(
    async (text: string) => {
      setErr(null);
      setBusy(true);
      let sealedSponsor: Uint8Array | null = null;
      let rawSponsor: Uint8Array | null = null;
      try {
        sealedSponsor = decodeShardPayload(text);
        // Unseal under the sponsor role keys (either sponsor works here — the
        // fast path needs your shard plus ANY ONE sponsor's).
        const opened = await openSponsorShard(code.trim(), sealedSponsor);
        if (!opened) {
          throw new Error(t("recovery.present.errNotSponsorShard"));
        }
        rawSponsor = opened.raw;
        const mine: HeldShard = { shard: mineRef.current!, role: "member" };
        const sponsor: HeldShard = { shard: rawSponsor, role: "sponsor" };
        const master = await recoverMemberPresent(mine, sponsor);
        // Reconstruction done — the working copies are no longer needed.
        wipe(rawSponsor, sealedSponsor, mineRef.current);
        mineRef.current = null;
        onRecovered(master, code.trim());
      } catch (e: any) {
        // Surface the lib's error honestly (e.g. a non-member shard on the fast
        // path, or a corrupted scan) — never soften or work around it.
        wipe(rawSponsor, sealedSponsor);
        setErr(e?.message ?? t("recovery.errRecoveryFailed"));
      } finally {
        setBusy(false);
      }
    },
    [code, onRecovered, t]
  );

  return (
    <div className="grid">
      <section className="card">
        <div className="name">{t("recovery.present.title")}</div>
        <p className="muted sm">
          {t("recovery.present.introPre")} <strong>{t("recovery.present.introStrong")}</strong>{" "}
          {t("recovery.present.introSuf")}
        </p>

        {step === "code" && (
          <>
            <p className="sm">
              <strong>{t("recovery.present.step1Strong")}</strong> {t("recovery.present.step1Rest")}
            </p>
            <div className="row">
              <input
                className="mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn btn-sm" onClick={unlock} disabled={busy || !code.trim()}>
                {t("recovery.present.unlockBtn")}
              </button>
            </div>
          </>
        )}

        {step === "receive" && (
          <>
            <p className="sm">
              <strong>{t("recovery.present.step2Strong")}</strong> {t("recovery.present.step2Rest")}
            </p>
            <ShardReceive onPayload={onPayload} label={t("recovery.present.receiveLabel")} />
          </>
        )}

        {err && <p className="error sm">{err}</p>}
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm btn-ghost" onClick={onBack} disabled={busy}>
            {t("recovery.back")}
          </button>
        </p>
      </section>
    </div>
  );
}

// --- flow 2: sponsor-only (7-day challenge window) ---------------------------

function SponsorOnlyFlow({
  pending,
  setPending,
  onRecovered,
  onBack,
}: {
  pending: RecoveryIntent | null;
  setPending: (p: RecoveryIntent | null) => void;
  onRecovered: (master: Uint8Array) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<"code" | "receive1" | "receive2">("code");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The first sponsor's SEALED blob (kept sealed — it is only opened at
  // completion) and the role key it opened under, to reject the same sponsor's
  // shard being presented twice.
  const firstRef = useRef<Uint8Array | null>(null);
  const firstRoleRef = useRef<"sponsor-1" | "sponsor-2" | null>(null);
  const now = useNow();

  useEffect(
    () => () => {
      wipe(firstRef.current);
      firstRef.current = null;
      firstRoleRef.current = null;
    },
    []
  );

  const onFirst = useCallback(
    async (text: string) => {
      setErr(null);
      let sealed: Uint8Array | null = null;
      try {
        sealed = decodeShardPayload(text);
        // Verify NOW that this blob opens with the entered code — a member who
        // waits 7 days to find out a shard was a dud is not an honest UX. The
        // raw bytes are wiped immediately; only the sealed blob is kept.
        const opened = await openSponsorShard(code.trim(), sealed);
        if (!opened) {
          wipe(sealed);
          setErr(t("recovery.sponsor.errWrongCode"));
          return;
        }
        wipe(opened.raw);
        firstRef.current = sealed;
        firstRoleRef.current = opened.role;
        setStep("receive2");
      } catch (e: any) {
        wipe(sealed);
        setErr(e?.message ?? t("recovery.errBadShardPayload"));
      }
    },
    [code, t]
  );

  const onSecond = useCallback(
    async (text: string) => {
      setErr(null);
      setBusy(true);
      let second: Uint8Array | null = null;
      try {
        second = decodeShardPayload(text);
        const c = code.trim();
        const opened = await openSponsorShard(c, second);
        if (!opened) {
          wipe(second);
          setErr(t("recovery.sponsor.errWrongCode"));
          return;
        }
        wipe(opened.raw);
        if (opened.role === firstRoleRef.current) {
          wipe(second);
          setErr(t("recovery.sponsor.errSameSponsor"));
          return;
        }
        // Keep the two SEALED blobs in this device's custody for the duration of
        // the window (get/burn by derived code only — no enumeration), and the
        // intent in this device's localStorage. Off-chain by design: the intent
        // is published nowhere and correlatable to nothing.
        await localShardCustody.put(intentShardCode(c, 1), firstRef.current!);
        await localShardCustody.put(intentShardCode(c, 2), second);
        const intent = openSponsorRecovery(c, Date.now());
        savePendingRecovery(intent);
        wipe(second, firstRef.current);
        firstRef.current = null;
        firstRoleRef.current = null;
        setPending(intent);
      } catch (e: any) {
        wipe(second);
        setErr(e?.message ?? t("recovery.errBadShardPayload"));
      } finally {
        setBusy(false);
      }
    },
    [code, setPending, t]
  );

  const complete = useCallback(async () => {
    if (!pending) return;
    setErr(null);
    setBusy(true);
    let rawA: Uint8Array | null = null;
    let rawB: Uint8Array | null = null;
    try {
      const sealedA = await localShardCustody.get(intentShardCode(pending.code, 1));
      const sealedB = await localShardCustody.get(intentShardCode(pending.code, 2));
      if (!sealedA || !sealedB) {
        setErr(t("recovery.sponsor.errShardsBurned"));
        clearPendingRecovery();
        setPending(null);
        return;
      }
      // Unseal the two sponsor blobs with this recovery's code (either sponsor
      // role key may have sealed either blob — openSponsorShard tries both).
      const openedA = await openSponsorShard(pending.code, sealedA);
      const openedB = await openSponsorShard(pending.code, sealedB);
      wipe(sealedA, sealedB);
      if (!openedA || !openedB) {
        setErr(t("recovery.sponsor.errStaleShards"));
        return;
      }
      rawA = openedA.raw;
      rawB = openedB.raw;
      const master = await completeSponsorRecovery(
        pending,
        { shard: rawA, role: "sponsor" },
        { shard: rawB, role: "sponsor" },
        Date.now(),
        false
      );
      // The shards are spent: burn them in custody and forget the intent.
      await localShardCustody.burn(intentShardCode(pending.code, 1));
      await localShardCustody.burn(intentShardCode(pending.code, 2));
      clearPendingRecovery();
      setPending(null);
      wipe(rawA, rawB);
      onRecovered(master);
    } catch (e: any) {
      // e.g. "the challenge window has not elapsed" — surfaced verbatim.
      wipe(rawA, rawB);
      setErr(e?.message ?? t("recovery.errRecoveryFailed"));
    } finally {
      setBusy(false);
    }
  }, [pending, setPending, onRecovered, t]);

  // --- waiting view: the window is running -----------------------------------
  if (pending) {
    const remaining = pending.openedAt + pending.windowMs - now;
    const elapsed = windowElapsed(pending, now);
    return (
      <div className="grid">
        <section className="card">
          <div className="name">{t("recovery.sponsor.windowTitle")}</div>
          <p className="sm">
            {t("recovery.sponsor.windowPre")}{" "}
            <span className="mono">{new Date(pending.openedAt).toLocaleString()}</span>{" "}
            {t("recovery.sponsor.windowMid")} {Math.round(CHALLENGE_WINDOW_MS / 86_400_000)}
            {t("recovery.sponsor.windowSuf")}
          </p>
          <p>
            {elapsed ? (
              <span className="ok-note">{t("recovery.sponsor.windowElapsed")}</span>
            ) : (
              <>
                {t("recovery.sponsor.timeRemaining")} <strong>{formatRemaining(remaining)}</strong>
              </>
            )}
          </p>
          <p className="muted sm">
            {t("recovery.sponsor.windowNote")}
          </p>
          <div className="row">
            <button className="btn" onClick={complete} disabled={!elapsed || busy}>
              {t("recovery.sponsor.completeBtn")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={onBack} disabled={busy}>
              {t("recovery.back")}
            </button>
          </div>
          {err && <p className="error sm">{err}</p>}
        </section>
      </div>
    );
  }

  // --- collection view: code + two sponsor shards ----------------------------
  return (
    <div className="grid">
      <section className="card">
        <div className="name">{t("recovery.sponsor.title")}</div>
        <p className="muted sm">
          {t("recovery.sponsor.introPre")} <strong>{t("recovery.sponsor.introStrong")}</strong>{" "}
          {t("recovery.sponsor.introSuf")}
        </p>

        {step === "code" && (
          <>
            <p className="sm">
              <strong>{t("recovery.sponsor.step1Strong")}</strong> {t("recovery.sponsor.step1Rest")}
            </p>
            <div className="row">
              <input
                className="mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="btn btn-sm"
                onClick={() => {
                  setErr(null);
                  setStep("receive1");
                }}
                disabled={!code.trim()}
              >
                {t("recovery.sponsor.continueBtn")}
              </button>
            </div>
          </>
        )}

        {step === "receive1" && (
          <>
            <p className="sm">
              <strong>{t("recovery.sponsor.step2Strong")}</strong> {t("recovery.sponsor.step2Rest")}
            </p>
            <ShardReceive onPayload={onFirst} label={t("recovery.sponsor.receive1Label")} />
          </>
        )}

        {step === "receive2" && (
          <>
            <p className="sm">
              <strong>{t("recovery.sponsor.step3Strong")}</strong> {t("recovery.sponsor.step3Rest")}
            </p>
            <ShardReceive onPayload={onSecond} label={t("recovery.sponsor.receive2Label")} />
          </>
        )}

        {err && <p className="error sm">{err}</p>}
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm btn-ghost" onClick={onBack} disabled={busy}>
            {t("recovery.back")}
          </button>
        </p>
      </section>
    </div>
  );
}

// --- flow 3: cancel a pending recovery (member's existing device) ------------

function CancelFlow({
  pending,
  setPending,
  onBack,
}: {
  pending: RecoveryIntent | null;
  setPending: (p: RecoveryIntent | null) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const cancel = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      // The local cancellation: burn the collected shards in custody and forget
      // the intent. There is no explicit cancel helper in lib/recovery because
      // this IS the action — a purely local abort-and-burn in the off-chain
      // custody layer; nothing is emitted anywhere.
      await localShardCustody.burn(intentShardCode(pending.code, 1));
      await localShardCustody.burn(intentShardCode(pending.code, 2));
      clearPendingRecovery();
      setPending(null);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }, [pending, setPending]);

  return (
    <div className="grid">
      <section className="card">
        <div className="name">{t("recovery.cancel.title")}</div>
        {done ? (
          <p className="ok-note">
            {t("recovery.cancel.done")}
          </p>
        ) : pending ? (
          <>
            <p className="sm">
              {t("recovery.cancel.pendingPre")}{" "}
              <span className="mono">{new Date(pending.openedAt).toLocaleString()}</span>
              {windowElapsed(pending, now) ? (
                <> {t("recovery.cancel.elapsedSuf")}</>
              ) : (
                <> {t("recovery.cancel.remainPre")} {formatRemaining(pending.openedAt + pending.windowMs - now)} {t("recovery.cancel.remainSuf")}</>
              )}
            </p>
            <p className="muted sm">
              {t("recovery.cancel.warn")}
            </p>
            <button className="btn" onClick={cancel} disabled={busy}>
              {t("recovery.cancel.btn")}
            </button>
          </>
        ) : (
          <p className="muted sm">
            {t("recovery.cancel.none")}
          </p>
        )}
        <p style={{ marginTop: 10 }}>
          <button className="btn btn-sm btn-ghost" onClick={onBack} disabled={busy}>
            {t("recovery.back")}
          </button>
        </p>
      </section>
    </div>
  );
}

// --- success + mandatory burn-and-reissue ------------------------------------

function RecoveredPanel({
  masterRef,
  oldMemberCode,
  onDone,
}: {
  masterRef: React.MutableRefObject<Uint8Array | null>;
  oldMemberCode: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const [derivedOk, setDerivedOk] = useState<boolean | null>(null);
  const [stage, setStage] = useState<"prompt" | "sendA" | "sendB" | "finished">("prompt");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The two framed sponsor payloads for the fresh set. Strings (QR frames of
  // sealed blobs) — kept only until each handover confirms, then dropped.
  const payloadsRef = useRef<{ a: string; b: string } | null>(null);

  // Prove the restore worked: derive the two key seeds from the master, check
  // shape, and wipe them at once. They are never displayed or persisted here.
  useEffect(() => {
    let stopped = false;
    (async () => {
      const m = masterRef.current;
      if (!m) return;
      const { zkSecret, walletSeed } = await deriveFromMaster(m);
      const ok = zkSecret.length === 32 && walletSeed.length === 32;
      wipe(zkSecret, walletSeed);
      if (!stopped) setDerivedOk(ok);
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startReissue = useCallback(async () => {
    setErr(null);
    setBusy(true);
    let memberShard: Uint8Array | null = null;
    let sponsorA: Uint8Array | null = null;
    let sponsorB: Uint8Array | null = null;
    try {
      const m = masterRef.current;
      if (!m) throw new Error(t("recovery.done.errMasterGone"));
      // Cut a FRESH 2-of-3 set. The old shards are all stale from this moment.
      [memberShard, sponsorA, sponsorB] = await reshareMaster(m, splitMaster);
      const code = newOneTimeCode();
      // Seal the new set exactly as the ceremony does (shared lib/shardSeal):
      // member shard into custody under the new code, sponsor shards framed for
      // in-person handover. Nothing raw leaves this function.
      await localShardCustody.put(code, await sealShard("member", code, memberShard));
      if (oldMemberCode) await localShardCustody.burn(oldMemberCode); // old blob is stale — burn it
      payloadsRef.current = {
        a: encodeShardPayload(await sealShard("sponsor-1", code, sponsorA)),
        b: encodeShardPayload(await sealShard("sponsor-2", code, sponsorB)),
      };
      // Everything byte-shaped is now either in custody or framed for handover:
      // wipe the working buffers AND the master — it is not needed again.
      wipe(memberShard, sponsorA, sponsorB, m);
      masterRef.current = null;
      setNewCode(code);
      setStage("sendA");
    } catch (e: any) {
      wipe(memberShard, sponsorA, sponsorB);
      setErr(e?.message ?? t("recovery.done.errReissueFailed"));
    } finally {
      setBusy(false);
    }
  }, [masterRef, oldMemberCode, t]);

  return (
    <div className="grid">
      <section className="card">
        <div className="name">{t("recovery.done.title")}</div>
        <p className="ok-note">
          {t("recovery.done.restoredPre")}
          {derivedOk === true && t("recovery.done.restoredDeriveOk")}
          {derivedOk === false && t("recovery.done.restoredDeriveBad")}
          {". "}
          <strong>{t("recovery.done.restoredStrong")}</strong>
          {t("recovery.done.restoredSuf")}
        </p>
      </section>

      <section className="card">
        <div className="name">{t("recovery.done.reissueTitle")}</div>

        {stage === "prompt" && (
          <>
            <p className="sm">
              <strong>{t("recovery.done.reissueStrong")}</strong> {t("recovery.done.reissueRest")}
            </p>
            <button className="btn" onClick={startReissue} disabled={busy || derivedOk === false}>
              {t("recovery.done.cutBtn")}
            </button>
            {err && <p className="error sm">{err}</p>}
          </>
        )}

        {(stage === "sendA" || stage === "sendB") && (
          <>
            {newCode && (
              <p className="sm">
                {t("recovery.done.newCodePre")} <span className="mono">{newCode}</span>
              </p>
            )}
            <p className="muted sm">
              {t("recovery.done.staleNote")}
            </p>
            {stage === "sendA" && payloadsRef.current && (
              <ShardSend
                payload={payloadsRef.current.a}
                label={t("recovery.done.sendALabel")}
                onDone={() => setStage("sendB")}
              />
            )}
            {stage === "sendB" && payloadsRef.current && (
              <ShardSend
                payload={payloadsRef.current.b}
                label={t("recovery.done.sendBLabel")}
                onDone={() => {
                  payloadsRef.current = null;
                  setStage("finished");
                }}
              />
            )}
          </>
        )}

        {stage === "finished" && (
          <>
            <p className="ok-note">
              {t("recovery.done.finished")}
            </p>
            <button className="btn btn-sm" onClick={onDone}>
              {t("recovery.done.doneBtn")}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
