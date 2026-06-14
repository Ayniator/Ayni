"use client";

// F30 — the Circle Board. Any member (a wallet that owns a live membership in
// the Circle) may post text and/or an IPFS image, shown only within its
// [start, end] window. Any of the 7 Council seats may delete any post.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
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

  useEffect(() => {
    listCircles().then((cs) => {
      setCircles(cs);
      if (!selected && cs.length) setSelected(cs[0].pubkey);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (publicKey && circles.length) findMyMemberships(publicKey, circles).then(setMyMems).catch(() => {});
  }, [publicKey, circles]);

  const load = useCallback(() => {
    if (!selected) return;
    listPosts(selected).then(setPosts).catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
  }, [selected]);
  useEffect(load, [load]);

  async function post() {
    if (!circle || !wallet || !myMembership) return;
    if (!text.trim() && !imageCid.trim()) return setNote({ kind: "err", text: "Add text or an image CID." });
    const s = toEpoch(start), e = toEpoch(end);
    if (!(e > s)) return setNote({ kind: "err", text: "End date must be after the start date." });
    setBusy("post");
    setNote(null);
    try {
      const sig = await createPost(
        wallet, new PublicKey(circle.pubkey), new PublicKey(myMembership.pubkey),
        text.trim(), imageCid.trim(), s, e
      );
      setNote({ kind: "ok", text: "Posted.", sig });
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
      setNote({ kind: "ok", text: "Post deleted.", sig });
      load();
    } catch (err: any) {
      setNote({ kind: "err", text: String(err?.message || err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>Board</h1>
      <p className="lede">Notices from the Circle. Members post; any Council seat can remove a post.</p>

      <div className="card">
        <div className="form-row col">
          <label>Circle</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {circles.map((c) => <option key={c.pubkey} value={c.pubkey}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!connected && <div className="card"><p className="muted" style={{ margin: 0 }}>Connect a wallet to post.</p></div>}

      {connected && circle && (
        myMembership ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>New post</h3>
            <div className="form-row col">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
                placeholder="Share a notice with the Circle…" maxLength={500} />
            </div>
            <div className="form-row col">
              <label>Image IPFS CID (optional)</label>
              <input value={imageCid} onChange={(e) => setImageCid(e.target.value)} placeholder="bafy… (pin elsewhere)" className="mono" />
            </div>
            <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
              <label className="sm muted">From <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="sm muted">To <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
              <button className="btn btn-sm" onClick={post} disabled={busy === "post"}>{busy === "post" ? "Posting…" : "Post"}</button>
            </div>
          </div>
        ) : (
          <div className="card"><p className="muted sm" style={{ margin: 0 }}>
            Only members (with a wallet-bound membership in this Circle) may post. Join from{" "}
            <a href="/me">My Circle</a> first.
          </p></div>
        )
      )}

      {note && <p className={note.kind === "err" ? "error" : "ok-note"}>{note.text}{note.sig && <> · <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">tx</a></>}</p>}

      {posts === null && <p className="muted">Loading posts…</p>}
      {posts && posts.length === 0 && <p className="muted">No posts yet.</p>}

      <div className="grid" style={{ marginTop: 6 }}>
        {posts?.map((p) => (
          <div className={`card post ${p.live ? "" : "post-dim"}`} key={p.pubkey}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <Identicon seed={p.author} size={34} />
              <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                <div className="sub">
                  <span className="mono">{short(p.author)}</span> · {day(p.startDate)}–{day(p.endDate)}
                  {!p.live && <span className="badge" style={{ background: "var(--bg-2)", color: "var(--muted)", borderColor: "var(--border)" }}>not in window</span>}
                </div>
                {p.text && <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{p.text}</p>}
                {p.imageCid && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={ipfsUrl(p.imageCid)} alt="" style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
                )}
              </div>
              {isSeat && (
                <button className="btn btn-sm btn-ghost" disabled={busy === p.pubkey} onClick={() => remove(p)}>
                  {busy === p.pubkey ? "…" : "Delete"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
