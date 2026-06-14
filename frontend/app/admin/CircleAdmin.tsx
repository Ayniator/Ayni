"use client";

// Administration of my Circle — only useful to a wallet that holds a Council
// seat. Every action maps to a real on-chain instruction (see lib/admin.ts).
// What the protocol does NOT support is shown disabled, not faked.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import RoleIcon from "../../components/RoleIcon";
import { CircleInfo, explorerTx, listCircles, newCommitment, issueMembership, connection } from "../../lib/member";
import { isMultisig } from "../../lib/multisig";
import {
  CircleMember,
  CouncilProposal,
  MemberProposal,
  SEAT_ROLES,
  SECRETARY,
  actionMigrateWallet,
  actionRotateSeat,
  actionWithdrawTreasury,
  actionSetTreasuryWallet,
  applyTreasuryWallet,
  getTreasuryWallet,
  approveProposal,
  cancelProposal,
  createMemberProposal,
  executeProposal,
  finalizeMemberProposal,
  listCircleMembers,
  listCouncilProposals,
  listMemberProposals,
  mySeatIndices,
  propose,
  renewMembership,
  revokeMembership,
  setOpenMembership,
} from "../../lib/admin";
import { emailNote, notifyCircleEmail } from "../../lib/circleEmail";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const day = (u: number) => new Date(u * 1000).toLocaleDateString();
const dateTime = (u: number) => new Date(u * 1000).toLocaleString();

function pk(s: string): PublicKey | null {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
}

/** Parse a 64-char hex commitment (from a member's join request) to 32 bytes. */
function hexToBytes32(hex: string): Uint8Array | null {
  const h = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export default function CircleAdmin() {
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();

  const [circles, setCircles] = useState<CircleInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const me = publicKey?.toBase58();
  const adminCircles = useMemo(
    () => (me ? circles.filter((c) => mySeatIndices(c.seats, me).length > 0) : []),
    [circles, me]
  );

  const refresh = useCallback(() => {
    listCircles()
      .then(setCircles)
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected && adminCircles.length) setSelected(adminCircles[0].pubkey);
  }, [adminCircles, selected]);

  const circle = adminCircles.find((c) => c.pubkey === selected) ?? null;
  const mySeatIdx = circle && me ? mySeatIndices(circle.seats, me) : [];
  const amSecretary = circle && me ? circle.seats[SECRETARY] === me : false;

  // Embeddable: render nothing unless the connected wallet holds a seat somewhere.
  if (!connected || !circle) {
    if (error) return <p className="error">{error}</p>;
    return null;
  }

  return (
    <section style={{ marginTop: 34 }}>
      <div className="card admin-head">
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <Identicon seed={circle.pubkey} size={46} />
          <div className="meta" style={{ flex: 1, minWidth: 0 }}>
            <div className="name" style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Administration of
              <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Circle to administer">
                {adminCircles.map((c) => (
                  <option key={c.pubkey} value={c.pubkey}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="sub">
              {circle.memberCount} member{circle.memberCount === 1 ? "" : "s"} ·{" "}
              {mySeatIdx.map((i) => (
                <span className="badge badge-alt" key={i}>
                  <RoleIcon seat={i} size={13} /> {SEAT_ROLES[i]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PolicySection circle={circle} wallet={wallet ?? null} onChanged={refresh} />
      <CouncilSection circle={circle} wallet={wallet ?? null} me={me!} />
      <MemberVotesSection circle={circle} wallet={wallet ?? null} />
      <MembersSection circle={circle} wallet={wallet ?? null} amSecretary={amSecretary} />
    </section>
  );
}

// ===========================================================================
// Membership policy (permissionless vs Scribe-Secretary-gated)
// ===========================================================================

function PolicySection({ circle, wallet, onChanged }: { circle: CircleInfo; wallet: any; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<TxNote>(null);

  async function toggle(open: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const sig = await setOpenMembership(wallet, new PublicKey(circle.pubkey), open);
      setNote({
        kind: "ok",
        text: open
          ? "This Circle is now open — anyone may join."
          : "This Circle now requires Scribe-Secretary validation.",
        sig,
      });
      onChanged();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <SectionHead title="Membership policy" sub="Who may join this Circle — change it anytime." />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className={`pill ${circle.open ? "" : "pill-dim"}`}>
            {circle.open ? "Open · permissionless" : "Scribe-Secretary validated"}
          </span>
          <p className="muted sm" style={{ margin: "6px 0 0" }}>
            {circle.open
              ? "Anyone may self-admit a membership (still recorded on-chain)."
              : "The Scribe-Secretary seat admits each member."}
          </p>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => toggle(!circle.open)}>
          {busy ? "…" : circle.open ? "Require validation" : "Make open"}
        </button>
      </div>
      <TxNoteView note={note} />
    </section>
  );
}

// ===========================================================================
// Council proposals (4-of-7)
// ===========================================================================

function CouncilSection({ circle, wallet, me }: { circle: CircleInfo; wallet: any; me: string }) {
  const [items, setItems] = useState<CouncilProposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<TxNote>(null);
  const [treasuryWallet, setTreasuryWallet] = useState<string | null>(null);
  const mySeats = mySeatIndices(circle.seats, me);

  const load = useCallback(() => {
    listCouncilProposals(circle.pubkey, 4)
      .then(setItems)
      .catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
    getTreasuryWallet(circle.pubkey).then(setTreasuryWallet).catch(() => setTreasuryWallet(null));
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function act(label: string, run: () => Promise<string>) {
    setBusy(label);
    setNote(null);
    try {
      const sig = await run();
      setNote({ kind: "ok", text: "Done.", sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  const now = Date.now() / 1000;

  return (
    <section className="card">
      <SectionHead
        title="Council votes (4-of-7)"
        sub="Seat rotation, key migration, treasury spends, and the treasury wallet — the high-stakes, time-locked decisions."
      />

      <p className="muted sm" style={{ marginTop: -6 }}>
        Treasury steward wallet:{" "}
        {treasuryWallet ? <span className="mono">{short(treasuryWallet)}</span> : "none set (treasury PDA only)"}
      </p>

      <NewCouncilProposal circle={circle} wallet={wallet} disabled={!!busy} onDone={load} setNote={setNote} />

      <TxNoteView note={note} />

      {items === null && <p className="muted">Loading votes…</p>}
      {items && items.length === 0 && <p className="muted">No Council votes yet.</p>}

      <div className="votes">
        {items?.map((p) => {
          const iApproved = p.approvedSeats.some((s) => mySeats.includes(s));
          const canApprove = mySeats.length > 0 && !iApproved && p.status === "running";
          const armed = p.eligibleAt !== 0 && now >= p.eligibleAt;
          const canExecute = p.status === "passed" && armed && !p.executed;
          const canCancel = mySeats.length > 0 && (p.status === "running" || p.status === "passed");
          return (
            <div className="vote" key={p.pubkey}>
              <div className="vote-main">
                <StatusDot status={p.status} />
                <div>
                  <div className="name">{p.summary}</div>
                  <div className="sub">
                    {p.approvals}/{p.threshold} approvals
                    {p.eligibleAt !== 0 && !armed && ` · unlocks ${dateTime(p.eligibleAt)}`}
                    {iApproved && " · you approved"}
                  </div>
                </div>
              </div>
              <div className="vote-actions">
                {canApprove && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`approve-${p.pubkey}`, () => approveProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `approve-${p.pubkey}` ? "…" : "Approve"}
                  </button>
                )}
                {canExecute && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`exec-${p.pubkey}`, () => executeProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `exec-${p.pubkey}` ? "…" : "Execute"}
                  </button>
                )}
                {canCancel && (
                  <button className="btn btn-sm btn-ghost" disabled={!!busy}
                    onClick={() => act(`cancel-${p.pubkey}`, () => cancelProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `cancel-${p.pubkey}` ? "…" : "Cancel"}
                  </button>
                )}
                {p.kind === "setTreasuryWallet" && p.executed && !p.drained && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`apply-${p.pubkey}`, () => applyTreasuryWallet(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `apply-${p.pubkey}` ? "…" : "Apply"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NewCouncilProposal({
  circle, wallet, disabled, onDone, setNote,
}: { circle: CircleInfo; wallet: any; disabled: boolean; onDone: () => void; setNote: (n: TxNote) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"rotateSeat" | "migrateWallet" | "withdrawTreasury" | "setTreasuryWallet">("withdrawTreasury");
  const [seatIndex, setSeatIndex] = useState(0);
  const [a, setA] = useState(""); // newHolder / oldWallet / recipient / new treasury wallet
  const [b, setB] = useState(""); // newWallet
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);

  async function submit() {
    let action: any;
    if (kind === "rotateSeat") {
      const holder = pk(a);
      if (!holder) return setNote({ kind: "err", text: "New holder is not a valid address." });
      action = actionRotateSeat(seatIndex, holder);
    } else if (kind === "migrateWallet") {
      const oldW = pk(a), newW = pk(b);
      if (!oldW || !newW) return setNote({ kind: "err", text: "Both wallets must be valid addresses." });
      action = actionMigrateWallet(oldW, newW);
    } else if (kind === "setTreasuryWallet") {
      const w = pk(a);
      if (!w) return setNote({ kind: "err", text: "Treasury wallet is not a valid address." });
      // The program requires a multisig steward (m ≥ 2). Check before proposing
      // so the Council doesn't waste a vote on an address that will be rejected.
      const ms = await isMultisig(connection(), w);
      if (!ms.ok) {
        return setNote({
          kind: "err",
          text: `Treasury wallet must be a multisig (m-of-n, ≥2 signers): ${ms.reason || "not a multisig"}. Create one with "spl-token create-multisig 2 …" or scripts/create-multisig.js — see docs/multisig.md.`,
        });
      }
      action = actionSetTreasuryWallet(w);
    } else {
      const rcpt = pk(a);
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      if (!rcpt) return setNote({ kind: "err", text: "Recipient is not a valid address." });
      if (!(lamports > 0)) return setNote({ kind: "err", text: "Amount must be > 0." });
      action = actionWithdrawTreasury(BigInt(lamports), rcpt);
    }
    setBusy(true);
    setNote(null);
    try {
      const sig = await propose(wallet, new PublicKey(circle.pubkey), action);
      setNote({ kind: "ok", text: "Proposal opened (your seat approved it).", sig });
      setOpen(false);
      setA(""); setB("");
      onDone();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)} disabled={disabled} style={{ marginBottom: 12 }}>
        + New Council vote
      </button>
    );

  return (
    <div className="form">
      <div className="form-row">
        <label>Action</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
          <option value="withdrawTreasury">Withdraw from treasury</option>
          <option value="setTreasuryWallet">Change treasury wallet</option>
          <option value="rotateSeat">Rotate a seat</option>
          <option value="migrateWallet">Migrate a wallet</option>
        </select>
      </div>

      {kind === "setTreasuryWallet" && (
        <div className="form-row">
          <label>New treasury wallet</label>
          <input value={a} onChange={(e) => setA(e.target.value)} placeholder="multisig steward address (m-of-n)" />
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Must be a multisig (≥2 signers) — the money is held in common. Create one with <code>spl-token create-multisig 2 …</code> or <code>scripts/create-multisig.js</code>.
          </p>
        </div>
      )}

      {kind === "rotateSeat" && (
        <>
          <div className="form-row">
            <label>Seat</label>
            <select value={seatIndex} onChange={(e) => setSeatIndex(Number(e.target.value))}>
              {SEAT_ROLES.map((r, i) => <option key={r} value={i}>{r}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>New holder</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder="wallet address" />
          </div>
        </>
      )}
      {kind === "migrateWallet" && (
        <>
          <div className="form-row">
            <label>Old wallet</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder="lost / compromised address" />
          </div>
          <div className="form-row">
            <label>New wallet</label>
            <input value={b} onChange={(e) => setB(e.target.value)} placeholder="replacement address" />
          </div>
        </>
      )}
      {kind === "withdrawTreasury" && (
        <>
          <div className="form-row">
            <label>Amount (SOL)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Recipient</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder="wallet address" />
          </div>
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-sm" onClick={submit} disabled={busy}>{busy ? "Opening…" : "Open vote"}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
      <p className="muted sm">High-stakes actions wait out a contest window; any seat can cancel before execution.</p>
    </div>
  );
}

// ===========================================================================
// Group-conscience (member) proposals
// ===========================================================================

const PERIODS: { label: string; secs: number }[] = [
  { label: "1 hour", secs: 3600 },
  { label: "1 day", secs: 86400 },
  { label: "1 week", secs: 604800 },
  { label: "60 seconds (test)", secs: 60 },
];

function MemberVotesSection({ circle, wallet }: { circle: CircleInfo; wallet: any }) {
  const [items, setItems] = useState<MemberProposal[] | null>(null);
  const [note, setNote] = useState<TxNote>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [period, setPeriod] = useState(PERIODS[1].secs);

  const load = useCallback(() => {
    listMemberProposals(circle.pubkey)
      .then(setItems)
      .catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function create() {
    if (!desc.trim()) return setNote({ kind: "err", text: "Describe what the group is deciding." });
    setBusy("create");
    setNote(null);
    try {
      const sig = await createMemberProposal(wallet, new PublicKey(circle.pubkey), desc.trim(), period);
      setNote({ kind: "ok", text: "Group-conscience vote opened.", sig });
      setDesc(""); setOpen(false);
      load();
    } catch (e: any) {
      const m = String(e?.message || e);
      setNote({
        kind: "err",
        text: m.includes("AccountNotInitialized") || m.includes("member_tree")
          ? "This Circle has no member tree yet (run initialize_member_tree first)."
          : m,
      });
    } finally {
      setBusy(null);
    }
  }

  async function finalize(p: MemberProposal) {
    setBusy(p.pubkey);
    setNote(null);
    try {
      const sig = await finalizeMemberProposal(wallet, new PublicKey(p.pubkey));
      setNote({ kind: "ok", text: "Outcome recorded.", sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <SectionHead
        title="Group-conscience votes"
        sub="One member, one anonymous vote. You open the question and record the outcome; members cast ZK ballots from their own client."
      />

      {!open ? (
        <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
          + New group-conscience vote
        </button>
      ) : (
        <div className="form">
          <div className="form-row col">
            <label>Question / proposal</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
              placeholder="e.g. Adopt the revised meeting format for the home group." />
          </div>
          <div className="form-row">
            <label>Voting period</label>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.secs} value={p.secs}>{p.label}</option>)}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn btn-sm" onClick={create} disabled={busy === "create"}>
              {busy === "create" ? "Opening…" : "Open vote"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="muted sm">Only a hash of the text is stored on-chain; the wording is kept locally so it can be shown back here.</p>
        </div>
      )}

      <TxNoteView note={note} />

      {items === null && <p className="muted">Loading votes…</p>}
      {items && items.length === 0 && <p className="muted">No group-conscience votes yet.</p>}

      <div className="votes">
        {items?.map((p) => (
          <div className="vote" key={p.pubkey}>
            <div className="vote-main">
              <StatusDot status={p.status} />
              <div>
                <div className="name">{p.description || `Proposal ${short(p.descriptionHash)}`}</div>
                <div className="sub">
                  {p.yes} yes · {p.no} no · of {p.eligibleCount} eligible ·{" "}
                  {p.status === "running" ? `ends ${dateTime(p.deadline)}` : `ended ${day(p.deadline)}`}
                  {p.finalized && (p.passed ? " · PASSED" : " · failed")}
                </div>
              </div>
            </div>
            <div className="vote-actions">
              {p.status === "ended-unfinalized" && (
                <button className="btn btn-sm" disabled={busy === p.pubkey} onClick={() => finalize(p)}>
                  {busy === p.pubkey ? "…" : "Record outcome"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===========================================================================
// Members
// ===========================================================================

function MembersSection({ circle, wallet, amSecretary }: { circle: CircleInfo; wallet: any; amSecretary: boolean }) {
  const [items, setItems] = useState<CircleMember[] | null>(null);
  const [note, setNote] = useState<TxNote>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [ownerInput, setOwnerInput] = useState("");
  const [commitInput, setCommitInput] = useState(""); // member's commitment from a join request
  const canAdmit = amSecretary || circle.open;

  const load = useCallback(() => {
    listCircleMembers(circle.pubkey)
      .then(setItems)
      .catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function add() {
    const owner = ownerInput.trim() ? pk(ownerInput) : PublicKey.default;
    if (owner === null) return setNote({ kind: "err", text: "Owner is not a valid address." });
    // Fulfilling a member's join request: use THEIR commitment (so their
    // anonymous identity matches). Otherwise mint a fresh anonymous commitment.
    let commitment: Uint8Array;
    if (commitInput.trim()) {
      const parsed = hexToBytes32(commitInput);
      if (!parsed) return setNote({ kind: "err", text: "Commitment must be 64 hex characters (from the member's join request)." });
      commitment = parsed;
    } else {
      commitment = newCommitment();
    }
    setBusy("add");
    setNote(null);
    try {
      const sig = await issueMembership(wallet, new PublicKey(circle.pubkey), commitment, owner as PublicKey, circle.open);
      // F25: notify the Circle's address that a member registered.
      const emailRes = await notifyCircleEmail({
        kind: "join",
        circleName: circle.name,
        circlePubkey: circle.pubkey,
        memberAddress: owner === PublicKey.default ? null : (owner as PublicKey).toBase58(),
      });
      setNote({ kind: "ok", text: `Membership issued. ${emailNote(emailRes)}`, sig });
      setFormOpen(false); setOwnerInput(""); setCommitInput("");
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function renew(m: CircleMember) {
    setBusy(m.pubkey);
    setNote(null);
    try {
      const sig = await renewMembership(wallet, new PublicKey(circle.pubkey), new PublicKey(m.pubkey));
      setNote({ kind: "ok", text: "Membership renewed.", sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(m: CircleMember) {
    if (!confirm("Delete this membership? This closes the membership account (the Scribe-Secretary acts).")) return;
    setBusy("revoke-" + m.pubkey);
    setNote(null);
    try {
      const sig = await revokeMembership(wallet, new PublicKey(circle.pubkey), new PublicKey(m.pubkey));
      setNote({ kind: "ok", text: "Membership deleted.", sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <SectionHead
        title="Members"
        sub="Soulbound, anonymous, yearly. Identified by a ZK commitment — never by name."
      />

      {canAdmit ? (
        !formOpen ? (
          <button className="btn btn-sm" onClick={() => setFormOpen(true)} style={{ marginBottom: 12 }}>
            + Admit a member
          </button>
        ) : (
          <div className="form">
            <div className="form-row col">
              <label>Owner wallet (optional)</label>
              <input value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} className="mono"
                placeholder="the member's wallet — from their join request (blank = fully anonymous)" />
            </div>
            <div className="form-row col">
              <label>Member commitment (optional)</label>
              <input value={commitInput} onChange={(e) => setCommitInput(e.target.value)} className="mono"
                placeholder="64-hex commitment from the member's join request (blank = mint a fresh one)" />
            </div>
            <div className="form-actions">
              <button className="btn btn-sm" onClick={add} disabled={busy === "add"}>
                {busy === "add" ? "Issuing…" : "Issue membership"}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setFormOpen(false); setCommitInput(""); }}>Cancel</button>
            </div>
            <p className="muted sm">
              {circle.open
                ? "This Circle is open, so any seat may record a member directly."
                : "A fresh anonymous commitment is generated; the owner wallet (if any) enables selective disclosure."}
            </p>
          </div>
        )
      ) : (
        <p className="muted sm">Only the <strong>Scribe-Secretary</strong> seat may admit members (this Circle requires validation).</p>
      )}

      <TxNoteView note={note} />

      {items === null && <p className="muted">Loading members…</p>}
      {items && items.length === 0 && <p className="muted">No memberships issued yet.</p>}

      <div className="members">
        {items?.map((m) => (
          <div className="member" key={m.pubkey}>
            <Identicon seed={m.commitment} size={34} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name mono">{short(m.commitment)}{m.level > 0 ? ` · L${m.level}` : ""}</div>
              <div className="sub">
                {m.owner ? `owner ${short(m.owner)}` : "fully anonymous"} ·{" "}
                {m.active ? `through ${day(m.expiresAt)}` : `expired ${day(m.expiresAt)}`}
              </div>
            </div>
            <span className={`pill ${m.active ? "" : "pill-dim"}`}>{m.active ? "active" : "expired"}</span>
            <div className="member-actions">
              <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => renew(m)}>
                {busy === m.pubkey ? "…" : "Renew"}
              </button>
              {amSecretary ? (
                <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => revoke(m)}>
                  {busy === "revoke-" + m.pubkey ? "…" : "Delete"}
                </button>
              ) : (
                <button className="btn btn-sm btn-disabled" disabled title="Only the Scribe-Secretary can delete a membership.">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted sm" style={{ marginTop: 10 }}>
        <strong>Delete</strong> (Scribe-Secretary only) closes the membership account. Note: the
        member's anonymous commitment stays in the append-only member tree until it is rebuilt, so
        revocation prevents renewal but doesn't retroactively remove them from the votable set.
        There is no separate <strong>Suspend</strong> (no on-chain active flag) — use Delete.
      </p>
    </section>
  );
}

// ===========================================================================
// Small shared bits
// ===========================================================================

type TxNote = { kind: "ok" | "err"; text: string; sig?: string } | null;

function TxNoteView({ note }: { note: TxNote }) {
  if (!note) return null;
  return (
    <p className={note.kind === "err" ? "error" : "ok-note"}>
      {note.text}
      {note.sig && (
        <>
          {" "}
          <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">View transaction</a>
        </>
      )}
    </p>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <p className="muted sm">{sub}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "var(--accent)",
    passed: "var(--accent-2)",
    executed: "var(--accent-2)",
    cancelled: "var(--muted)",
    failed: "#e0607e",
    "ended-unfinalized": "#e0a23a",
  };
  return (
    <span className="status-dot" title={status} style={{ background: map[status] || "var(--muted)" }} />
  );
}
