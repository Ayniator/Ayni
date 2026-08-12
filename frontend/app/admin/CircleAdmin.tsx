"use client";

// Administration of my Circle — only useful to a wallet that holds a Council
// seat. Every action maps to a real on-chain instruction (see lib/admin.ts).
// What the protocol does NOT support is shown disabled, not faked.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import RoleIcon from "../../components/RoleIcon";
import { CircleInfo, explorerTx, listCircles, newCommitment, issueMembership, connection } from "../../lib/member";
import { isMultisig } from "../../lib/multisig";
import { AllowEntry, CircleConfigFields, DEFAULT_CONFIG, getCircleConfig, listTreasuryAllowed, setCircleConfig, setTreasuryAllow } from "../../lib/config";
import { Chip, MILESTONES, issueProgressToken, listProgressTokens, milestoneLabel } from "../../lib/peers";
import {
  CircleMember,
  CouncilProposal,
  MemberProposal,
  SeatElectionInfo,
  installElectedSeat,
  listSeatElections,
  proposeSeatElection,
  SEAT_ROLES,
  SECRETARY,
  actionMigrateWallet,
  actionRotateSeat,
  actionWithdrawTreasury,
  actionWithdrawTreasuryToken,
  actionSetTreasuryWallet,
  withdrawTreasuryToken,
  applyTreasuryWallet,
  getTreasuryWallet,
  createMembershipMint,
  getMembershipMint,
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
import {
  FAUCET_MAX_GRANT_LAMPORTS,
  FaucetInfo,
  getFaucet,
  hasFaucetFill,
  initFaucet,
  proposeFaucetRefill,
  recallRefillAmount,
  refillFaucet,
  setFaucetAmount,
  FAUCET_MAX_REFILL_GRANTS,
} from "../../lib/faucet";
import { LedgerEntry, readLedger } from "../../lib/faucetLedger";
import { PendingAdmission, confirmAdmission, getTwoSponsorPolicy, listProvisionals, setTwoSponsorAdmission } from "../../lib/admission";
import { useT } from "../../components/SettingsProvider";

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
  const t = useT();
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
              {t("admin.administrationOf")}
              <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label={t("admin.circleToAdminister")}>
                {adminCircles.map((c) => (
                  <option key={c.pubkey} value={c.pubkey}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="sub">
              {circle.memberCount} {circle.memberCount === 1 ? t("admin.memberSingular") : t("admin.memberPlural")} ·{" "}
              {mySeatIdx.map((i) => (
                <span className="badge badge-alt" key={i}>
                  <RoleIcon seat={i} size={13} /> {SEAT_ROLES[i]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <SeatsSection circle={circle} wallet={wallet ?? null} me={me!} />
      <PolicySection circle={circle} wallet={wallet ?? null} onChanged={refresh} />
      <AdmissionsSection circle={circle} wallet={wallet ?? null} anySeat={mySeatIdx.length > 0} />
      <ConfigSection circle={circle} wallet={wallet ?? null} />
      <CouncilSection circle={circle} wallet={wallet ?? null} me={me!} />
      <FaucetSection circle={circle} wallet={wallet ?? null} isTreasurer={mySeatIdx.includes(0)} anySeat={mySeatIdx.length > 0} />
      <MemberVotesSection circle={circle} wallet={wallet ?? null} />
      <SeatElectionsSection circle={circle} wallet={wallet ?? null} anySeat={mySeatIdx.length > 0} />
      <MembersSection circle={circle} wallet={wallet ?? null} amSecretary={amSecretary} anySeat={mySeatIdx.length > 0} />
    </section>
  );
}

// ===========================================================================
// Two-sponsor admission (Epic 1, amended v0.2) — policy + pending confirmations
// ===========================================================================

function AdmissionsSection({ circle, wallet, anySeat }: { circle: CircleInfo; wallet: any; anySeat: boolean }) {
  const t = useT();
  const [required, setRequired] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingAdmission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<TxNote>(null);

  const load = useCallback(() => {
    getTwoSponsorPolicy(new PublicKey(circle.pubkey)).then(setRequired).catch(() => {});
    listProvisionals(circle.pubkey).then(setPending).catch(() => {});
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function act(label: string, run: () => Promise<string>, okText: string) {
    if (!wallet) return;
    setBusy(label); setNote(null);
    try {
      const sig = await run();
      setNote({ kind: "ok", text: okText, sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  if (required === null) return null;
  return (
    <section className="card">
      <SectionHead
        title={t("admin.twoSponsor.title")}
        sub={t("admin.twoSponsor.sub")}
      />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className={`pill ${required ? "" : "pill-dim"}`}>
          {required ? t("admin.twoSponsor.required") : t("admin.twoSponsor.off")}
        </span>
        {anySeat && (
          <button className="btn btn-sm" disabled={busy === "toggle"}
            onClick={() => act("toggle", () => setTwoSponsorAdmission(wallet, new PublicKey(circle.pubkey), !required),
              required ? t("admin.twoSponsor.disabledMsg") : t("admin.twoSponsor.requiredMsg"))}>
            {busy === "toggle" ? "…" : required ? t("admin.twoSponsor.disable") : t("admin.twoSponsor.requireBtn")}
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="votes" style={{ marginTop: 8 }}>
          {pending.map((p) => (
            <div className="vote" key={p.commitment}>
              <div className="vote-main">
                <Identicon seed={p.commitment} size={26} />
                <div>
                  <div className="name">{t("admin.twoSponsor.provisionalMember")} <code>{p.commitment.slice(0, 8)}…</code></div>
                  <div className="sub">{t("admin.twoSponsor.parrain")} <code>{p.parrain.slice(0, 8)}…</code> · {t("admin.twoSponsor.since")} {day(p.issuedAt)}</div>
                </div>
              </div>
              <div className="vote-actions">
                {anySeat && (
                  <button className="btn btn-sm" disabled={busy === "confirm" + p.commitment}
                    onClick={() => act("confirm" + p.commitment,
                      () => confirmAdmission(wallet, new PublicKey(circle.pubkey), p.commitment, p.parrain),
                      t("admin.twoSponsor.confirmedMsg"))}>
                    {busy === "confirm" + p.commitment ? "…" : t("admin.twoSponsor.coAttest")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {pending.length === 0 && required && (
        <p className="muted sm" style={{ marginBottom: 0 }}>{t("admin.twoSponsor.noneAwaiting")}</p>
      )}

      <TxNoteView note={note} />
    </section>
  );
}

// ===========================================================================
// Membership policy (permissionless vs Scribe-Secretary-gated)
// ===========================================================================

function PolicySection({ circle, wallet, onChanged }: { circle: CircleInfo; wallet: any; onChanged: () => void }) {
  const t = useT();
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
          ? t("admin.policy.openMsg")
          : t("admin.policy.gatedMsg"),
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
      <SectionHead title={t("admin.policy.title")} sub={t("admin.policy.sub")} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className={`pill ${circle.open ? "" : "pill-dim"}`}>
            {circle.open ? t("admin.policy.openPill") : t("admin.policy.gatedPill")}
          </span>
          <p className="muted sm" style={{ margin: "6px 0 0" }}>
            {circle.open
              ? t("admin.policy.openDesc")
              : t("admin.policy.gatedDesc")}
          </p>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => toggle(!circle.open)}>
          {busy ? "…" : circle.open ? t("admin.policy.requireBtn") : t("admin.policy.makeOpenBtn")}
        </button>
      </div>
      <TxNoteView note={note} />
    </section>
  );
}

// ===========================================================================
// Self-support (Tradition 7) — donation required into the treasury to renew
// ===========================================================================

function ConfigSection({ circle, wallet }: { circle: CircleInfo; wallet: any }) {
  const t = useT();
  const [cfg, setCfg] = useState<CircleConfigFields | null>(null);
  const [sol, setSol] = useState("");
  const [quorumPct, setQuorumPct] = useState(""); // % of eligible members; blank = default ⅓
  const [passPct, setPassPct] = useState("");      // % yes of turnout; blank = default majority
  const [allowlist, setAllowlist] = useState(false);
  const [allowed, setAllowed] = useState<AllowEntry[]>([]);
  const [newAllow, setNewAllow] = useState("");
  const [busy, setBusy] = useState<string | false>(false);
  const [note, setNote] = useState<TxNote>(null);

  const pctFromFrac = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100).toString() : "");

  const loadAllow = useCallback(() => {
    listTreasuryAllowed(circle.pubkey).then((rows) => setAllowed(rows.filter((r) => r.allowed))).catch(() => {});
  }, [circle.pubkey]);

  useEffect(() => {
    getCircleConfig(circle.pubkey).then((c) => {
      setCfg(c);
      setSol(c.renewDonationLamports ? (c.renewDonationLamports / LAMPORTS_PER_SOL).toString() : "");
      setQuorumPct(pctFromFrac(c.voteQuorumNum, c.voteQuorumDen));
      setPassPct(pctFromFrac(c.votePassNum, c.votePassDen));
      setAllowlist(c.treasuryAllowlist);
    });
    loadAllow();
  }, [circle.pubkey, loadAllow]);

  async function addAllow() {
    if (!wallet) return;
    const r = pk(newAllow);
    if (!r) return setNote({ kind: "err", text: t("admin.config.errRecipient") });
    setBusy("add"); setNote(null);
    try {
      const sig = await setTreasuryAllow(wallet, new PublicKey(circle.pubkey), r, true);
      setNote({ kind: "ok", text: t("admin.config.addedMsg"), sig });
      setNewAllow(""); loadAllow();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(false); }
  }

  async function removeAllow(recipient: string) {
    if (!wallet) return;
    setBusy("rm" + recipient); setNote(null);
    try {
      const sig = await setTreasuryAllow(wallet, new PublicKey(circle.pubkey), new PublicKey(recipient), false);
      setNote({ kind: "ok", text: t("admin.config.removedMsg"), sig });
      loadAllow();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(false); }
  }

  function pctToFrac(s: string): [number, number] {
    const v = parseFloat(s);
    return Number.isFinite(v) && v > 0 ? [Math.round(v), 100] : [0, 0];
  }

  async function save() {
    if (!wallet) return;
    const lamports = Math.round(parseFloat(sol || "0") * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports < 0) return setNote({ kind: "err", text: t("admin.config.errAmount") });
    const [qn, qd] = pctToFrac(quorumPct);
    const [pn, pd] = pctToFrac(passPct);
    setBusy("save"); setNote(null);
    try {
      const next: CircleConfigFields = {
        ...(cfg ?? DEFAULT_CONFIG),
        renewDonationLamports: lamports,
        voteQuorumNum: qn, voteQuorumDen: qd,
        votePassNum: pn, votePassDen: pd,
        treasuryAllowlist: allowlist,
      };
      const sig = await setCircleConfig(wallet, new PublicKey(circle.pubkey), next);
      setNote({ kind: "ok", text: t("admin.config.savedMsg"), sig });
      setCfg(next);
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <SectionHead title={t("admin.config.title")} sub={t("admin.config.sub")} />
      <div className="form">
        <div className="form-row">
          <label>{t("admin.config.renewalDonation")}</label>
          <input type="number" min="0" step="0.01" value={sol} onChange={(e) => setSol(e.target.value)} placeholder="0" style={{ maxWidth: 130 }} />
          <span className="sm muted">{t("admin.config.renewalHint")}</span>
        </div>
        <div className="form-row">
          <label>{t("admin.config.quorumLabel")}</label>
          <input type="number" min="0" max="100" step="1" value={quorumPct} onChange={(e) => setQuorumPct(e.target.value)} placeholder="33" style={{ maxWidth: 90 }} />
          <span className="sm muted">{t("admin.config.quorumHint")}</span>
        </div>
        <div className="form-row">
          <label>{t("admin.config.passLabel")}</label>
          <input type="number" min="0" max="100" step="1" value={passPct} onChange={(e) => setPassPct(e.target.value)} placeholder="50" style={{ maxWidth: 90 }} />
          <span className="sm muted">{t("admin.config.passHint")}</span>
        </div>
        <label className="form-row" style={{ cursor: "pointer", gap: 8 }}>
          <input type="checkbox" checked={allowlist} onChange={(e) => setAllowlist(e.target.checked)} style={{ width: "auto", flex: "0 0 auto" }} />
          <span className="sm">{t("admin.config.restrictLabel")} <span className="muted">{t("admin.config.restrictHint")}</span></span>
        </label>
        <div className="form-actions">
          <button className="btn btn-sm" disabled={!!busy || cfg === null} onClick={save}>{busy === "save" ? t("admin.config.saving") : t("admin.config.savePolicy")}</button>
        </div>
      </div>

      {allowlist && (
        <>
          <h4 style={{ margin: "14px 0 6px" }}>{t("admin.config.allowlistHeading")}</h4>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input className="mono" value={newAllow} onChange={(e) => setNewAllow(e.target.value)} placeholder={t("admin.config.recipientPlaceholder")} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn btn-sm" disabled={busy === "add"} onClick={addAllow}>{busy === "add" ? t("admin.config.adding") : t("admin.config.add")}</button>
          </div>
          {allowed.length === 0 ? (
            <p className="muted sm" style={{ marginTop: 6 }}>{t("admin.config.noRecipients")}</p>
          ) : (
            <div className="members" style={{ marginTop: 8 }}>
              {allowed.map((a) => (
                <div className="member" key={a.recipient}>
                  <Identicon seed={a.recipient} size={26} />
                  <div className="meta" style={{ flex: 1, minWidth: 0 }}><div className="name mono">{short(a.recipient)}</div></div>
                  <button className="btn btn-sm btn-ghost" disabled={busy === "rm" + a.recipient} onClick={() => removeAllow(a.recipient)}>{t("admin.config.remove")}</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <TxNoteView note={note} />
    </section>
  );
}

// ===========================================================================
// The 7 seats — view, message (✉), and change (opens a 4-of-7 RotateSeat vote)
// ===========================================================================

function SeatsSection({ circle, wallet, me }: { circle: CircleInfo; wallet: any; me: string }) {
  const t = useT();
  const mySeats = mySeatIndices(circle.seats, me);
  const [editing, setEditing] = useState<number | null>(null);
  const [newHolder, setNewHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<TxNote>(null);

  async function proposeRotate(i: number) {
    let holder: PublicKey | null = null;
    try { holder = new PublicKey(newHolder.trim()); } catch { holder = null; }
    if (!holder) return setNote({ kind: "err", text: t("admin.seats.errNewHolder") });
    setBusy(true); setNote(null);
    try {
      const sig = await propose(wallet, new PublicKey(circle.pubkey), actionRotateSeat(i, holder));
      setNote({ kind: "ok", text: t("admin.seats.rotateOpenedMsg"), sig });
      setEditing(null); setNewHolder("");
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <SectionHead title={t("admin.seats.title")} sub={t("admin.seats.sub")} />
      <div className="members">
        {SEAT_ROLES.map((role, i) => (
          <div className="member" key={i}>
            <RoleIcon seat={i} size={26} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{role}</div>
              <div className="sub mono">{short(circle.seats[i])}{circle.seats[i] === me ? ` · ${t("admin.seats.you")}` : ""}</div>
            </div>
            {editing === i ? (
              <div className="row" style={{ gap: 6 }}>
                <input className="mono" value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder={t("admin.seats.newWalletPlaceholder")} style={{ width: 150 }} />
                <button className="btn btn-sm" disabled={busy} onClick={() => proposeRotate(i)}>{busy ? "…" : t("admin.seats.propose")}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>×</button>
              </div>
            ) : (
              <div className="row" style={{ gap: 6 }}>
                {circle.seats[i] !== PublicKey.default.toBase58() && (
                  <Link
                    href={`/inbox?to=${circle.seats[i]}`}
                    className="btn btn-sm btn-ghost"
                    title={t("admin.seats.msgTitle")}
                    aria-label={t("admin.seats.msgAria")}
                  >
                    ✉
                  </Link>
                )}
                {mySeats.length > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(i); setNewHolder(""); }}>{t("admin.seats.change")}</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <TxNoteView note={note} />
    </section>
  );
}

// ===========================================================================
// Council proposals (4-of-7)
// ===========================================================================

function CouncilSection({ circle, wallet, me }: { circle: CircleInfo; wallet: any; me: string }) {
  const t = useT();
  const [items, setItems] = useState<CouncilProposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<TxNote>(null);
  const [treasuryWallet, setTreasuryWallet] = useState<string | null>(null);
  const [membershipMint, setMembershipMint] = useState<string | null>(null);
  const mySeats = mySeatIndices(circle.seats, me);
  const isTreasurer = mySeats.includes(0); // SEAT_TREASURER

  const load = useCallback(() => {
    listCouncilProposals(circle.pubkey, 4)
      .then(setItems)
      .catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
    getTreasuryWallet(circle.pubkey).then(setTreasuryWallet).catch(() => setTreasuryWallet(null));
    getMembershipMint(circle.pubkey).then(setMembershipMint).catch(() => setMembershipMint(null));
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function act(label: string, run: () => Promise<string>) {
    setBusy(label);
    setNote(null);
    try {
      const sig = await run();
      setNote({ kind: "ok", text: t("admin.council.doneMsg"), sig });
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
        title={t("admin.council.title")}
        sub={t("admin.council.sub")}
      />

      <p className="muted sm" style={{ marginTop: -6 }}>
        {t("admin.council.stewardLabel")}{" "}
        {treasuryWallet ? <span className="mono">{short(treasuryWallet)}</span> : t("admin.council.noSteward")}
      </p>

      <p className="muted sm" style={{ marginTop: -2 }}>
        {t("admin.council.mintLabel")}{" "}
        {membershipMint ? (
          <span className="mono">{short(membershipMint)}</span>
        ) : isTreasurer ? (
          <button
            className="btn btn-sm"
            disabled={busy === "mint"}
            onClick={() =>
              act("mint", async () => {
                const { sig } = await createMembershipMint(wallet, new PublicKey(circle.pubkey));
                return sig;
              })
            }
          >
            {busy === "mint" ? t("admin.council.creating") : t("admin.council.createMint")}
          </button>
        ) : (
          t("admin.council.noMint")
        )}
      </p>

      <NewCouncilProposal circle={circle} wallet={wallet} disabled={!!busy} onDone={load} setNote={setNote} />

      <TxNoteView note={note} />

      {items === null && <p className="muted">{t("admin.council.loadingVotes")}</p>}
      {items && items.length === 0 && <p className="muted">{t("admin.council.noVotes")}</p>}

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
                    {p.approvals}/{p.threshold} {t("admin.council.approvals")}
                    {p.eligibleAt !== 0 && !armed && ` · ${t("admin.council.unlocks")} ${dateTime(p.eligibleAt)}`}
                    {iApproved && ` · ${t("admin.council.youApproved")}`}
                  </div>
                </div>
              </div>
              <div className="vote-actions">
                {canApprove && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`approve-${p.pubkey}`, () => approveProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `approve-${p.pubkey}` ? "…" : t("admin.council.approve")}
                  </button>
                )}
                {canExecute && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`exec-${p.pubkey}`, () => executeProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `exec-${p.pubkey}` ? "…" : t("admin.council.execute")}
                  </button>
                )}
                {canCancel && (
                  <button className="btn btn-sm btn-ghost" disabled={!!busy}
                    onClick={() => act(`cancel-${p.pubkey}`, () => cancelProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `cancel-${p.pubkey}` ? "…" : t("admin.council.cancel")}
                  </button>
                )}
                {p.kind === "withdrawTreasuryToken" && p.executed && !p.drained && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`wdt-${p.pubkey}`, () => withdrawTreasuryToken(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `wdt-${p.pubkey}` ? "…" : t("admin.council.withdrawTokens")}
                  </button>
                )}
                {p.kind === "setTreasuryWallet" && p.executed && !p.drained && (
                  <button className="btn btn-sm" disabled={!!busy}
                    onClick={() => act(`apply-${p.pubkey}`, () => applyTreasuryWallet(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey)))}>
                    {busy === `apply-${p.pubkey}` ? "…" : t("admin.council.apply")}
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"rotateSeat" | "migrateWallet" | "withdrawTreasury" | "withdrawTreasuryToken" | "setTreasuryWallet">("withdrawTreasury");
  const [seatIndex, setSeatIndex] = useState(0);
  const [a, setA] = useState(""); // newHolder / oldWallet / recipient / new treasury wallet
  const [b, setB] = useState(""); // newWallet / token mint
  const [amount, setAmount] = useState("0.1");
  const [tokenAmount, setTokenAmount] = useState(""); // raw base units of the token
  const [busy, setBusy] = useState(false);

  async function submit() {
    let action: any;
    if (kind === "rotateSeat") {
      const holder = pk(a);
      if (!holder) return setNote({ kind: "err", text: t("admin.seats.errNewHolder") });
      action = actionRotateSeat(seatIndex, holder);
    } else if (kind === "migrateWallet") {
      const oldW = pk(a), newW = pk(b);
      if (!oldW || !newW) return setNote({ kind: "err", text: t("admin.council.errBothWallets") });
      action = actionMigrateWallet(oldW, newW);
    } else if (kind === "setTreasuryWallet") {
      const w = pk(a);
      if (!w) return setNote({ kind: "err", text: t("admin.council.errTreasuryWallet") });
      // The program requires a multisig steward (m ≥ 2). Check before proposing
      // so the Council doesn't waste a vote on an address that will be rejected.
      const ms = await isMultisig(connection(), w);
      if (!ms.ok) {
        return setNote({
          kind: "err",
          text: `${t("admin.council.errMultisigPre")}${ms.reason || t("admin.council.notAMultisig")}${t("admin.council.errMultisigPost")}`,
        });
      }
      action = actionSetTreasuryWallet(w);
    } else if (kind === "withdrawTreasuryToken") {
      const mint = pk(b);
      const rcpt = pk(a);
      if (!mint) return setNote({ kind: "err", text: t("admin.council.errTokenMint") });
      if (!rcpt) return setNote({ kind: "err", text: t("admin.council.errRecipientAddr") });
      let raw: bigint;
      try {
        raw = BigInt(tokenAmount.trim());
      } catch {
        return setNote({ kind: "err", text: t("admin.council.errBaseUnits") });
      }
      if (raw <= BigInt(0)) return setNote({ kind: "err", text: t("admin.council.errAmountPositive") });
      action = actionWithdrawTreasuryToken(mint, raw, rcpt);
    } else {
      const rcpt = pk(a);
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      if (!rcpt) return setNote({ kind: "err", text: t("admin.council.errRecipientAddr") });
      if (!(lamports > 0)) return setNote({ kind: "err", text: t("admin.council.errAmountPositive") });
      action = actionWithdrawTreasury(BigInt(lamports), rcpt);
    }
    setBusy(true);
    setNote(null);
    try {
      const sig = await propose(wallet, new PublicKey(circle.pubkey), action);
      setNote({ kind: "ok", text: t("admin.council.proposalOpenedMsg"), sig });
      setOpen(false);
      setA(""); setB(""); setTokenAmount("");
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
        {t("admin.council.newVoteBtn")}
      </button>
    );

  return (
    <div className="form">
      <div className="form-row">
        <label>{t("admin.council.actionLabel")}</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
          <option value="withdrawTreasury">{t("admin.council.optWithdrawSol")}</option>
          <option value="withdrawTreasuryToken">{t("admin.council.optWithdrawToken")}</option>
          <option value="setTreasuryWallet">{t("admin.council.optChangeWallet")}</option>
          <option value="rotateSeat">{t("admin.council.optRotateSeat")}</option>
          <option value="migrateWallet">{t("admin.council.optMigrateWallet")}</option>
        </select>
      </div>

      {kind === "setTreasuryWallet" && (
        <div className="form-row">
          <label>{t("admin.council.newTreasuryWallet")}</label>
          <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("admin.council.stewardPlaceholder")} />
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            {t("admin.council.multisigHintPre")}<code>spl-token create-multisig 2 …</code>{t("admin.council.multisigHintOr")}<code>scripts/create-multisig.js</code>.
          </p>
        </div>
      )}

      {kind === "rotateSeat" && (
        <>
          <div className="form-row">
            <label>{t("admin.council.seatLabel")}</label>
            <select value={seatIndex} onChange={(e) => setSeatIndex(Number(e.target.value))}>
              {SEAT_ROLES.map((r, i) => <option key={r} value={i}>{r}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>{t("admin.council.newHolderLabel")}</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("admin.council.walletPlaceholder")} />
          </div>
        </>
      )}
      {kind === "migrateWallet" && (
        <>
          <div className="form-row">
            <label>{t("admin.council.oldWallet")}</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("admin.council.oldWalletPlaceholder")} />
          </div>
          <div className="form-row">
            <label>{t("admin.council.newWallet")}</label>
            <input value={b} onChange={(e) => setB(e.target.value)} placeholder={t("admin.council.newWalletPlaceholder2")} />
          </div>
        </>
      )}
      {kind === "withdrawTreasury" && (
        <>
          <div className="form-row">
            <label>{t("admin.council.amountSol")}</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-row">
            <label>{t("admin.council.recipient")}</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("admin.council.walletPlaceholder")} />
          </div>
        </>
      )}
      {kind === "withdrawTreasuryToken" && (
        <>
          <div className="form-row">
            <label>{t("admin.council.tokenMint")}</label>
            <input className="mono" value={b} onChange={(e) => setB(e.target.value)} placeholder={t("admin.council.mintPlaceholder")} />
          </div>
          <div className="form-row">
            <label>{t("admin.council.amountBaseUnits")}</label>
            <input type="number" min="0" step="1" value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} placeholder={t("admin.council.baseUnitsPlaceholder")} />
            <span className="sm muted">{t("admin.council.baseUnitsHint")}</span>
          </div>
          <div className="form-row">
            <label>{t("admin.council.recipient")}</label>
            <input value={a} onChange={(e) => setA(e.target.value)} placeholder={t("admin.council.walletPlaceholder")} />
          </div>
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-sm" onClick={submit} disabled={busy}>{busy ? t("admin.council.opening") : t("admin.council.openVote")}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)} disabled={busy}>{t("admin.council.cancel")}</button>
      </div>
      <p className="muted sm">{t("admin.council.contestNote")}</p>
    </div>
  );
}

// ===========================================================================
// Gas faucet (Epic 0) — first gas for neophytes, parrain-triggered
// ===========================================================================

function FaucetSection({ circle, wallet, isTreasurer, anySeat }: { circle: CircleInfo; wallet: any; isTreasurer: boolean; anySeat: boolean }) {
  const t = useT();
  const { signMessage } = useWallet();
  const [jar, setJar] = useState<FaucetInfo | null>(null);
  const [grantSol, setGrantSol] = useState("");
  const [refillSol, setRefillSol] = useState("0.05");
  const [period, setPeriod] = useState(86400);
  const [refills, setRefills] = useState<{ proposal: string; lamports: number; status: string; filled: boolean }[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null); // null = not opened yet
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<TxNote>(null);

  const load = useCallback(() => {
    getFaucet(new PublicKey(circle.pubkey))
      .then((f) => {
        setJar(f);
        setGrantSol((f.grantLamports / LAMPORTS_PER_SOL).toString());
      })
      .catch(() => {});
    // Refill proposals are ordinary member votes whose hash commits to (circle, amount);
    // the amount is only known to the browser that proposed it (local store).
    listMemberProposals(circle.pubkey)
      .then(async (ps) => {
        const known = ps
          .map((p) => ({ p, lamports: recallRefillAmount(p.descriptionHash) }))
          .filter((x): x is { p: MemberProposal; lamports: number } => x.lamports !== null);
        const rows = await Promise.all(
          known.map(async ({ p, lamports }) => ({
            proposal: p.pubkey,
            lamports,
            status: p.status,
            filled: p.status === "passed" ? await hasFaucetFill(new PublicKey(p.pubkey)) : false,
          }))
        );
        setRefills(rows);
      })
      .catch(() => {});
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function act(label: string, run: () => Promise<string>, okText: string) {
    if (!wallet) return;
    setBusy(label); setNote(null);
    try {
      const sig = await run();
      setNote({ kind: "ok", text: okText, sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveAmount() {
    const lamports = Math.round(parseFloat(grantSol || "0") * LAMPORTS_PER_SOL);
    if (!(lamports > 0)) return setNote({ kind: "err", text: t("admin.faucet.errGrant") });
    const clamped = Math.min(lamports, FAUCET_MAX_GRANT_LAMPORTS); // the program enforces the cap anyway
    await act("amount", () => setFaucetAmount(wallet, new PublicKey(circle.pubkey), clamped),
      `${t("admin.faucet.grantSetPre")}${clamped / LAMPORTS_PER_SOL}${t("admin.faucet.grantSetPost")}`);
  }

  async function proposeRefill() {
    const lamports = Math.round(parseFloat(refillSol || "0") * LAMPORTS_PER_SOL);
    if (!(lamports > 0)) return setNote({ kind: "err", text: t("admin.faucet.errRefill") });
    await act("refill", async () => (await proposeFaucetRefill(wallet, new PublicKey(circle.pubkey), lamports, period)).signature,
      t("admin.faucet.refillOpenedMsg"));
  }

  // The encrypted ledger (Epic 0): sealed drop-box entries only the treasurer's
  // derived key can open. One wallet signature unlocks the session.
  async function openLedger() {
    if (!wallet || !signMessage) return setNote({ kind: "err", text: t("admin.faucet.errNoSign") });
    setBusy("ledger"); setNote(null);
    try {
      setLedger(await readLedger(new PublicKey(circle.pubkey), wallet.publicKey, signMessage));
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <SectionHead
        title={t("admin.faucet.title")}
        sub={t("admin.faucet.sub")}
      />

      {jar === null ? (
        <p className="muted">{t("admin.faucet.loading")}</p>
      ) : !jar.exists ? (
        anySeat ? (
          <button className="btn btn-sm" disabled={busy === "init"}
            onClick={() => act("init", () => initFaucet(wallet, new PublicKey(circle.pubkey)), t("admin.faucet.openedMsg"))}>
            {busy === "init" ? t("admin.faucet.opening") : t("admin.faucet.openBtn")}
          </button>
        ) : (
          <p className="muted sm">{t("admin.faucet.noJar")}</p>
        )
      ) : (
        <>
          <p className="muted sm" style={{ marginTop: -6 }}>
            {t("admin.faucet.jarBalance")} <strong>{(jar.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL</strong> ·{" "}
            {t("admin.faucet.grantLabel")} <strong>{jar.grantLamports / LAMPORTS_PER_SOL} SOL</strong> ·{" "}
            {jar.granted} {jar.granted === 1 ? t("admin.faucet.grantSingular") : t("admin.faucet.grantPlural")} {t("admin.faucet.paid")}
          </p>

          {isTreasurer && (
            <div className="form-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <label>{t("admin.faucet.perGrantAmount")}</label>
              <input type="number" min="0" step="0.0001" value={grantSol} onChange={(e) => setGrantSol(e.target.value)} style={{ maxWidth: 120 }} />
              <span className="sm muted">{t("admin.faucet.solMax")} {FAUCET_MAX_GRANT_LAMPORTS / LAMPORTS_PER_SOL}</span>
              <button className="btn btn-sm" disabled={busy === "amount"} onClick={saveAmount}>{busy === "amount" ? "…" : t("admin.faucet.set")}</button>
              {jar.granted > 0 && (
                <p className="sm muted" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
                  {t("admin.faucet.pauseNote")}
                </p>
              )}
            </div>
          )}

          <div className="form-row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <label>{t("admin.faucet.proposeRefill")}</label>
            <input type="number" min="0" step="0.01" value={refillSol} onChange={(e) => setRefillSol(e.target.value)} style={{ maxWidth: 120 }} />
            <span className="sm muted">
              {t("admin.faucet.refillMaxPre")}{((jar.grantLamports * FAUCET_MAX_REFILL_GRANTS) / LAMPORTS_PER_SOL).toFixed(2)}{t("admin.faucet.refillMaxPost")}
            </span>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.secs} value={p.secs}>{p.label}</option>)}
            </select>
            <button className="btn btn-sm" disabled={busy === "refill"} onClick={proposeRefill}>{busy === "refill" ? t("admin.faucet.opening") : t("admin.faucet.openRefillVote")}</button>
          </div>

          {refills.length > 0 && (
            <div className="votes" style={{ marginTop: 8 }}>
              {refills.map((r) => (
                <div className="vote" key={r.proposal}>
                  <div className="vote-main">
                    <StatusDot status={r.filled ? "executed" : r.status} />
                    <div>
                      <div className="name">{t("admin.faucet.refillPre")}{r.lamports / LAMPORTS_PER_SOL}{t("admin.faucet.refillPost")}</div>
                      <div className="sub">{r.filled ? t("admin.faucet.refilled") : r.status}</div>
                    </div>
                  </div>
                  <div className="vote-actions">
                    {r.status === "passed" && !r.filled && (
                      <button className="btn btn-sm" disabled={busy === "fill" + r.proposal}
                        onClick={() => act("fill" + r.proposal,
                          () => refillFaucet(wallet, new PublicKey(circle.pubkey), new PublicKey(r.proposal), r.lamports),
                          t("admin.faucet.refillExecMsg"))}>
                        {busy === "fill" + r.proposal ? "…" : t("admin.faucet.executeRefill")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isTreasurer && (
            <div style={{ marginTop: 10 }}>
              {ledger === null ? (
                <button className="btn btn-sm btn-ghost" disabled={busy === "ledger"} onClick={openLedger}>
                  {busy === "ledger" ? t("admin.faucet.decrypting") : t("admin.faucet.openLedger")}
                </button>
              ) : (
                <>
                  <p className="muted sm" style={{ margin: "0 0 4px" }}>
                    {t("admin.faucet.ledgerIntro")}{" "}
                    {ledger.length} {ledger.length === 1 ? t("admin.faucet.entry") : t("admin.faucet.entries")} {t("admin.faucet.ledgerVs")} {jar.granted} {jar.granted === 1 ? t("admin.faucet.grantSingular") : t("admin.faucet.grantPlural")} {t("admin.faucet.onChain")}
                    {ledger.length === jar.granted ? t("admin.faucet.reconciled") : t("admin.faucet.inTransit")}
                  </p>
                  {ledger.length > 0 && (
                    <table className="sm" style={{ width: "100%" }}>
                      <thead><tr><th align="left">{t("admin.faucet.thDay")}</th><th align="left">{t("admin.faucet.thParrain")}</th><th align="left">{t("admin.faucet.thNeophyte")}</th><th align="right">{t("admin.faucet.thAmount")}</th></tr></thead>
                      <tbody>
                        {ledger.map((e, i) => (
                          <tr key={i}>
                            <td>{e.day}</td>
                            <td><code>{e.codeParrain}</code></td>
                            <td><code>{e.codeNeophyte}</code></td>
                            <td align="right">{e.amountLamports / LAMPORTS_PER_SOL} SOL</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <TxNoteView note={note} />
    </section>
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

// ===========================================================================
// Seat elections (F28) — members elect a servant into a seat (anonymous ZK vote)
// ===========================================================================

function SeatElectionsSection({ circle, wallet, anySeat }: { circle: CircleInfo; wallet: any; anySeat: boolean }) {
  const t = useT();
  const [elections, setElections] = useState<SeatElectionInfo[] | null>(null);
  const [props, setProps] = useState<Record<string, MemberProposal>>({});
  const [seatIdx, setSeatIdx] = useState(3);
  const [cand, setCand] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<TxNote>(null);

  const load = useCallback(() => {
    listSeatElections(circle.pubkey).then(setElections).catch(() => setElections([]));
    listMemberProposals(circle.pubkey).then((ps) => setProps(Object.fromEntries(ps.map((p) => [p.pubkey, p])))).catch(() => {});
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function open() {
    const c = pk(cand);
    if (!c) return setNote({ kind: "err", text: t("admin.elections.errCandidate") });
    setBusy("open"); setNote(null);
    try {
      const sig = await proposeSeatElection(wallet, new PublicKey(circle.pubkey), seatIdx, c, days * 86400);
      setNote({ kind: "ok", text: `${t("admin.elections.electionOpenedPre")}${SEAT_ROLES[seatIdx]}${t("admin.elections.electionOpenedMid")}${days}${t("admin.elections.electionOpenedPost")}`, sig });
      setCand(""); load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function install(e: SeatElectionInfo) {
    setBusy("i" + e.pubkey); setNote(null);
    try {
      const sig = await installElectedSeat(wallet, new PublicKey(circle.pubkey), new PublicKey(e.proposal));
      setNote({ kind: "ok", text: t("admin.elections.installedMsg"), sig });
      load();
    } catch (e2: any) { setNote({ kind: "err", text: String(e2?.message || e2) }); }
    finally { setBusy(null); }
  }

  return (
    <section className="card">
      <SectionHead title={t("admin.elections.title")} sub={t("admin.elections.sub")} />
      {anySeat ? (
        <div className="form-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select value={seatIdx} onChange={(e) => setSeatIdx(Number(e.target.value))}>
            {SEAT_ROLES.map((r, i) => <option key={i} value={i}>{r}</option>)}
          </select>
          <input className="mono" value={cand} onChange={(e) => setCand(e.target.value)} placeholder={t("admin.elections.candidatePlaceholder")} style={{ flex: 1, minWidth: 160 }} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}d</option>)}
          </select>
          <button className="btn btn-sm" disabled={busy === "open"} onClick={open}>{busy === "open" ? t("admin.elections.opening") : t("admin.elections.openBtn")}</button>
        </div>
      ) : <p className="muted sm">{t("admin.elections.onlyCouncil")}</p>}

      <p className="muted sm" style={{ marginTop: 8 }}>
        {t("admin.elections.info")}
      </p>

      <TxNoteView note={note} />

      {elections && elections.length > 0 && (
        <div className="votes" style={{ marginTop: 8 }}>
          {elections.map((e) => {
            const p = props[e.proposal];
            const st = e.installed ? t("admin.elections.installed") : p?.status ?? "…";
            return (
              <div className="vote" key={e.pubkey}>
                <div className="vote-main">
                  <RoleIcon seat={e.seatIndex} size={22} />
                  <div>
                    <div className="name">{SEAT_ROLES[e.seatIndex]} → {short(e.candidate)}</div>
                    <div className="sub">{p ? `${p.yes}/${p.yes + p.no} ${t("admin.elections.yes")} · ${st}` : st}</div>
                  </div>
                </div>
                <div className="vote-actions">
                  {p?.status === "passed" && !e.installed && (
                    <button className="btn btn-sm" disabled={busy === "i" + e.pubkey} onClick={() => install(e)}>{busy === "i" + e.pubkey ? "…" : t("admin.elections.install")}</button>
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

function MemberVotesSection({ circle, wallet }: { circle: CircleInfo; wallet: any }) {
  const t = useT();
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
    if (!desc.trim()) return setNote({ kind: "err", text: t("admin.memberVotes.errDescribe") });
    setBusy("create");
    setNote(null);
    try {
      const sig = await createMemberProposal(wallet, new PublicKey(circle.pubkey), desc.trim(), period);
      setNote({ kind: "ok", text: t("admin.memberVotes.openedMsg"), sig });
      setDesc(""); setOpen(false);
      load();
    } catch (e: any) {
      const m = String(e?.message || e);
      setNote({
        kind: "err",
        text: m.includes("AccountNotInitialized") || m.includes("member_tree")
          ? t("admin.memberVotes.errNoTree")
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
      const sig = await finalizeMemberProposal(wallet, new PublicKey(circle.pubkey), new PublicKey(p.pubkey));
      setNote({ kind: "ok", text: t("admin.memberVotes.outcomeMsg"), sig });
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
        title={t("admin.memberVotes.title")}
        sub={t("admin.memberVotes.sub")}
      />

      {!open ? (
        <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
          {t("admin.memberVotes.newBtn")}
        </button>
      ) : (
        <div className="form">
          <div className="form-row col">
            <label>{t("admin.memberVotes.questionLabel")}</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
              placeholder={t("admin.memberVotes.questionPlaceholder")} />
          </div>
          <div className="form-row">
            <label>{t("admin.memberVotes.periodLabel")}</label>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.secs} value={p.secs}>{p.label}</option>)}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn btn-sm" onClick={create} disabled={busy === "create"}>
              {busy === "create" ? t("admin.memberVotes.opening") : t("admin.memberVotes.openVote")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>{t("admin.memberVotes.cancel")}</button>
          </div>
          <p className="muted sm">{t("admin.memberVotes.hashNote")}</p>
        </div>
      )}

      <TxNoteView note={note} />

      {items === null && <p className="muted">{t("admin.memberVotes.loading")}</p>}
      {items && items.length === 0 && <p className="muted">{t("admin.memberVotes.none")}</p>}

      <div className="votes">
        {items?.map((p) => (
          <div className="vote" key={p.pubkey}>
            <div className="vote-main">
              <StatusDot status={p.status} />
              <div>
                <div className="name">{p.description || `${t("admin.memberVotes.proposalPrefix")}${short(p.descriptionHash)}`}</div>
                <div className="sub">
                  {p.yes} {t("admin.memberVotes.yes")} · {p.no} {t("admin.memberVotes.no")} · {t("admin.memberVotes.of")} {p.eligibleCount} {t("admin.memberVotes.eligible")} ·{" "}
                  {p.status === "running" ? `${t("admin.memberVotes.ends")} ${dateTime(p.deadline)}` : `${t("admin.memberVotes.ended")} ${day(p.deadline)}`}
                  {p.finalized && (p.passed ? t("admin.memberVotes.passed") : t("admin.memberVotes.failed"))}
                </div>
              </div>
            </div>
            <div className="vote-actions">
              {p.status === "ended-unfinalized" && (
                <button className="btn btn-sm" disabled={busy === p.pubkey} onClick={() => finalize(p)}>
                  {busy === p.pubkey ? "…" : t("admin.memberVotes.recordOutcome")}
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

function MembersSection({ circle, wallet, amSecretary, anySeat }: { circle: CircleInfo; wallet: any; amSecretary: boolean; anySeat: boolean }) {
  const t = useT();
  const [items, setItems] = useState<CircleMember[] | null>(null);
  const [note, setNote] = useState<TxNote>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [ownerInput, setOwnerInput] = useState("");
  const [commitInput, setCommitInput] = useState(""); // member's commitment from a join request
  const [chips, setChips] = useState<Chip[]>([]);
  const [chipPick, setChipPick] = useState<Record<string, number>>({}); // commitment → milestone
  const canAdmit = amSecretary || circle.open;

  const load = useCallback(() => {
    listCircleMembers(circle.pubkey)
      .then(setItems)
      .catch((e) => setNote({ kind: "err", text: String(e?.message || e) }));
    listProgressTokens(circle.pubkey).then(setChips).catch(() => {});
  }, [circle.pubkey]);
  useEffect(load, [load]);

  async function award(m: CircleMember) {
    const milestone = chipPick[m.commitment] ?? MILESTONES[0];
    setBusy("chip-" + m.pubkey); setNote(null);
    try {
      const sig = await issueProgressToken(wallet, new PublicKey(circle.pubkey), m.commitment, milestone);
      setNote({ kind: "ok", text: `${t("admin.members.awardedPre")}${milestoneLabel(milestone)}${t("admin.members.awardedPost")}`, sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: /already in use|exists/i.test(String(e?.message || e)) ? t("admin.members.errChipUsed") : String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const owner = ownerInput.trim() ? pk(ownerInput) : PublicKey.default;
    if (owner === null) return setNote({ kind: "err", text: t("admin.members.errOwner") });
    // Fulfilling a member's join request: use THEIR commitment (so their
    // anonymous identity matches). Otherwise mint a fresh anonymous commitment.
    let commitment: Uint8Array;
    if (commitInput.trim()) {
      const parsed = hexToBytes32(commitInput);
      if (!parsed) return setNote({ kind: "err", text: t("admin.members.errCommitment") });
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
      setNote({ kind: "ok", text: `${t("admin.members.issuedMsg")} ${emailNote(emailRes)}`, sig });
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
      setNote({ kind: "ok", text: t("admin.members.renewedMsg"), sig });
      load();
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(m: CircleMember) {
    if (!confirm(t("admin.members.confirmDelete"))) return;
    setBusy("revoke-" + m.pubkey);
    setNote(null);
    try {
      const sig = await revokeMembership(wallet, new PublicKey(circle.pubkey), new PublicKey(m.pubkey));
      setNote({ kind: "ok", text: t("admin.members.deletedMsg"), sig });
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
        title={t("admin.members.title")}
        sub={t("admin.members.sub")}
      />

      {canAdmit ? (
        !formOpen ? (
          <button className="btn btn-sm" onClick={() => setFormOpen(true)} style={{ marginBottom: 12 }}>
            {t("admin.members.admitBtn")}
          </button>
        ) : (
          <div className="form">
            <div className="form-row col">
              <label>{t("admin.members.ownerLabel")}</label>
              <input value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} className="mono"
                placeholder={t("admin.members.ownerPlaceholder")} />
            </div>
            <div className="form-row col">
              <label>{t("admin.members.commitmentLabel")}</label>
              <input value={commitInput} onChange={(e) => setCommitInput(e.target.value)} className="mono"
                placeholder={t("admin.members.commitmentPlaceholder")} />
            </div>
            <div className="form-actions">
              <button className="btn btn-sm" onClick={add} disabled={busy === "add"}>
                {busy === "add" ? t("admin.members.issuing") : t("admin.members.issueBtn")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setFormOpen(false); setCommitInput(""); }}>{t("admin.members.cancel")}</button>
            </div>
            <p className="muted sm">
              {circle.open
                ? t("admin.members.openNote")
                : t("admin.members.gatedNote")}
            </p>
          </div>
        )
      ) : (
        <p className="muted sm">{t("admin.members.onlySecretaryPre")}<strong>{t("admin.members.scribeSecretary")}</strong>{t("admin.members.onlySecretaryPost")}</p>
      )}

      <TxNoteView note={note} />

      {items === null && <p className="muted">{t("admin.members.loading")}</p>}
      {items && items.length === 0 && <p className="muted">{t("admin.members.none")}</p>}

      <div className="members">
        {items?.map((m) => (
          <div className="member" key={m.pubkey}>
            <Identicon seed={m.commitment} size={34} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name mono">{short(m.commitment)}</div>
              <div className="sub">
                {m.owner ? `${t("admin.members.ownerPrefix")}${short(m.owner)}` : t("admin.members.fullyAnon")} ·{" "}
                {m.active ? `${t("admin.members.through")} ${day(m.expiresAt)}` : `${t("admin.members.expiredPrefix")} ${day(m.expiresAt)}`}
              </div>
              {chips.filter((c) => c.member === m.commitment).length > 0 && (
                <div className="sub" style={{ marginTop: 2 }}>
                  {chips.filter((c) => c.member === m.commitment).map((c) => (
                    <span key={c.milestone} className="badge badge-alt" style={{ marginRight: 4 }}>🏅 {milestoneLabel(c.milestone)}</span>
                  ))}
                </div>
              )}
              {anySeat && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <select value={chipPick[m.commitment] ?? MILESTONES[0]} onChange={(e) => setChipPick((p) => ({ ...p, [m.commitment]: Number(e.target.value) }))} style={{ maxWidth: 130 }}>
                    {MILESTONES.map((d) => <option key={d} value={d}>{milestoneLabel(d)}</option>)}
                  </select>
                  <button className="btn btn-sm btn-ghost" disabled={busy === "chip-" + m.pubkey} onClick={() => award(m)}>{busy === "chip-" + m.pubkey ? "…" : t("admin.members.awardChip")}</button>
                </div>
              )}
            </div>
            <span className={`pill ${m.active ? "" : "pill-dim"}`}>{m.active ? t("admin.members.active") : t("admin.members.expired")}</span>
            <div className="member-actions">
              <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => renew(m)}>
                {busy === m.pubkey ? "…" : t("admin.members.renew")}
              </button>
              {amSecretary ? (
                <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => revoke(m)}>
                  {busy === "revoke-" + m.pubkey ? "…" : t("admin.members.delete")}
                </button>
              ) : (
                <button className="btn btn-sm btn-disabled" disabled title={t("admin.members.deleteTitle")}>
                  {t("admin.members.delete")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted sm" style={{ marginTop: 10 }}>
        <strong>{t("admin.members.delete")}</strong>{t("admin.members.deleteNote1")}<strong>{t("admin.members.suspend")}</strong>{t("admin.members.deleteNote2")}
      </p>
    </section>
  );
}

// ===========================================================================
// Small shared bits
// ===========================================================================

type TxNote = { kind: "ok" | "err"; text: string; sig?: string } | null;

function TxNoteView({ note }: { note: TxNote }) {
  const t = useT();
  if (!note) return null;
  return (
    <p className={note.kind === "err" ? "error" : "ok-note"}>
      {note.text}
      {note.sig && (
        <>
          {" "}
          <a href={explorerTx(note.sig)} target="_blank" rel="noreferrer">{t("admin.common.viewTransaction")}</a>
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
