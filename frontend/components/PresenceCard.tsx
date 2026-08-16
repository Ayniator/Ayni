"use client";

// F59 — the presence ceremony on /me: "last stood in circle: March 2026".
//
// TWO DEVICES, TWO ROLES, ONE TRANSACTION. The subject's secret and the
// witness's secret never share a device, so the attestation is a handoff: the
// subject generates a consent code (their proof, for one closed month) and
// shows it as a QR; the witness scans or pastes it, adds their own membership
// proof under the same external nullifier, and submits both in one transaction.
//
// WORDING IS LOAD-BEARING. Everything here says "vouched" — two members
// attested the month. Nothing may say attendance was "verified", because the
// chain cannot know who stood in a room (docs/presence.md §2).
//
// WHAT THE HANDOFF DISCLOSES, said before the tap: the code carries the
// subject's raw commitment — the public pseudonym their trust page, quipu and
// karma already hang off. For a member who has kept their wallet unbound this
// may be the first artifact that ever forces the commitment into another
// member's hands, so the UI says it in words rather than letting them find out.
//
// Erasing is one-sided and one-proof (the subject alone), and the display rule
// is the same as the trust page: a month, or nothing — never a "not yet
// attested" placeholder, because an absent record and a member who never
// attested must be indistinguishable.

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useT } from "./SettingsProvider";
import { MyMembership } from "../lib/member";
import {
  SubjectHandoff,
  canProveFor,
  clearMyPresence,
  decodeHandoff,
  encodeHandoff,
  getPresence,
  lastClosedMonthIndex,
  monthLabel,
  subjectConsentPayload,
  witnessCompleteAttestation,
} from "../lib/presence";

export default function PresenceCard({
  wallet,
  memberships,
}: {
  wallet: any;
  memberships: MyMembership[];
}) {
  const t = useT();
  const [mine, setMine] = useState<Record<string, number | null>>({});
  const [qr, setQr] = useState<{ circle: string; img: string; code: string } | null>(null);
  const [paste, setPaste] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(() => {
    for (const m of memberships) {
      getPresence(m.circle, m.commitment)
        .then((v) => setMine((p) => ({ ...p, [m.circle]: v })))
        .catch(() => {});
    }
  }, [memberships]);
  useEffect(load, [load]);

  // SUBJECT: produce the consent code for the last closed month.
  async function makeCode(m: MyMembership) {
    setBusy("code-" + m.circle);
    setNote(null);
    try {
      const payload = await subjectConsentPayload(m.circle, m.commitment, lastClosedMonthIndex());
      const code = encodeHandoff(payload);
      let img = "";
      try {
        img = await QRCode.toDataURL(code, { width: 260, margin: 1 });
      } catch {
        /* the copyable code below still works when the QR is too dense to draw */
      }
      setQr({ circle: m.circle, img, code });
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  // WITNESS: complete a pasted code with our own proof and submit.
  async function vouch(m: MyMembership) {
    const raw = (paste[m.circle] ?? "").trim();
    if (!raw || !wallet) return;
    setBusy("vouch-" + m.circle);
    setNote(null);
    try {
      const payload: SubjectHandoff = decodeHandoff(raw);
      if (payload.circle !== m.circle) {
        throw new Error(t("me.presence.errWrongCircle"));
      }
      const r = await witnessCompleteAttestation(wallet, payload, m.commitment);
      setNote({
        kind: "ok",
        text: r.relayed ? t("me.presence.vouched") : t("me.presence.vouchedSelfPaid"),
      });
      setPaste((p) => ({ ...p, [m.circle]: "" }));
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function erase(m: MyMembership) {
    if (!wallet) return;
    if (!window.confirm(t("me.presence.confirmErase"))) return;
    setBusy("erase-" + m.circle);
    setNote(null);
    try {
      await clearMyPresence(wallet, m.circle, m.commitment);
      setNote({ kind: "ok", text: t("me.presence.erased") });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  if (memberships.length === 0) return null;
  const provable = memberships.filter((m) => canProveFor(m.commitment));
  if (provable.length === 0) return null; // this device cannot prove — say nothing rather than dangle dead buttons

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.presence.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>{t("me.presence.lede")}</p>

      {provable.map((m) => {
        const have = mine[m.circle];
        return (
          <div key={m.pubkey} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div className="name">{m.circleName}</div>

            {/* A month, or nothing — the same rule as the trust page. */}
            {typeof have === "number" && (
              <div className="sub" style={{ marginTop: 4 }}>
                {t("me.presence.lastStood")} <strong>{monthLabel(have)}</strong>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginLeft: 8 }}
                  disabled={busy === "erase-" + m.circle}
                  onClick={() => erase(m)}
                >
                  {busy === "erase-" + m.circle ? "…" : t("me.presence.erase")}
                </button>
              </div>
            )}

            {/* Subject half. */}
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn-sm"
                disabled={busy === "code-" + m.circle}
                onClick={() => makeCode(m)}
              >
                {busy === "code-" + m.circle ? "…" : t("me.presence.makeCode")}
              </button>
              <span className="muted sm">{monthLabel(lastClosedMonthIndex())}</span>
            </div>

            {qr && qr.circle === m.circle && (
              <div className="sub" style={{ marginTop: 8 }}>
                {/* Said BEFORE the handoff, not after: the code contains the
                    member's public commitment (docs/presence.md §4.5). */}
                <p className="muted sm" style={{ margin: "0 0 6px" }}>{t("me.presence.handoffWarn")}</p>
                {qr.img && (
                  <div style={{ background: "#fff", padding: 8, borderRadius: 8, width: "fit-content" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr.img} alt={t("me.presence.makeCode")} width={220} height={220} />
                  </div>
                )}
                <textarea
                  className="mono"
                  readOnly
                  value={qr.code}
                  onFocus={(e) => e.currentTarget.select()}
                  rows={3}
                  style={{ width: "100%", marginTop: 6, fontSize: 11 }}
                />
              </div>
            )}

            {/* Witness half. */}
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <input
                className="mono"
                value={paste[m.circle] ?? ""}
                onChange={(e) => setPaste((p) => ({ ...p, [m.circle]: e.target.value }))}
                placeholder={t("me.presence.pastePlaceholder")}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button
                className="btn btn-sm"
                disabled={busy === "vouch-" + m.circle || !(paste[m.circle] ?? "").trim()}
                onClick={() => vouch(m)}
              >
                {busy === "vouch-" + m.circle ? t("me.sending") : t("me.presence.vouch")}
              </button>
            </div>
          </div>
        );
      })}

      {note && (
        <p className={note.kind === "err" ? "error" : "ok-note"} style={{ marginBottom: 0 }}>
          {note.text}
        </p>
      )}

      {/* The residual, in the app rather than only in the docs: the record is
          month-coarse, and erasing clears live state while the ledger keeps the
          fact that writes happened (accepted risk, docs/presence.md §1). */}
      <p className="muted sm" style={{ marginBottom: 0 }}>{t("me.presence.residual")}</p>
    </div>
  );
}
