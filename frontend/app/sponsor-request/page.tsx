"use client";

// F97 — the landing page for a sponsorship invitation.
//
// A member shares a QR code (or link) from their /me Sponsors & Sponsees card.
// It carries only two PUBLIC values: the Circle address and the inviter's
// membership commitment — the same commitment already printed on their trust
// page. Nothing secret travels in the link.
//
// WHAT ACCEPTING DOES, and why it is this direction. On chain, a WingPeer link
// is written by the MENTEE — "a member sets their own wing, never imposed"
// (establish_wing_peer.rs). So the person who ACCEPTS here is the sponsee, and
// accepting calls establishWingPeer(circle, mentee=me, wing=inviter): the
// inviter becomes my sponsor. That is the only direction a single tap can
// complete, because only my own signature can name my sponsor. A member who
// instead wants to reach UP for a sponsor of their own does that from /me by
// pasting the sponsor's code — the reverse-direction QR (I ask someone above me
// to sponsor me, they accept) needs a two-way handshake and is tracked in F97.
//
// Compassionate wording throughout: "Accept this Link" / "Not at this time",
// and declining records nothing.

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useT } from "../../components/SettingsProvider";
import { MyMembership, findMyMemberships, listCircles, type CircleInfo } from "../../lib/member";
import { establishWingPeer, getWingPeer } from "../../lib/peers";

type Phase = "loading" | "bad" | "ready" | "done" | "declined";

export default function SponsorRequest() {
  const t = useT();
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();

  const [circle, setCircle] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [circleName, setCircleName] = useState<string>("");
  const [mine, setMine] = useState<MyMembership | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [alreadySponsor, setAlreadySponsor] = useState(false);

  // Parse the link after mount (window.location is client-only, and reading it
  // during render would trip hydration).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get("circle");
    const x = p.get("to");
    const hex = /^[0-9a-fA-F]{64}$/;
    if (!c || !x || !hex.test(x)) { setPhase("bad"); return; }
    try { new PublicKey(c); } catch { setPhase("bad"); return; }
    setCircle(c); setTo(x.toLowerCase());
    // A valid link is immediately presentable even with no wallet: show the
    // intro and the connect prompt. Connecting later refines this via
    // resolveMine (which finds my membership and the accept/decline controls).
    setPhase("ready");
    listCircles()
      .then((all: CircleInfo[]) => setCircleName(all.find((k) => k.pubkey === c)?.name ?? ""))
      .catch(() => {});
  }, []);

  // Once a wallet is connected, find my membership in this Circle — I can only
  // accept if I am a member of it.
  const resolveMine = useCallback(async () => {
    if (!circle || !to || !publicKey) return;
    setPhase("loading"); setError("");
    try {
      const memberships = await findMyMemberships(publicKey, []);
      const here = memberships.find((m) => m.circle === circle && m.active) ?? null;
      setMine(here);
      if (here) {
        const w = await getWingPeer(circle, here.commitment).catch(() => null);
        setAlreadySponsor(Boolean(w && w.active && w.wing === to));
      }
      setPhase("ready");
    } catch (e: any) {
      setError(String(e?.message || e));
      setPhase("ready");
    }
  }, [circle, to, publicKey]);

  useEffect(() => { if (connected && publicKey) resolveMine(); }, [connected, publicKey, resolveMine]);

  async function accept() {
    if (!wallet || !circle || !to || !mine) return;
    setBusy(true); setError("");
    try {
      await establishWingPeer(wallet, new PublicKey(circle), mine.commitment, to);
      setPhase("done");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setBusy(false); }
  }

  const selfInvite = mine && to && mine.commitment === to;

  return (
    <>
      <h1>{t("sponreq.title")}</h1>

      {phase === "loading" && <p className="lede">{t("sponreq.loading")}</p>}

      {phase === "bad" && (
        <div className="card"><p className="error" style={{ margin: 0 }}>{t("sponreq.badLink")}</p></div>
      )}

      {phase !== "bad" && phase !== "loading" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="lede" style={{ margin: 0 }}>{t("sponreq.intro")}</p>

          <div className="sub">
            <div>{t("sponreq.inviter")}: <span className="mono">{to?.slice(0, 8)}…</span></div>
            {circleName && <div>{t("sponreq.circle")}: {circleName}</div>}
          </div>

          {!connected && <p className="muted">{t("sponreq.connectFirst")}</p>}

          {connected && phase === "ready" && !mine && (
            <p className="muted">{t("sponreq.notMember")}</p>
          )}

          {connected && phase === "ready" && mine && selfInvite && (
            <p className="muted">{t("sponreq.selfInvite")}</p>
          )}

          {connected && phase === "ready" && mine && !selfInvite && alreadySponsor && (
            <p className="ok-note" style={{ margin: 0 }}>{t("sponreq.alreadySponsor")}</p>
          )}

          {connected && phase === "ready" && mine && !selfInvite && !alreadySponsor && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" disabled={busy} onClick={accept}>
                {busy ? t("sponreq.accepting") : t("sponreq.accept")}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setPhase("declined")}>
                {t("sponreq.decline")}
              </button>
            </div>
          )}

          {phase === "done" && <p className="ok-note" style={{ margin: 0 }}>{t("sponreq.accepted")}</p>}
          {phase === "declined" && <p className="muted" style={{ margin: 0 }}>{t("sponreq.declined")}</p>}

          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

          {(phase === "done" || phase === "declined") && (
            <p style={{ margin: 0 }}><a href="/me">{t("sponreq.backToMe")}</a></p>
          )}
        </div>
      )}
    </>
  );
}
