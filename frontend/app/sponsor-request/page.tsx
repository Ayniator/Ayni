"use client";

// F97 — the landing page for a sponsorship invitation, in both directions.
//
// A member shares a QR code (or link) from their /me Sponsors & Sponsees card.
// It carries only two PUBLIC values: the Circle address and a membership
// commitment — the same commitment already printed on that member's trust
// page. Nothing secret travels in the link.
//
// WHAT ACCEPTING DOES, and why it is this direction. On chain, a WingPeer link
// is written by the MENTEE — "a member sets their own wing, never imposed"
// (establish_wing_peer.rs). So the person who ACCEPTS here is the sponsee, and
// accepting calls establishWingPeer(circle, mentee=me, wing=inviter): the
// inviter becomes my sponsor. That is the only direction a single tap can
// complete, because only my own signature can name my sponsor.
//
// THE REVERSE DIRECTION (?mode=ask&from=…) — "I am looking for a sponsor".
// Because the chain only accepts the mentee's own signature, a member reaching
// UP for a sponsor cannot be served by one tap; it takes a two-hop handshake,
// built entirely out of the existing call:
//
//   hop 1  the seeker shares ?circle=…&from=<their commitment>&mode=ask
//   hop 2  a willing member opens it and gets back the ORDINARY invitation
//          ?circle=…&to=<their own commitment>, which they send to the seeker
//          — who accepts it and, with their own signature, becomes the sponsee.
//
// THE ASK PAGE WRITES NOTHING ON CHAIN. It reads (to tell the opener whether
// they are a member of the Circle) and it draws a QR locally; there is no
// transaction on this path at all. Deliberate: an unanswered request must leave
// no trace, and consent must be signed by the person it binds — the seeker.
//
// Compassionate wording throughout: "Accept this Link" / "Not at this time",
// and neither declining nor ignoring a request records anything.

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useT } from "../../components/SettingsProvider";
import { MyMembership, findMyMemberships, listCircles, type CircleInfo } from "../../lib/member";
import { establishWingPeer, getWingPeer } from "../../lib/peers";

type Phase = "loading" | "bad" | "ready" | "done" | "declined";
// "invite": someone offers to sponsor the opener (?to=…).
// "ask":    someone is looking for a sponsor and the opener may become one
//           (?from=…&mode=ask). See the header comment for the handshake.
type Mode = "invite" | "ask";

export default function SponsorRequest() {
  const t = useT();
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();

  const [circle, setCircle] = useState<string | null>(null);
  // The other party's commitment: the inviter in "invite" mode, the seeker in
  // "ask" mode. One value either way — only its meaning changes.
  const [peer, setPeer] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("invite");
  const [circleName, setCircleName] = useState<string>("");
  const [mine, setMine] = useState<MyMembership | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [alreadySponsor, setAlreadySponsor] = useState(false);
  // "ask" mode only: the seeker already names me as their sponsor.
  const [alreadySponsee, setAlreadySponsee] = useState(false);
  // "ask" mode only: the return invitation, revealed once I say I am willing.
  const [ret, setRet] = useState<{ url: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Parse the link after mount (window.location is client-only, and reading it
  // during render would trip hydration).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get("circle");
    const asking = p.get("mode") === "ask";
    const x = asking ? p.get("from") : p.get("to");
    const hex = /^[0-9a-fA-F]{64}$/;
    if (!c || !x || !hex.test(x)) { setPhase("bad"); return; }
    try { new PublicKey(c); } catch { setPhase("bad"); return; }
    setCircle(c); setPeer(x.toLowerCase()); setMode(asking ? "ask" : "invite");
    // A valid link is immediately presentable even with no wallet: show the
    // intro and the connect prompt. Connecting later refines this via
    // resolveMine (which finds my membership and the accept/decline controls).
    setPhase("ready");
    listCircles()
      .then((all: CircleInfo[]) => setCircleName(all.find((k) => k.pubkey === c)?.name ?? ""))
      .catch(() => {});
  }, []);

  // Once a wallet is connected, find my membership in this Circle — in either
  // direction the link only means something to a member of it.
  const resolveMine = useCallback(async () => {
    if (!circle || !peer || !publicKey) return;
    setPhase("loading"); setError("");
    try {
      const memberships = await findMyMemberships(publicKey, []);
      const here = memberships.find((m) => m.circle === circle && m.active) ?? null;
      setMine(here);
      if (here && mode === "invite") {
        const w = await getWingPeer(circle, here.commitment).catch(() => null);
        setAlreadySponsor(Boolean(w && w.active && w.wing === peer));
      }
      if (here && mode === "ask") {
        // Read the SEEKER's wing: if it is already me, the handshake is done
        // and sending another invitation would only confuse them.
        const w = await getWingPeer(circle, peer).catch(() => null);
        setAlreadySponsee(Boolean(w && w.active && w.wing === here.commitment));
      }
      setPhase("ready");
    } catch (e: any) {
      setError(String(e?.message || e));
      setPhase("ready");
    }
  }, [circle, peer, publicKey, mode]);

  useEffect(() => { if (connected && publicKey) resolveMine(); }, [connected, publicKey, resolveMine]);

  async function accept() {
    if (!wallet || !circle || !peer || !mine) return;
    setBusy(true); setError("");
    try {
      await establishWingPeer(wallet, new PublicKey(circle), mine.commitment, peer);
      setPhase("done");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setBusy(false); }
  }

  // "I am willing" — hop 2 of the handshake. This only assembles MY ordinary
  // invitation link and draws its QR locally; no wallet signature, no network
  // call, nothing on chain. The seeker is the one who signs, when they accept.
  async function willing() {
    if (!circle || !mine) return;
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const p = new URLSearchParams({ circle, to: mine.commitment });
    const url = `${origin}/sponsor-request?${p.toString()}`;
    let qr = "";
    try {
      qr = await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: "#111111", light: "#ffffff" } });
    } catch { /* the copyable link still works if the QR cannot draw */ }
    setRet({ url, qr });
  }

  async function copyReturn() {
    if (!ret) return;
    setError("");
    try {
      await navigator.clipboard.writeText(ret.url);
      setCopied(true);
    } catch (e: any) { setError(String(e?.message || e)); }
  }

  const selfInvite = mine && peer && mine.commitment === peer;
  const ask = mode === "ask";

  return (
    <>
      <h1>{ask ? t("sponreq.askTitle") : t("sponreq.title")}</h1>

      {phase === "loading" && <p className="lede">{t("sponreq.loading")}</p>}

      {phase === "bad" && (
        <div className="card"><p className="error" style={{ margin: 0 }}>{t("sponreq.badLink")}</p></div>
      )}

      {phase !== "bad" && phase !== "loading" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="lede" style={{ margin: 0 }}>{ask ? t("sponreq.askIntro") : t("sponreq.intro")}</p>

          <div className="sub">
            {/* Members are named by their public membership commitment — never
                by a wallet address. */}
            <div>{ask ? t("sponreq.asker") : t("sponreq.inviter")}: <span className="mono">{peer?.slice(0, 8)}…</span></div>
            {circleName && <div>{t("sponreq.circle")}: {circleName}</div>}
          </div>

          {!connected && <p className="muted">{ask ? t("sponreq.askConnectFirst") : t("sponreq.connectFirst")}</p>}

          {connected && phase === "ready" && !mine && (
            <p className="muted">{ask ? t("sponreq.askNotMember") : t("sponreq.notMember")}</p>
          )}

          {connected && phase === "ready" && mine && selfInvite && (
            <p className="muted">{ask ? t("sponreq.askSelf") : t("sponreq.selfInvite")}</p>
          )}

          {/* ---- invite direction: I may accept this member as my sponsor ---- */}
          {!ask && connected && phase === "ready" && mine && !selfInvite && alreadySponsor && (
            <p className="ok-note" style={{ margin: 0 }}>{t("sponreq.alreadySponsor")}</p>
          )}

          {!ask && connected && phase === "ready" && mine && !selfInvite && !alreadySponsor && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" disabled={busy} onClick={accept}>
                {busy ? t("sponreq.accepting") : t("sponreq.accept")}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setPhase("declined")}>
                {t("sponreq.decline")}
              </button>
            </div>
          )}

          {/* ---- ask direction: I may offer, by handing back my own invitation ---- */}
          {ask && connected && phase === "ready" && mine && !selfInvite && alreadySponsee && (
            <p className="ok-note" style={{ margin: 0 }}>{t("sponreq.askAlreadySponsee")}</p>
          )}

          {ask && connected && phase === "ready" && mine && !selfInvite && !alreadySponsee && !ret && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={willing}>{t("sponreq.willing")}</button>
              <button className="btn btn-ghost" onClick={() => setPhase("declined")}>
                {t("sponreq.decline")}
              </button>
            </div>
          )}

          {ask && ret && (
            <div className="mw-notice" role="dialog" aria-modal="true" aria-label={t("sponreq.returnTitle")}>
              <div className="mw-notice-body">
                <strong>{t("sponreq.returnTitle")}</strong>
                <p className="sm" style={{ margin: "4px 0" }}>{t("sponreq.returnHelp")}</p>
                {ret.qr && (
                  <div style={{ background: "#fff", padding: 8, borderRadius: 8, width: "fit-content" }}>
                    {/* Drawn locally from the link; no network involved. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ret.qr} alt={t("sponreq.returnTitle")} width={200} height={200} />
                  </div>
                )}
                <input className="mono" readOnly value={ret.url} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%", marginTop: 8 }} />
                {copied && <p className="ok-note" style={{ margin: "6px 0 0" }}>{t("sponreq.returnCopied")}</p>}
              </div>
              <div className="mw-notice-actions">
                <button className="btn btn-sm" onClick={copyReturn}>{t("sponreq.copyReturn")}</button>
              </div>
            </div>
          )}

          {phase === "done" && <p className="ok-note" style={{ margin: 0 }}>{t("sponreq.accepted")}</p>}
          {phase === "declined" && <p className="muted" style={{ margin: 0 }}>{ask ? t("sponreq.askDeclined") : t("sponreq.declined")}</p>}

          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

          {(phase === "done" || phase === "declined") && (
            <p style={{ margin: 0 }}><a href="/me">{t("sponreq.backToMe")}</a></p>
          )}
        </div>
      )}
    </>
  );
}
