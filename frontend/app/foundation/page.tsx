"use client";

// Foundation console — for wallets holding a seat in the root (World Service)
// Circle. Change the 7 seats (4-of-7 RotateSeat), set the public profile that
// powers /documents, and compose Daily Reflections for /reflections.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import RoleIcon from "../../components/RoleIcon";
import { CircleInfo, cachedCircleInfos, explorerTx, foundationOf, listCircles } from "../../lib/member";
import {
  CouncilProposal,
  SEAT_ROLES,
  actionRotateSeat,
  approveProposal,
  cancelProposal,
  executeProposal,
  listCouncilProposals,
  mySeatIndices,
  propose,
} from "../../lib/admin";
import {
  ChildVote,
  ProfileFields,
  ReflectionMap,
  approveChildRotation,
  approveChildClose,
  executeChildRotation,
  executeChildClose,
  getLocalReflections,
  getProfile,
  listChildVotes,
  listChildCloseVotes,
  proposeChildRotation,
  proposeChildClose,
  saveLocalReflections,
  upsertCircleProfile,
} from "../../lib/foundation";
import { todayKey } from "../../lib/ipfs";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
function pk(s: string): PublicKey | null {
  try { return new PublicKey(s.trim()); } catch { return null; }
}
type Note = { kind: "ok" | "err"; text: string; sig?: string } | null;

// A deleted Circle's account is closed on-chain and the vote keeps neither its
// name nor an executed-at time, so we remember the name (for every Circle we see)
// and stamp the deletion date locally — best-effort, per-browser.
const NAME_KEY = (p: string) => `aha:cname:${p}`;
const DEL_KEY = (p: string) => `aha:cdel:${p}`;
function rememberName(p: string, name: string) { try { if (name && name !== p) localStorage.setItem(NAME_KEY(p), name); } catch {} }
function recallName(p: string): string | null { try { return localStorage.getItem(NAME_KEY(p)); } catch { return null; } }
function stampDeleted(p: string) { try { localStorage.setItem(DEL_KEY(p), String(Math.floor(Date.now() / 1000))); } catch {} }
function recallDeleted(p: string): number | null { try { const v = localStorage.getItem(DEL_KEY(p)); return v ? Number(v) : null; } catch { return null; } }
const fmtDate = (u: number) => new Date(u * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export default function Foundation() {
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();
  const [circles, setCircles] = useState<CircleInfo[]>(() => cachedCircleInfos());
  const me = publicKey?.toBase58();

  useEffect(() => {
    listCircles().then(setCircles).catch(() => {});
  }, []);

  const foundation = useMemo(() => foundationOf(circles), [circles]);
  const mySeats = foundation && me ? mySeatIndices(foundation.seats, me) : [];
  const isFoundationSeat = mySeats.length > 0;

  return (
    <>
      <h1>Foundation</h1>
      <p className="lede">
        The World Service Circle — shared seats, documents, and Daily Reflections for the whole
        fellowship. You see this because your wallet holds a foundation seat.
      </p>

      {!connected && <div className="card"><p className="muted" style={{ margin: 0 }}>Connect your foundation wallet.</p></div>}
      {connected && !foundation && <div className="card"><p className="muted" style={{ margin: 0 }}>No foundation Circle found on this cluster.</p></div>}
      {connected && foundation && !isFoundationSeat && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>This wallet doesn&apos;t hold a foundation seat.</p></div>
      )}

      {foundation && isFoundationSeat && (
        <>
          <div className="card">
            <div className="row">
              <Identicon seed={foundation.pubkey} size={44} />
              <div className="meta" style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontSize: 18 }}>{foundation.name}</div>
                <div className="sub">
                  {mySeats.map((i) => <span key={i} className="badge badge-alt"><RoleIcon seat={i} size={13} /> {SEAT_ROLES[i]}</span>)}
                </div>
              </div>
            </div>
          </div>

          <SeatsPanel foundation={foundation} wallet={wallet ?? null} me={me!} />
          <ProfilePanel foundation={foundation} wallet={wallet ?? null} />
          <ReflectionsPanel foundation={foundation} />
          <ChildRotationPanel foundation={foundation} circles={circles} wallet={wallet ?? null} me={me!} />
          <ChildClosePanel foundation={foundation} circles={circles} wallet={wallet ?? null} me={me!} onChanged={() => listCircles().then(setCircles)} />
        </>
      )}
    </>
  );
}

// ===========================================================================
// Seats — change the 7 positions via 4-of-7 RotateSeat
// ===========================================================================

function SeatsPanel({ foundation, wallet, me }: { foundation: CircleInfo; wallet: any; me: string }) {
  const [items, setItems] = useState<CouncilProposal[] | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [newHolder, setNewHolder] = useState("");
  const mySeats = mySeatIndices(foundation.seats, me);

  const load = useCallback(() => {
    listCouncilProposals(foundation.pubkey, 4).then(setItems).catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
  }, [foundation.pubkey]);
  useEffect(load, [load]);

  async function proposeRotate(seatIndex: number) {
    const holder = pk(newHolder);
    if (!holder) return setNote({ kind: "err", text: "Enter a valid wallet address." });
    setBusy("rotate");
    setNote(null);
    try {
      const sig = await propose(wallet, new PublicKey(foundation.pubkey), actionRotateSeat(seatIndex, holder));
      setNote({ kind: "ok", text: `Proposed new ${SEAT_ROLES[seatIndex]} (your seat approved it). Needs 4-of-7.`, sig });
      setEditing(null); setNewHolder("");
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function act(label: string, run: () => Promise<string>) {
    setBusy(label); setNote(null);
    try { const sig = await run(); setNote({ kind: "ok", text: "Done.", sig }); load(); }
    catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  const now = Date.now() / 1000;

  return (
    <section className="card">
      <div className="section-head"><h2>The 7 seats</h2><p className="muted sm">Changing a seat is a 4-of-7 Council vote (time-locked, contestable).</p></div>

      <div className="members">
        {SEAT_ROLES.map((role, i) => (
          <div className="member" key={i}>
            <RoleIcon seat={i} size={26} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{role}</div>
              <div className="sub mono">{short(foundation.seats[i])}{foundation.seats[i] === me ? " · you" : ""}</div>
            </div>
            {mySeats.length > 0 && (editing === i ? (
              <div className="row" style={{ gap: 6 }}>
                <input className="mono" value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder="new wallet" style={{ width: 150 }} />
                <button className="btn btn-sm" disabled={busy === "rotate"} onClick={() => proposeRotate(i)}>{busy === "rotate" ? "…" : "Propose"}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>×</button>
              </div>
            ) : (
              <div className="row" style={{ gap: 6 }}>
                {foundation.seats[i] !== PublicKey.default.toBase58() && (
                  <Link
                    href={`/inbox?to=${foundation.seats[i]}`}
                    className="btn btn-sm btn-ghost"
                    title="Send a private message to this seat holder"
                    aria-label="Send message"
                  >
                    ✉
                  </Link>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(i); setNewHolder(""); }}>Change</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <TxNote note={note} />

      {items && items.filter((p) => p.kind === "rotateSeat" && p.status !== "cancelled").length > 0 && (
        <>
          <h4 style={{ margin: "14px 0 6px" }}>Pending seat votes</h4>
          <div className="votes">
            {items.filter((p) => p.kind === "rotateSeat").map((p) => {
              const iApproved = p.approvedSeats.some((s) => mySeats.includes(s));
              const armed = p.eligibleAt !== 0 && now >= p.eligibleAt;
              return (
                <div className="vote" key={p.pubkey}>
                  <div className="vote-main"><StatusDot status={p.status} /><div>
                    <div className="name">{p.summary}</div>
                    <div className="sub">{p.approvals}/{p.threshold} approvals{iApproved && " · you approved"}</div>
                  </div></div>
                  <div className="vote-actions">
                    {mySeats.length > 0 && !iApproved && p.status === "running" && (
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => act("a" + p.pubkey, () => approveProposal(wallet, new PublicKey(foundation.pubkey), new PublicKey(p.pubkey)))}>Approve</button>
                    )}
                    {p.status === "passed" && armed && !p.executed && (
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => act("e" + p.pubkey, () => executeProposal(wallet, new PublicKey(foundation.pubkey), new PublicKey(p.pubkey)))}>Execute</button>
                    )}
                    {mySeats.length > 0 && (p.status === "running" || p.status === "passed") && (
                      <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => act("c" + p.pubkey, () => cancelProposal(wallet, new PublicKey(foundation.pubkey), new PublicKey(p.pubkey)))}>Cancel</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ===========================================================================
// Profile / documents — upsert_circle_profile
// ===========================================================================

function ProfilePanel({ foundation, wallet }: { foundation: CircleInfo; wallet: any }) {
  const [f, setF] = useState<ProfileFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    getProfile(foundation.pubkey).then((p) =>
      setF(p ?? {
        latMicrodeg: 0, lonMicrodeg: 0, name: foundation.name, city: "", address: "",
        twelveStepsCid: "", preambleCid: "", dailyReflectionsCid: "",
      })
    );
  }, [foundation.pubkey, foundation.name]);

  function up<K extends keyof ProfileFields>(k: K, v: ProfileFields[K]) {
    setF((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function save() {
    if (!f || !wallet) return;
    setBusy(true); setNote(null);
    try {
      const sig = await upsertCircleProfile(wallet, new PublicKey(foundation.pubkey), f);
      setNote({ kind: "ok", text: "Profile saved — it now powers Find a Circle, Documents, and Reflections.", sig });
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(false); }
  }

  if (!f) return null;
  return (
    <section className="card">
      <div className="section-head"><h2>Documents &amp; directory profile</h2>
        <p className="muted sm">The IPFS CIDs below drive <a href="/documents">/documents</a> and <a href="/reflections">/reflections</a>. Pin a file on IPFS, then paste its CID here.</p></div>
      <div className="form">
        <div className="form-row"><label>Name</label><input value={f.name} onChange={(e) => up("name", e.target.value)} /></div>
        <div className="form-row"><label>City</label><input value={f.city} onChange={(e) => up("city", e.target.value)} /></div>
        <div className="form-row"><label>Address</label><input value={f.address} onChange={(e) => up("address", e.target.value)} /></div>
        <div className="form-row">
          <label>Lat / Lon</label>
          <input type="number" value={f.latMicrodeg} onChange={(e) => up("latMicrodeg", Number(e.target.value))} placeholder="lat µ°" style={{ maxWidth: 130 }} />
          <input type="number" value={f.lonMicrodeg} onChange={(e) => up("lonMicrodeg", Number(e.target.value))} placeholder="lon µ°" style={{ maxWidth: 130 }} />
          <span className="muted sm">microdegrees (°×1e6)</span>
        </div>
        <div className="form-row"><label>12 Steps CID</label><input className="mono" value={f.twelveStepsCid} onChange={(e) => up("twelveStepsCid", e.target.value)} placeholder="bafy…" /></div>
        <div className="form-row"><label>Preamble CID</label><input className="mono" value={f.preambleCid} onChange={(e) => up("preambleCid", e.target.value)} placeholder="bafy…" /></div>
        <div className="form-row"><label>Reflections CID</label><input className="mono" value={f.dailyReflectionsCid} onChange={(e) => up("dailyReflectionsCid", e.target.value)} placeholder="bafy… (the JSON below, pinned)" /></div>
        <div className="form-actions"><button className="btn btn-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
      </div>
      <TxNote note={note} />
    </section>
  );
}

// ===========================================================================
// Reflections composer — build the JSON, preview locally, export to pin
// ===========================================================================

const EMPTY = { title: "", quote: "", source: "", reflection: "" };

function ReflectionsPanel({ foundation }: { foundation: CircleInfo }) {
  const [map, setMap] = useState<ReflectionMap>({});
  const [key, setKey] = useState(todayKey());
  const [entry, setEntry] = useState({ ...EMPTY });
  const [note, setNote] = useState<Note>(null);

  useEffect(() => { setMap(getLocalReflections(foundation.pubkey)); }, [foundation.pubkey]);
  useEffect(() => { setEntry({ ...(map[key] ?? EMPTY) }); }, [key, map]);

  function saveEntry() {
    if (!entry.title.trim() && !entry.reflection.trim()) return setNote({ kind: "err", text: "Add at least a title or reflection." });
    const next = { ...map, [key]: { ...entry } };
    setMap(next); saveLocalReflections(foundation.pubkey, next);
    setNote({ kind: "ok", text: `Saved ${key} locally — it previews on /reflections immediately.` });
  }
  function removeEntry() {
    const next = { ...map }; delete next[key];
    setMap(next); saveLocalReflections(foundation.pubkey, next);
    setEntry({ ...EMPTY });
  }
  function download() {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "daily-reflections.json"; a.click();
    URL.revokeObjectURL(url);
  }

  const dates = Object.keys(map).sort();
  return (
    <section className="card">
      <div className="section-head"><h2>Daily Reflections</h2>
        <p className="muted sm">Compose entries keyed by <span className="mono">MM-DD</span>. They preview instantly on <a href="/reflections">/reflections</a> (cached locally). To publish for everyone, <b>Download JSON</b>, pin it to IPFS, and paste the CID into the Reflections CID above.</p></div>

      <div className="form">
        <div className="form-row"><label>Date (MM-DD)</label>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="01-01" style={{ maxWidth: 120 }} className="mono" />
          {dates.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setKey(e.target.value)}>
              <option value="">… existing ({dates.length})</option>
              {dates.map((d) => <option key={d} value={d}>{d} — {map[d].title}</option>)}
            </select>
          )}
        </div>
        <div className="form-row"><label>Title</label><input value={entry.title} onChange={(e) => setEntry({ ...entry, title: e.target.value })} /></div>
        <div className="form-row col"><label>Quote</label><textarea rows={2} value={entry.quote} onChange={(e) => setEntry({ ...entry, quote: e.target.value })} /></div>
        <div className="form-row"><label>Source</label><input value={entry.source} onChange={(e) => setEntry({ ...entry, source: e.target.value })} /></div>
        <div className="form-row col"><label>Reflection</label><textarea rows={3} value={entry.reflection} onChange={(e) => setEntry({ ...entry, reflection: e.target.value })} /></div>
        <div className="form-actions">
          <button className="btn btn-sm" onClick={saveEntry}>Save entry</button>
          {map[key] && <button className="btn btn-sm btn-ghost" onClick={removeEntry}>Delete entry</button>}
          {dates.length > 0 && <button className="btn btn-sm btn-ghost" onClick={download}>Download JSON ({dates.length})</button>}
        </div>
      </div>
      <TxNote note={note} />
    </section>
  );
}

// ===========================================================================
// Help rotating a Circle's positions — foundation 4-of-7 over a child Circle
// ===========================================================================

const VALIDITY_DAYS = [1, 7, 14, 30, 60, 90];

function ChildRotationPanel({
  foundation, circles, wallet, me,
}: { foundation: CircleInfo; circles: CircleInfo[]; wallet: any; me: string }) {
  // The foundation governs its whole federation: direct children + Circles that
  // share its root `parent` (siblings forked from the same World Service root).
  const children = useMemo(
    () =>
      circles.filter(
        (c) =>
          c.pubkey !== foundation.pubkey &&
          (c.parent === foundation.pubkey || c.parent === foundation.parent)
      ),
    [circles, foundation.pubkey, foundation.parent]
  );
  const [sel, setSel] = useState("");
  const [seats, setSeats] = useState<string[]>(Array(7).fill(""));
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [votes, setVotes] = useState<ChildVote[] | null>(null);

  const child = children.find((c) => c.pubkey === sel) ?? null;
  const mySeats = mySeatIndices(foundation.seats, me);

  useEffect(() => {
    if (!sel && children.length) setSel(children[0].pubkey);
  }, [children, sel]);
  useEffect(() => {
    if (child) setSeats([...child.seats]); // prefill current addresses
  }, [child?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    listChildVotes(foundation.pubkey).then(setVotes).catch(() => setVotes([]));
  }, [foundation.pubkey]);
  useEffect(load, [load]);

  function setSeat(i: number, v: string) {
    setSeats((p) => { const n = [...p]; n[i] = v; return n; });
  }

  async function vote() {
    if (!child || !wallet) return;
    const keys: PublicKey[] = [];
    for (let i = 0; i < 7; i++) {
      const k = pk(seats[i]);
      if (!k) return setNote({ kind: "err", text: `${SEAT_ROLES[i]} is not a valid address.` });
      keys.push(k);
    }
    if (new Set(keys.map((k) => k.toBase58())).size !== 7)
      return setNote({ kind: "err", text: "All 7 seats must be distinct." });
    setBusy("vote"); setNote(null);
    try {
      const sig = await proposeChildRotation(wallet, new PublicKey(foundation.pubkey), new PublicKey(child.pubkey), keys, days);
      setNote({ kind: "ok", text: `Vote opened to change ${child.name}'s addresses (your seat approved; needs 4-of-7, valid ${days}d).`, sig });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function act(label: string, run: () => Promise<string>) {
    setBusy(label); setNote(null);
    try { const sig = await run(); setNote({ kind: "ok", text: "Done.", sig }); load(); }
    catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  const childName = (pk: string) => circles.find((c) => c.pubkey === pk)?.name ?? pk.slice(0, 8) + "…";

  return (
    <section className="card">
      <div className="section-head">
        <h2>Help rotating a Circle position</h2>
        <p className="muted sm">
          The foundation can help any Circle in its federation change its seats — a 4-of-7 vote
          among the foundation. All Circles under this foundation's root appear here.
        </p>
      </div>

      {children.length === 0 ? (
        <p className="muted sm">
          No other Circle in this foundation's federation yet. Circles forked from the same root
          (or created via <a href="/create">Create a Circle</a>) will appear here.
        </p>
      ) : (
        <>
          <div className="form-row col">
            <label>Circle</label>
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {children.map((c) => <option key={c.pubkey} value={c.pubkey}>{c.name}</option>)}
            </select>
          </div>

          {child && (
            <div className="form" style={{ marginTop: 10 }}>
              {SEAT_ROLES.map((role, i) => (
                <div className="form-row" key={role}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <RoleIcon seat={i} size={16} /> {role}
                  </label>
                  <input className="mono" value={seats[i]} onChange={(e) => setSeat(i, e.target.value)}
                    placeholder="wallet address" />
                </div>
              ))}
              <div className="form-row">
                <label>Vote valid for</label>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {VALIDITY_DAYS.map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
                </select>
              </div>
              <div className="form-actions">
                <button className="btn btn-sm" onClick={vote} disabled={busy === "vote" || mySeats.length === 0}>
                  {busy === "vote" ? "Opening…" : "Vote the Circle Addresses Change"}
                </button>
              </div>
              {mySeats.length === 0 && <p className="muted sm">Only foundation seats can open this vote.</p>}
            </div>
          )}
        </>
      )}

      <TxNote note={note} />

      {votes && votes.length > 0 && (
        <>
          <h4 style={{ margin: "14px 0 6px" }}>Pending / past address-change votes</h4>
          <div className="votes">
            {votes.map((v) => {
              const iApproved = v.approvedSeats.some((s) => mySeats.includes(s));
              return (
                <div className="vote" key={v.pubkey}>
                  <div className="vote-main">
                    <StatusDot status={v.status === "open" ? "running" : v.status} />
                    <div>
                      <div className="name">Change seats of {childName(v.child)}</div>
                      <div className="sub">
                        {v.approvals}/4 approvals · {v.status}
                        {v.status !== "executed" && v.status !== "expired" && ` · valid until ${new Date(v.expiresAt * 1000).toLocaleString()}`}
                        {iApproved && " · you approved"}
                      </div>
                    </div>
                  </div>
                  <div className="vote-actions">
                    {mySeats.length > 0 && !iApproved && v.status === "open" && (
                      <button className="btn btn-sm" disabled={!!busy}
                        onClick={() => act("a" + v.pubkey, () => approveChildRotation(wallet, new PublicKey(foundation.pubkey), new PublicKey(v.pubkey)))}>Approve</button>
                    )}
                    {(v.status === "passed") && (
                      <button className="btn btn-sm" disabled={!!busy}
                        onClick={() => act("e" + v.pubkey, () => executeChildRotation(wallet, new PublicKey(foundation.pubkey), new PublicKey(v.child), new PublicKey(v.pubkey)))}>Apply</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ===========================================================================
// Delete a Circle — foundation 4-of-7 over a federation circle
// ===========================================================================

function ChildClosePanel({
  foundation, circles, wallet, me, onChanged,
}: { foundation: CircleInfo; circles: CircleInfo[]; wallet: any; me: string; onChanged: () => void }) {
  const children = useMemo(
    () => circles.filter((c) => c.pubkey !== foundation.pubkey && (c.parent === foundation.pubkey || c.parent === foundation.parent)),
    [circles, foundation.pubkey, foundation.parent]
  );
  const [sel, setSel] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [votes, setVotes] = useState<ChildVote[] | null>(null);
  const mySeats = mySeatIndices(foundation.seats, me);
  // Live name → remembered name (for already-deleted Circles) → truncated pubkey.
  const childName = (p: string) => circles.find((c) => c.pubkey === p)?.name ?? recallName(p) ?? p.slice(0, 8) + "…";

  // Remember every Circle's name while it still exists, so deletions can show it later.
  useEffect(() => { for (const c of circles) rememberName(c.pubkey, c.name); }, [circles]);
  useEffect(() => { if (!sel && children.length) setSel(children[0].pubkey); }, [children, sel]);
  const load = useCallback(() => { listChildCloseVotes(foundation.pubkey).then(setVotes).catch(() => setVotes([])); }, [foundation.pubkey]);
  useEffect(load, [load]);

  async function vote() {
    if (!sel || !wallet) return;
    if (!confirm(`Open a 4-of-7 vote to DELETE "${childName(sel)}"? If it passes, the Circle is closed.`)) return;
    setBusy("vote"); setNote(null);
    try {
      const sig = await proposeChildClose(wallet, new PublicKey(foundation.pubkey), new PublicKey(sel), days);
      setNote({ kind: "ok", text: `Delete vote opened for ${childName(sel)} (4-of-7, valid ${days}d).`, sig });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function act(label: string, run: () => Promise<string>) {
    setBusy(label); setNote(null);
    try { const sig = await run(); setNote({ kind: "ok", text: "Done.", sig }); load(); onChanged(); }
    catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Delete a Circle</h2>
        <p className="muted sm">A 4-of-7 foundation vote to permanently close a federation Circle (and delist it). Irreversible once executed.</p>
      </div>
      {children.length === 0 ? (
        <p className="muted sm">No federation Circle to delete.</p>
      ) : (
        <div className="form-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            {children.map((c) => <option key={c.pubkey} value={c.pubkey}>{c.name}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
          </select>
          <button className="btn btn-sm" onClick={vote} disabled={busy === "vote" || mySeats.length === 0}>
            {busy === "vote" ? "Opening…" : "Vote to delete (4-of-7)"}
          </button>
        </div>
      )}
      <TxNote note={note} />
      {votes && votes.length > 0 && (
        <div className="votes" style={{ marginTop: 8 }}>
          {votes.map((v) => {
            const iApproved = v.approvedSeats.some((s) => mySeats.includes(s));
            return (
              <div className="vote" key={v.pubkey}>
                <div className="vote-main">
                  <StatusDot status={v.status === "open" ? "running" : v.status} />
                  <div>
                    <div className="name">Delete {childName(v.child)}</div>
                    <div className="sub">
                      {v.approvals}/4 · {v.status}
                      {v.status === "executed" && recallDeleted(v.child) && ` · deleted ${fmtDate(recallDeleted(v.child)!)}`}
                      {iApproved && " · you approved"}
                    </div>
                  </div>
                </div>
                <div className="vote-actions">
                  {mySeats.length > 0 && !iApproved && v.status === "open" && (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => act("a" + v.pubkey, () => approveChildClose(wallet, new PublicKey(foundation.pubkey), new PublicKey(v.pubkey)))}>Approve</button>
                  )}
                  {v.status === "passed" && (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => act("e" + v.pubkey, async () => {
                      const prof = await getProfile(v.child);
                      const sig = await executeChildClose(wallet, new PublicKey(foundation.pubkey), new PublicKey(v.child), new PublicKey(v.pubkey), prof !== null);
                      stampDeleted(v.child); // record the deletion date locally
                      return sig;
                    })}>Apply (delete)</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ===========================================================================

function TxNote({ note }: { note: Note }) {
  if (!note) return null;
  return <p className={note.kind === "err" ? "error" : "ok-note"}>{note.text}{note.sig && <> · <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">tx</a></>}</p>;
}
function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = { running: "var(--accent)", passed: "var(--accent-2)", executed: "var(--accent-2)", cancelled: "var(--muted)" };
  return <span className="status-dot" style={{ background: map[status] || "var(--muted)" }} />;
}
