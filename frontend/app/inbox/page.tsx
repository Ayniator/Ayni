"use client";

// F32 — encrypted 1:1 Inbox. Messages are end-to-end encrypted to the
// recipient's wallet; decrypted only on click (one signature unlocks the
// session). Send to any address (that has enabled messaging). Optional expiry.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import { explorerTx } from "../../lib/member";
import { formatTime } from "../../lib/profile";
import {
  DecryptedMessage,
  InboxMessage,
  MAX_PLAINTEXT,
  SentRecord,
  appendSent,
  decryptMessage,
  deleteMessage,
  getSent,
  isRegistered,
  listInbox,
  markRead,
  registerMessagingKey,
  sendMessage,
} from "../../lib/messaging";
import {
  MailboxMessage,
  ackMailboxMessages,
  fetchMailboxMessages,
  publishMailboxBundle,
  recipientBundle,
  sendMailboxMessage,
} from "../../lib/mailbox";
import { useT } from "../../components/SettingsProvider";
import DevnetSignNote from "../../components/DevnetSignNote";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const when = (u: number) => formatTime(u);
const pk = (s: string) => { try { return new PublicKey(s.trim()); } catch { return null; } };
const EXPIRY = [{ d: 0, label: "Never" }, { d: 1, label: "1 day" }, { d: 7, label: "1 week" }, { d: 30, label: "30 days" }];

type Note = { kind: "ok" | "err"; text: string; sig?: string } | null;

export default function Inbox() {
  const t = useT();
  const { publicKey, connected, signMessage } = useWallet();
  const wallet = useAnchorWallet();
  const me = publicKey?.toBase58();

  const [registered, setRegistered] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<InboxMessage[] | null>(null);
  const [open, setOpen] = useState<Record<string, DecryptedMessage>>({}); // pubkey -> decrypted
  const [sent, setSent] = useState<(SentRecord & { expired: boolean })[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  // compose
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [expiryDays, setExpiryDays] = useState(0);

  const sign = signMessage as ((m: Uint8Array) => Promise<Uint8Array>) | undefined;

  const refresh = useCallback(() => {
    if (!me) return;
    isRegistered(me).then(setRegistered).catch(() => setRegistered(false));
    listInbox(me).then(setMsgs).catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
    setSent(getSent());
  }, [me]);
  useEffect(refresh, [refresh]);

  // Prefill the recipient from ?to=<address> (e.g. the ✉ button on /foundation).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("to");
    if (t) setTo(t);
  }, []);

  const visible = useMemo(() => (msgs ?? []).filter((m) => !m.expired), [msgs]);

  async function enable() {
    if (!wallet || !sign) return;
    setBusy("enable"); setNote(null);
    try {
      const sig = await registerMessagingKey(wallet, sign);
      // F63: also publish the off-chain prekey bundle, so mail to you can go
      // through the private mailbox instead of the chain. Best-effort.
      try { await publishMailboxBundle(wallet, sign); } catch { /* relay may be absent */ }
      setNote({ kind: "ok", text: t("inbox.note.messagingEnabled"), sig });
      setRegistered(true);
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  // --- F63 private mailbox (off-chain) ---
  const [mbx, setMbx] = useState<MailboxMessage[] | null>(null);
  async function checkMailbox() {
    if (!wallet || !sign) return;
    setBusy("mbx"); setNote(null);
    try {
      // Publishing (rotating) the bundle on check keeps the prekey fresh.
      try { await publishMailboxBundle(wallet, sign); } catch { /* best-effort */ }
      setMbx(await fetchMailboxMessages(wallet, sign));
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }
  async function clearMailbox() {
    if (!wallet || !sign || !mbx || mbx.length === 0) return;
    setBusy("mbxclear"); setNote(null);
    try {
      await ackMailboxMessages(wallet, sign, mbx.map((m) => m.id));
      setMbx([]);
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function reveal(m: InboxMessage) {
    if (!publicKey || !sign) return;
    setBusy(m.pubkey); setNote(null);
    try {
      const res = await decryptMessage(m, publicKey, sign);
      setOpen((o) => ({ ...o, [m.pubkey]: res }));
      markRead(m.pubkey);
      window.dispatchEvent(new Event("aha:inbox-read"));
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function send() {
    const r = pk(to);
    if (!r) return setNote({ kind: "err", text: t("inbox.note.invalidRecipient") });
    if (!text.trim()) return setNote({ kind: "err", text: t("inbox.note.writeMessage") });
    if (!wallet || !sign) return;
    setBusy("send"); setNote(null);
    try {
      const expiresAt = expiryDays ? Math.floor(Date.now() / 1000) + expiryDays * 86400 : 0;
      // F63 first: if the recipient has a mailbox bundle, the message goes
      // OFF-CHAIN — no recipient index, no public timestamp, no fee-payer.
      const bundle = await recipientBundle(r).catch(() => null);
      if (bundle) {
        await sendMailboxMessage(wallet, sign, r, text.trim(), expiresAt);
        appendSent({ to: r.toBase58(), text: text.trim(), ts: Math.floor(Date.now() / 1000), expiresAt, pubkey: "mailbox" });
        setNote({ kind: "ok", text: t("inbox.note.sentMailbox") });
      } else {
        const sig = await sendMessage(wallet, sign, r, text.trim(), expiresAt);
        setNote({ kind: "ok", text: t("inbox.note.sentOnchain"), sig });
      }
      setText(""); setTo("");
      setSent(getSent());
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function remove(m: InboxMessage) {
    if (!wallet) return;
    setBusy("del" + m.pubkey); setNote(null);
    try { await deleteMessage(wallet, new PublicKey(m.pubkey)); refresh(); }
    catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  return (
    <>
      <h1>{t("inbox.title")}</h1>
      <p className="lede">{t("msg.inbox.lede")}</p>

      {!connected && <div className="card"><p className="muted" style={{ margin: 0 }}>{t("inbox.connectPrompt")}</p></div>}

      {connected && (
        <>
          {registered === false && (
            <div className="card">
              <p style={{ marginTop: 0 }}>{t("msg.enable.intro")} <DevnetSignNote /></p>
              <button className="btn btn-sm" onClick={enable} disabled={busy === "enable"}>{busy === "enable" ? t("msg.enable.busy") : t("msg.enable.button")}</button>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("inbox.compose.title")}</h3>
            <div className="form-row col"><label>{t("inbox.compose.toLabel")}</label>
              <input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t("inbox.compose.toPlaceholder")} /></div>
            <div className="form-row col"><label>{t("inbox.compose.messageLabel")}</label>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_PLAINTEXT} placeholder={t("inbox.compose.messagePlaceholder")} />
              <span className="muted sm">{text.length}/{MAX_PLAINTEXT} · {t("inbox.compose.meta")}</span></div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <label className="sm muted">{t("inbox.compose.expiresLabel")}
                <select value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))} style={{ marginLeft: 6 }}>
                  {EXPIRY.map((x) => <option key={x.d} value={x.d}>{t(x.d === 0 ? "inbox.expiry.never" : x.d === 1 ? "inbox.expiry.oneDay" : x.d === 7 ? "inbox.expiry.oneWeek" : "inbox.expiry.thirtyDays")}</option>)}
                </select>
              </label>
              <button className="btn btn-sm" onClick={send} disabled={busy === "send"}>{busy === "send" ? t("inbox.compose.sending") : t("inbox.compose.send")}</button>
            </div>
          </div>

          {note && <p className={note.kind === "err" ? "error" : "ok-note"}>{note.text}{note.sig && <> · <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">tx</a></>}</p>}

          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>{t("inbox.mailbox.title")} <span className="muted sm">{t("inbox.mailbox.offchain")}</span></h3>
            <p className="muted sm" style={{ marginTop: 0 }}>
              {t("msg.inbox.metadata")}
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={checkMailbox} disabled={busy === "mbx"}>{busy === "mbx" ? t("inbox.mailbox.checking") : t("inbox.mailbox.check")}</button>
              {mbx && mbx.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={clearMailbox} disabled={busy === "mbxclear"}>{busy === "mbxclear" ? t("inbox.mailbox.clearing") : t("inbox.mailbox.clearAll")}</button>
              )}
            </div>
            {mbx !== null && mbx.length === 0 && <p className="muted sm" style={{ marginBottom: 0 }}>{t("inbox.mailbox.empty")}</p>}
            {mbx !== null && mbx.length > 0 && (
              <div className="members" style={{ marginTop: 10 }}>
                {mbx.filter((m) => !m.expired).map((m) => (
                  <div className="member" key={m.id} style={{ alignItems: "flex-start" }}>
                    <Identicon seed={m.from ?? m.id} size={34} />
                    <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                      <div className="name mono">
                        {m.from
                          ? <>{short(m.from)} <span className="badge badge-alt" title={t("inbox.badge.verifiedTitle")}>{t("inbox.badge.verified")}</span></>
                          : <span className="badge" title={t("inbox.badge.unverifiedTitle")}>{t("inbox.badge.unverified")}</span>}
                      </div>
                      <div className="sub">{when(m.ts)}</div>
                      <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{m.text}</p>
                      {m.from && (
                        <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => { setTo(m.from!); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("inbox.reply")}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h3 style={{ margin: "18px 0 6px" }}>{t("inbox.received.title")} <span className="muted sm">{t("inbox.received.legacy")}</span></h3>
          {msgs === null && <p className="muted">{t("inbox.loading")}</p>}
          {msgs !== null && visible.length === 0 && <p className="muted">{t("inbox.noMessages")}</p>}
          <div className="members">
            {visible.map((m) => {
              const dec = open[m.pubkey];
              return (
                <div className="member" key={m.pubkey} style={{ alignItems: "flex-start" }}>
                  <Identicon seed={dec?.from ?? m.pubkey} size={34} />
                  <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                    <div className="name mono">
                      {dec
                        ? (dec.from
                            ? <>{short(dec.from)} <span className="badge badge-alt" title={t("inbox.badge.verifiedTitle")}>{t("inbox.badge.verified")}</span></>
                            : <span className="badge" title={t("inbox.badge.unverifiedTitle")}>{t("inbox.badge.unverified")}</span>)
                        : <span className="muted">{t("inbox.sealedSender")}</span>}
                    </div>
                    <div className="sub">{when(m.createdAt)}{m.expiresAt ? ` · ${t("inbox.expiresLabel")} ${when(m.expiresAt)}` : ""}</div>
                    {dec ? (
                      <>
                        <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{dec.text}</p>
                        {dec.from && (
                          <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => { setTo(dec.from!); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("inbox.reply")}</button>
                        )}
                      </>
                    ) : (
                      <button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy === m.pubkey} onClick={() => reveal(m)}>
                        {busy === m.pubkey ? t("inbox.decrypting") : t("inbox.decrypt")}
                      </button>
                    )}
                  </div>
                  <button className="btn btn-sm btn-ghost" disabled={busy === "del" + m.pubkey} onClick={() => remove(m)}>{t("inbox.delete")}</button>
                </div>
              );
            })}
          </div>

          {sent.filter((s) => !s.expired).length > 0 && (
            <>
              <h3 style={{ margin: "18px 0 6px" }}>{t("inbox.sent.title")} <span className="muted sm">{t("inbox.sent.thisDevice")}</span></h3>
              <div className="members">
                {sent.filter((s) => !s.expired).map((s) => (
                  <div className="member" key={s.pubkey} style={{ alignItems: "flex-start" }}>
                    <Identicon seed={s.to} size={34} />
                    <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                      <div className="name mono">→ {short(s.to)}</div>
                      <div className="sub">{when(s.ts)}{s.expiresAt ? ` · ${t("inbox.expiresLabel")} ${when(s.expiresAt)}` : ""}</div>
                      <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{s.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="muted sm">{t("inbox.sent.note")}</p>
            </>
          )}
        </>
      )}
    </>
  );
}
