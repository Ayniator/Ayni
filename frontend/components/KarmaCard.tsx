"use client";

// F98 / F100 — the karma box on /me.
//
// WHAT THIS SHOWS AND WHY IT IS SHOWN AT ALL. Karma ranks members, which every
// other counter in this project is forbidden from doing; it exists because the
// user waived that rule in writing (CLAUDE.md, 2026-08-15). A Karma account
// derives from a membership commitment and commitments are already enumerable,
// so anyone can already read anyone's total — displaying a Circle's karma
// surfaces what the chain was never hiding rather than disclosing something new.
// The card says so plainly, because a member should learn that from the app
// before they learn it from someone else.
//
// Members are shown by an identicon drawn from their commitment plus the first
// 8 hex characters, never by wallet: the commitment is the anonymous identity
// this whole program is built around, and putting a wallet address next to a
// score would undo it. The mark carries the recognition (a coin is read at a
// glance; 64 hex characters are not) and the 8 characters stay only so two
// members can confirm a code out loud. The full commitment is never rendered —
// not as text, not as a tooltip — so a screenshot of this card cannot hand over
// anyone's whole identity.

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "./Identicon";
import { useT } from "./SettingsProvider";
import { MyMembership } from "../lib/member";
import { listCircleMembers } from "../lib/admin";
import {
  GiftRow,
  KarmaPolicy,
  getKarmaPolicy,
  giveKarma,
  karmaFor,
  listGifts,
  reclaimKarma,
} from "../lib/karma";

type Row = { commitment: string; points: number; isMe: boolean };

const short = (c: string) => c.slice(0, 8) + "…";

// One member, one mark. `title` is passed explicitly on every Identicon here
// because the component defaults its tooltip to the seed — which would put the
// whole 64-hex commitment one hover (and one screenshot) away.
function Mark({ commitment, label }: { commitment: string; label: string }) {
  return (
    <span className="mono">
      <Identicon seed={commitment} size={18} className="inline-icon" title={label} />
      {short(commitment)}
    </span>
  );
}

export default function KarmaCard({
  wallet,
  memberships,
}: {
  wallet: any;
  memberships: MyMembership[];
}) {
  const t = useT();
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [policy, setPolicy] = useState<Record<string, KarmaPolicy>>({});
  const [gifts, setGifts] = useState<Record<string, { given: GiftRow[]; received: GiftRow[] }>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(() => {
    for (const m of memberships) {
      (async () => {
        const pol = await getKarmaPolicy(m.circle);
        setPolicy((p) => ({ ...p, [m.circle]: pol }));

        const members = await listCircleMembers(m.circle).catch(() => []);
        const commitments = members.filter((x) => x.active).map((x) => x.commitment);
        if (!commitments.includes(m.commitment)) commitments.push(m.commitment);

        const points: Record<string, number> = await karmaFor(m.circle, commitments).catch(
          () => ({} as Record<string, number>)
        );
        const list: Row[] = commitments
          .map((c) => ({ commitment: c, points: points[c] ?? 0, isMe: c === m.commitment }))
          // Highest first — the whole point of a ranking is that it is ordered,
          // and pretending otherwise while still showing the numbers would be
          // coy rather than kind.
          .sort((a, b) => b.points - a.points || a.commitment.localeCompare(b.commitment));
        setRows((p) => ({ ...p, [m.circle]: list }));

        const g = await listGifts(m.circle, m.commitment, commitments, pol.giftReturnSecs).catch(
          () => ({ given: [], received: [] })
        );
        setGifts((p) => ({ ...p, [m.circle]: g }));
      })().catch(() => {});
    }
  }, [memberships]);
  useEffect(load, [load]);

  async function send(m: MyMembership) {
    const to = pick[m.circle];
    const raw = Number(amount[m.circle]);
    if (!wallet || !to) return;
    if (!Number.isFinite(raw) || raw <= 0) {
      setNote({ kind: "err", text: t("me.karma.errAmount") });
      return;
    }
    setBusy("give-" + m.circle);
    setNote(null);
    try {
      await giveKarma(wallet, new PublicKey(m.circle), m.commitment, to, Math.floor(raw));
      setNote({ kind: "ok", text: t("me.karma.sent") });
      setAmount((p) => ({ ...p, [m.circle]: "" }));
      setPick((p) => ({ ...p, [m.circle]: "" }));
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function takeBack(m: MyMembership, g: GiftRow) {
    if (!wallet) return;
    setBusy("back-" + g.other);
    setNote(null);
    try {
      await reclaimKarma(wallet, new PublicKey(m.circle), m.commitment, g.other);
      setNote({ kind: "ok", text: t("me.karma.reclaimed") });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  if (memberships.length === 0) return null;
  const now = Date.now() / 1000;
  const mark = t("me.spon.anonMark");
  const days = (secs: number) => Math.round(secs / 86400);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.karma.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>{t("me.karma.lede")}</p>

      {memberships.map((m) => {
        const list = rows[m.circle] ?? [];
        const pol = policy[m.circle];
        const mine = list.find((r) => r.isMe);
        const g = gifts[m.circle] ?? { given: [], received: [] };
        const outstanding = g.given.filter((x) => !x.returned);
        const canGiveTo = list.filter(
          (r) => !r.isMe && !g.given.some((x) => x.other === r.commitment)
        );

        return (
          <div key={m.pubkey} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div className="name">{m.circleName}</div>

            {/* Your own total, stated first and plainly. */}
            <div className="sub" style={{ marginTop: 4 }}>
              <strong style={{ fontSize: "1.4rem" }}>{mine ? mine.points : 0}</strong>{" "}
              {t("me.karma.yours")}
            </div>

            {/* The Circle's members and their karma. */}
            {list.length > 1 && (
              <div className="sub" style={{ marginTop: 8 }}>
                <div className="muted" style={{ marginBottom: 4 }}>{t("me.karma.circleTitle")}</div>
                {list.slice(0, 25).map((r) => (
                  <div key={r.commitment} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                    <span>
                      <Mark commitment={r.commitment} label={mark} />
                      {r.isMe ? ` (${t("me.karma.you")})` : ""}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.points}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Thank someone. */}
            {canGiveTo.length > 0 && (
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                {/* A native <option> cannot hold an image, so the picker keeps
                    the short code and the chosen member's mark is drawn beside
                    the control — the one place it matters, because sending karma
                    to the wrong person is the mistake a row of look-alike hex
                    invites. */}
                {pick[m.circle] && (
                  <Identicon seed={pick[m.circle]} size={22} title={mark} />
                )}
                <select
                  value={pick[m.circle] ?? ""}
                  onChange={(e) => setPick((p) => ({ ...p, [m.circle]: e.target.value }))}
                  style={{ flex: 1, minWidth: 160 }}
                  aria-label={t("me.karma.chooseMember")}
                >
                  <option value="">{t("me.karma.chooseMember")}</option>
                  {canGiveTo.map((r) => (
                    <option key={r.commitment} value={r.commitment}>{short(r.commitment)}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={pol?.maxGift ?? 100}
                  value={amount[m.circle] ?? ""}
                  onChange={(e) => setAmount((p) => ({ ...p, [m.circle]: e.target.value }))}
                  placeholder={String(pol?.maxGift ?? 100)}
                  style={{ width: 90 }}
                  aria-label={t("me.karma.amount")}
                />
                <button
                  className="btn btn-sm"
                  disabled={busy === "give-" + m.circle || !pick[m.circle]}
                  onClick={() => send(m)}
                >
                  {busy === "give-" + m.circle ? t("me.sending") : t("me.karma.give")}
                </button>
              </div>
            )}

            {/* What this costs you, in the Circle's own numbers. */}
            {pol && (
              <p className="muted sm" style={{ margin: "6px 0 0" }}>
                {t("me.karma.rule")
                  .replace("{max}", String(pol.maxGift))
                  .replace("{days}", String(days(pol.giftReturnSecs)))}
              </p>
            )}

            {/* Gifts still out of your balance. */}
            {outstanding.length > 0 && (
              <div className="sub" style={{ marginTop: 8 }}>
                <div className="muted" style={{ marginBottom: 4 }}>{t("me.karma.outTitle")}</div>
                {outstanding.map((x) => {
                  const ready = now >= x.returnableAt;
                  return (
                    <div key={x.other} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <Mark commitment={x.other} label={mark} />
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{x.amount}</span>
                      {ready ? (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={busy === "back-" + x.other}
                          onClick={() => takeBack(m, x)}
                        >
                          {busy === "back-" + x.other ? "…" : t("me.karma.takeBack")}
                        </button>
                      ) : (
                        <span className="muted">
                          {t("me.karma.backOn")} {new Date(x.returnableAt * 1000).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Thanks you have received — kept, not borrowed. */}
            {g.received.length > 0 && (
              <div className="sub" style={{ marginTop: 8 }}>
                <div className="muted" style={{ marginBottom: 4 }}>{t("me.karma.inTitle")}</div>
                {g.received.map((x) => (
                  <div key={x.other} className="row" style={{ gap: 8 }}>
                    <Mark commitment={x.other} label={mark} />
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{x.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {note && (
        <p className={note.kind === "err" ? "error" : "ok-note"} style={{ marginBottom: 0 }}>
          {note.text}
        </p>
      )}

      {/* Said in the app, not only in the docs. */}
      <p className="muted sm" style={{ marginBottom: 0 }}>{t("me.karma.public")}</p>
    </div>
  );
}
