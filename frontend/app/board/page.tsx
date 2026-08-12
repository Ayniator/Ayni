"use client";

// F30 — the Circle Board. Any member (a wallet that owns a live membership in
// the Circle) may post text and/or an IPFS image, shown only within its
// [start, end] window. Any of the 7 Council seats may delete any post.
//
// F61 — READING IS GATED TOO. This page used to render every post, every
// author identicon and the whole Circle picker to anyone who loaded the URL:
// posting was gated, reading was not, and an unconnected visitor is a member of
// nothing. "Nothing is readable by an unconnected visitor" is the Epic 5 rule,
// and a bulletin board of a recovery fellowship is exactly the surface it was
// written for. So with no wallet connected the page renders its title and the
// invitation to connect — and issues no post query at all, because a request
// that is never made cannot be observed either.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import { useT } from "../../components/SettingsProvider";
import { ipfsUrl } from "../../lib/ipfs";
import {
  CircleInfo,
  MyMembership,
  explorerTx,
  findMyMemberships,
  listCircles,
} from "../../lib/member";
import { mySeatIndices } from "../../lib/admin";
import { Post, createPost, deletePost, listPosts } from "../../lib/posts";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const day = (u: number) => new Date(u * 1000).toLocaleDateString();
const toEpoch = (d: string) => Math.floor(new Date(d).getTime() / 1000);
const todayStr = () => new Date().toISOString().slice(0, 10);
const plusWeek = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

export default function Board() {
  const t = useT();
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();

  const [circles, setCircles] = useState<CircleInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [myMems, setMyMems] = useState<MyMembership[]>([]);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // compose
  const [text, setText] = useState("");
  const [imageCid, setImageCid] = useState("");
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(plusWeek());

  const me = publicKey?.toBase58();
  const circle = circles.find((c) => c.pubkey === selected) ?? null;
  const myMembership = useMemo(
    () => myMems.find((m) => m.circle === selected && m.active) ?? null,
    [myMems, selected]
  );
  const isSeat = !!(circle && me && mySeatIndices(circle.seats, me).length > 0);

  // Only surface Circles the connected wallet actually belongs to (an active
  // membership). A connected wallet that belongs to none falls back to the full
  // list — it is a member of the fellowship looking for where to read, not a
  // stranger. An unconnected visitor never reaches this at all (see above).
  const myCircles = useMemo(
    () => circles.filter((c) => myMems.some((m) => m.circle === c.pubkey && m.active)),
    [circles, myMems]
  );
  const optionCircles = myCircles.length ? myCircles : circles;

  useEffect(() => {
    if (!connected) { setCircles([]); setPosts(null); return; }
    listCircles().then(setCircles);
  }, [connected]);

  useEffect(() => {
    if (publicKey && circles.length) findMyMemberships(publicKey, circles).then(setMyMems).catch(() => {});
  }, [publicKey, circles]);

  // Keep the selection inside the option set; default to the first Circle the
  // member belongs to once their memberships resolve.
  useEffect(() => {
    if (optionCircles.length && !optionCircles.some((c) => c.pubkey === selected)) {
      setSelected(optionCircles[0].pubkey);
    }
  }, [optionCircles, selected]);

  const load = useCallback(() => {
    if (!connected || !selected) return;
    listPosts(selected).then(setPosts).catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
  }, [connected, selected]);
  useEffect(load, [load]);

  async function post() {
    if (!circle || !wallet || !myMembership) return;
    if (!text.trim() && !imageCid.trim()) return setNote({ kind: "err", text: t("board.errNoContent") });
    const s = toEpoch(start), e = toEpoch(end);
    if (!(e > s)) return setNote({ kind: "err", text: t("board.errEndAfterStart") });
    setBusy("post");
    setNote(null);
    try {
      // F61: the author is identified by COMMITMENT now, not by a membership
      // PDA, so the client can resolve which key actually authorises the post —
      // the connected wallet, or the derived key of a shielded membership.
      const { signature, relayed } = await createPost(
        wallet, new PublicKey(circle.pubkey), myMembership.commitment,
        text.trim(), imageCid.trim(), s, e
      );
      setNote({
        kind: "ok",
        // When the member's own wallet paid, say so: it means this post and
        // that wallet now sit in one transaction, permanently.
        text: t("board.posted") + (relayed ? "" : " (paid by your wallet)"),
        sig: signature,
      });
      setText(""); setImageCid("");
      load();
    } catch (err: any) {
      setNote({ kind: "err", text: String(err?.message || err) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Post) {
    if (!circle || !wallet) return;
    setBusy(p.pubkey);
    setNote(null);
    try {
      const sig = await deletePost(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey));
      setNote({ kind: "ok", text: t("board.postDeleted"), sig });
      load();
    } catch (err: any) {
      setNote({ kind: "err", text: String(err?.message || err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>{t("board.title")}</h1>
      <p className="lede">{t("board.lede")}</p>

      {/* Everything below this line is members-only. The unconnected visitor
          gets the same page a member with no Circles gets: an invitation, and
          no content — no post list, no author identicons, no Circle picker
          revealing which Circles exist to be browsed. */}
      {!connected && <div className="card"><p className="muted" style={{ margin: 0 }}>{t("board.connectToPost")}</p></div>}

      {connected && (
      <div className="card">
        <div className="form-row col">
          <label>{t("board.circleLabel")}</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {optionCircles.map((c) => <option key={c.pubkey} value={c.pubkey}>{c.name}</option>)}
          </select>
        </div>
      </div>
      )}

      {connected && circle && (
        myMembership ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("board.newPost")}</h3>
            <div className="form-row col">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
                placeholder={t("board.textPlaceholder")} maxLength={500} />
            </div>
            <div className="form-row col">
              <label>{t("board.imageCidLabel")}</label>
              <input value={imageCid} onChange={(e) => setImageCid(e.target.value)} placeholder={t("board.imageCidPlaceholder")} className="mono" />
            </div>
            <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
              <label className="sm muted">{t("board.from")} <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="sm muted">{t("board.to")} <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
              <button className="btn btn-sm" onClick={post} disabled={busy === "post"}>{busy === "post" ? t("board.posting") : t("board.post")}</button>
            </div>
          </div>
        ) : (
          <div className="card"><p className="muted sm" style={{ margin: 0 }}>
            {t("board.membersOnly")}{" "}
            <a href="/me">{t("board.myCircle")}</a> {t("board.first")}
          </p></div>
        )
      )}

      {note && <p className={note.kind === "err" ? "error" : "ok-note"}>{note.text}{note.sig && <> · <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">{t("board.tx")}</a></>}</p>}

      {connected && posts === null && <p className="muted">{t("board.loadingPosts")}</p>}
      {connected && posts && posts.length === 0 && <p className="muted">{t("board.noPosts")}</p>}

      <div className="grid" style={{ marginTop: 6 }}>
        {connected && posts?.map((p) => (
          <div className={`card post ${p.live ? "" : "post-dim"}`} key={p.pubkey}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <Identicon seed={p.author} size={34} />
              <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                <div className="sub">
                  <span className="mono">{short(p.author)}</span> · {day(p.startDate)}–{day(p.endDate)}
                  {!p.live && <span className="badge" style={{ background: "var(--bg-2)", color: "var(--muted)", borderColor: "var(--border)" }}>{t("board.notInWindow")}</span>}
                </div>
                {p.text && <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{p.text}</p>}
                {p.imageCid && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={ipfsUrl(p.imageCid)} alt="" style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
                )}
              </div>
              {isSeat && (
                <button className="btn btn-sm btn-ghost" disabled={busy === p.pubkey} onClick={() => remove(p)}>
                  {busy === p.pubkey ? "…" : t("board.delete")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
