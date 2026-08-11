"use client";

// My Circle — the member's page. Connect a wallet to:
// - see your on-chain data (SOL balance + every Membership bound to your wallet),
// - join a Circle as your home circle (issued on-chain if you hold the
//   Secretary seat; otherwise a join request you hand to the Secretary),
// - practice the 7th Tradition: donate SOL to your home circle, any circle,
//   or the foundation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import {
  CircleInfo,
  JoinRequest,
  MyMembership,
  SECRETARY_SEAT,
  clearJoinRequest,
  connection,
  donateSol,
  explorerTx,
  findMyMemberships,
  foundationOf,
  getHomeCircle,
  getJoinRequests,
  hex,
  issueMembership,
  listCircles,
  saveJoinRequest,
  setHomeCircle,
  treasuryBalance,
} from "../../lib/member";
import { emailNote, notifyCircleEmail } from "../../lib/circleEmail";
import CircleAdmin from "../admin/CircleAdmin";
import { fileToAvatarDataUrl, getUserProfile, listTimezones, setUserProfile } from "../../lib/profile";
import { Chip, WingPeerInfo, endWingPeer, establishWingPeer, getWingPeer, listProgressTokens, listQuipuCords, memberCommitmentOf, milestoneLabel } from "../../lib/peers";
import QuipuNecklace from "../../components/QuipuNecklace";
import { Cord } from "../../lib/quipu";
import { MemberProposal, SeatElectionInfo, SEAT_ROLES, listCircleMembers, listMemberProposals, listSeatElections } from "../../lib/admin";
import { activateFaucet, getFaucet, hasFaucetGrant, listMenteesOf } from "../../lib/faucet";
import { flushLedgerQueue, recordGrantInLedger } from "../../lib/faucetLedger";
import { attestAdmission, getTwoSponsorPolicy, hasAttestation, issueProvisionalMembership } from "../../lib/admission";
import { attestAdmissionAnonymously, castMemberVote, haveVotingKey, newMemberIdentity } from "../../lib/zk-vote";

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, "") || "0";
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString();

export default function Me() {
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();

  const [circles, setCircles] = useState<CircleInfo[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const foundation = useMemo(() => foundationOf(circles), [circles]);
  const byPubkey = useMemo(() => new Map(circles.map((c) => [c.pubkey, c])), [circles]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const all = await listCircles();
      setCircles(all);
      setHome(getHomeCircle());
      setRequests(getJoinRequests());
      if (publicKey) {
        const [lamports, mine] = await Promise.all([
          connection().getBalance(publicKey),
          findMyMemberships(publicKey, all),
        ]);
        setBalance(lamports);
        setMemberships(mine);
        // A membership in a requested circle means the Secretary admitted you.
        for (const m of mine) clearJoinRequest(m.circle);
        setRequests(getJoinRequests());
      } else {
        setBalance(null);
        setMemberships([]);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      <h1>My Circle</h1>
      <p className="lede">
        Your anonymous on-chain life: memberships bound to your wallet, your home circle,
        and the 7th Tradition.
      </p>

      {error && <p className="error">{error}</p>}

      {!connected && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Connect a Solana wallet (top right) to see your memberships, join a Circle,
            and contribute to the 7th Tradition.
          </p>
        </div>
      )}

      {connected && publicKey && !loading && memberships.length === 0 && (
        <div className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>👋 New here? Getting started</h3>
          <ol className="sm" style={{ margin: "0 0 4px", paddingLeft: 18, lineHeight: 1.7 }}>
            <li><a href="/">Find a Circle near you</a> on the map — or <a href="/create">create your own</a>.</li>
            <li><strong>Join below</strong>: open Circles admit you instantly; others hand your join request to the Scribe-Secretary.</li>
            <li>Turn on <a href="/inbox">encrypted messaging</a> so your Circle can reach you privately.</li>
          </ol>
          <p className="muted sm" style={{ margin: 0 }}>Everything here is anonymous by default — a membership is a ZK commitment, not your name.</p>
        </div>
      )}

      {connected && publicKey && (
        <div className="grid two" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <WalletCard publicKey={publicKey} balance={balance} memberships={memberships} byPubkey={byPubkey} home={home} />
            <VotesCard wallet={wallet ?? null} memberships={memberships} />
            <MentorshipCard wallet={wallet ?? null} memberships={memberships} />
            <ProfileCard />
            <JoinCard
              circles={circles}
              wallet={wallet ?? null}
              owner={publicKey}
              home={home}
              memberships={memberships}
              requests={requests}
              loading={loading}
              onChanged={refresh}
              onHome={(c) => {
                setHomeCircle(c);
                setHome(c);
              }}
            />
          </div>
          <SeventhTraditionCard
            circles={circles}
            foundation={foundation}
            home={home}
            wallet={wallet ?? null}
            onDonated={refresh}
          />
        </div>
      )}

      {/* Seat-gated: renders only if this wallet holds a Council seat somewhere. */}
      {connected && <CircleAdmin />}
    </>
  );
}

// ---------------------------------------------------------------------------

function WalletCard({
  publicKey,
  balance,
  memberships,
  byPubkey,
  home,
}: {
  publicKey: PublicKey;
  balance: number | null;
  memberships: MyMembership[];
  byPubkey: Map<string, CircleInfo>;
  home: string | null;
}) {
  const addr = publicKey.toBase58();
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  useEffect(() => {
    const sync = () => setAvatar(getUserProfile().avatar);
    sync();
    window.addEventListener("aha:profile", sync);
    return () => window.removeEventListener("aha:profile", sync);
  }, []);
  return (
    <div className="card">
      <div className="row">
        {avatar
          ? /* eslint-disable-next-line @next/next/no-img-element */
            <img src={avatar} alt="" width={46} height={46} style={{ borderRadius: "50%", objectFit: "cover" }} />
          : <Identicon seed={addr} size={46} />}
        <div className="meta" style={{ flex: 1, minWidth: 0 }}>
          <div className="name addr" title={addr}>
            {addr.slice(0, 4)}…{addr.slice(-4)}
          </div>
          <div className="sub">
            {balance === null ? "…" : `${sol(balance)} SOL`}
          </div>
        </div>
      </div>

      <h3 style={{ margin: "16px 0 8px" }}>My memberships</h3>
      {memberships.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          No membership is bound to this wallet yet. Join a Circle below — fully anonymous
          memberships (no wallet bound) won't show here by design.
        </p>
      )}
      {memberships.map((m) => {
        const c = byPubkey.get(m.circle);
        const isSecretary = c?.seats[SECRETARY_SEAT] === addr;
        return (
          <div className="row" key={m.pubkey} style={{ padding: "8px 0" }}>
            <Identicon seed={m.circle} size={38} />
            <div className="meta" style={{ flex: 1 }}>
              <div className="name">
                {m.circleName}
                {home === m.circle && <span className="badge">HOME</span>}
                {isSecretary && <span className="badge badge-alt">SECRETARY</span>}
              </div>
              <div className="sub">
                {m.active ? `member through ${day(m.expiresAt)}` : `expired ${day(m.expiresAt)}`}
                {m.level > 0 ? ` · level ${m.level}` : ""}
              </div>
            </div>
            <span className="pill">{m.active ? "active" : "expired"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

const shortHex = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

type OpenVote = { circle: string; circleName: string; proposal: string; label: string; yes: number; no: number; commitment: string };

function VotesCard({ wallet, memberships }: { wallet: any; memberships: MyMembership[] }) {
  const [votes, setVotes] = useState<OpenVote[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const out: OpenVote[] = [];
    for (const m of memberships) {
      try {
        const [props, elections] = await Promise.all([listMemberProposals(m.circle), listSeatElections(m.circle)]);
        const byProp = new Map(elections.map((e: SeatElectionInfo) => [e.proposal, e]));
        for (const p of props as MemberProposal[]) {
          if (p.status !== "running") continue;
          const e = byProp.get(p.pubkey);
          const label = e ? `Elect ${shortHex(e.candidate)} → ${SEAT_ROLES[e.seatIndex] ?? `seat ${e.seatIndex}`}` : (p.description || "Member proposal");
          out.push({ circle: m.circle, circleName: m.circleName, proposal: p.pubkey, label, yes: p.yes, no: p.no, commitment: m.commitment });
        }
      } catch {}
    }
    setVotes(out);
  }, [memberships]);
  useEffect(() => { load(); }, [load]);

  async function vote(v: OpenVote, choice: boolean) {
    if (!wallet) return;
    if (!haveVotingKey(v.commitment)) {
      setNote({ kind: "err", text: "Your voting key isn't on this device — vote from the device you joined on, or rejoin to mint a votable membership." });
      return;
    }
    setBusy(v.proposal); setNote({ kind: "ok", text: "Proving your anonymous ballot… (a few seconds)" });
    try {
      await castMemberVote(wallet, v.circle, v.proposal, choice);
      setNote({ kind: "ok", text: `Anonymous ${choice ? "YES" : "NO"} ballot cast & verified on-chain.` });
      setDone((d) => ({ ...d, [v.proposal]: true }));
    } catch (e: any) {
      const msg = String(e?.message || e);
      setNote({ kind: "err", text: /already in use|nullifier/i.test(msg) ? "You've already voted on this proposal." : msg });
    } finally { setBusy(null); }
  }

  if (memberships.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Open votes</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>Anonymous one-member-one-vote (ZK). Your ballot is proved in your browser; the chain never learns it was you.</p>
      {votes === null && <p className="muted sm">Loading…</p>}
      {votes && votes.length === 0 && <p className="muted sm" style={{ margin: 0 }}>No open votes in your Circles.</p>}
      {votes && votes.map((v) => (
        <div key={v.proposal} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div className="name">{v.label}</div>
          <div className="sub">{v.circleName} · {v.yes} yes / {v.no} no</div>
          {done[v.proposal] ? (
            <p className="ok-note" style={{ margin: "6px 0 0" }}>✓ ballot cast</p>
          ) : (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn btn-sm" disabled={busy === v.proposal} onClick={() => vote(v, true)}>{busy === v.proposal ? "Proving…" : "Vote YES"}</button>
              <button className="btn btn-sm btn-ghost" disabled={busy === v.proposal} onClick={() => vote(v, false)}>Vote NO</button>
            </div>
          )}
        </div>
      ))}
      {note && <p className={note.kind === "err" ? "error" : "ok-note"} style={{ marginBottom: 0 }}>{note.text}</p>}
    </div>
  );
}

function MentorshipCard({ wallet, memberships }: { wallet: any; memberships: MyMembership[] }) {
  const [wings, setWings] = useState<Record<string, WingPeerInfo | null>>({});
  const [chips, setChips] = useState<Record<string, Chip[]>>({});
  const [cords, setCords] = useState<Record<string, Cord[]>>({});
  const [wingInput, setWingInput] = useState<Record<string, string>>({});
  const [attestInput, setAttestInput] = useState<Record<string, string>>({});
  // Neophytes I sponsor who can still receive the one-time first-gas grant.
  const [neophytes, setNeophytes] = useState<Record<string, { commitment: string }[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(() => {
    // Deliver any ledger entries a previous visit sealed but never sent
    // (their jitter window elapsed while the tab was closed).
    flushLedgerQueue().catch(() => {});
    for (const m of memberships) {
      getWingPeer(m.circle, m.commitment).then((w) => setWings((p) => ({ ...p, [m.circle]: w }))).catch(() => {});
      listProgressTokens(m.circle).then((all) => setChips((p) => ({ ...p, [m.circle]: all.filter((c) => c.member === m.commitment) }))).catch(() => {});
      listQuipuCords(m.circle).then((all) => setCords((p) => ({ ...p, [m.circle]: all.filter((c) => c.member === m.commitment).map((c) => ({ step: c.step, completedAt: c.completedAt, sponsor: c.sponsor })) }))).catch(() => {});
      // Parrain action (Epic 0): if I'm someone's wing, their faucet grant is
      // unspent, and they have a wallet — offer the one-time activation.
      getFaucet(new PublicKey(m.circle))
        .then(async (jar) => {
          if (!jar.exists) return setNeophytes((p) => ({ ...p, [m.circle]: [] }));
          const mentees = await listMenteesOf(m.circle, m.commitment);
          if (mentees.length === 0) return setNeophytes((p) => ({ ...p, [m.circle]: [] }));
          const members = await listCircleMembers(m.circle);
          const byCommit = new Map(members.map((x) => [x.commitment, x]));
          const eligible: { commitment: string }[] = [];
          for (const t of mentees) {
            const mem = byCommit.get(t.commitment);
            if (!mem?.owner || !mem.active) continue;
            if (await hasFaucetGrant(new PublicKey(m.circle), t.commitment)) continue;
            eligible.push({ commitment: t.commitment });
          }
          setNeophytes((p) => ({ ...p, [m.circle]: eligible }));
        })
        .catch(() => {});
    }
  }, [memberships]);
  useEffect(load, [load]);

  async function firstGas(m: MyMembership, menteeCommitment: string) {
    if (!wallet) return;
    setBusy("gas-" + menteeCommitment); setNote(null);
    try {
      // Anonymity mitigation (Epic 0): a short random pause before the transfer,
      // so grant transactions don't land at humanly-predictable moments (right
      // after a ceremony ends, the second a page loads). Weak by itself — real
      // timing privacy is the Epic 10 relayer — but free, and honest about it.
      const waitS = 15 + Math.floor(Math.random() * 105); // 15–120 s
      setNote({ kind: "ok", text: `Sending in about ${waitS}s (randomized timing) — keep this tab open.` });
      await new Promise((r) => setTimeout(r, waitS * 1000));

      await activateFaucet(wallet, new PublicKey(m.circle), m.commitment, menteeCommitment);

      // Treasurer's ledger (Epic 0): a sealed, codes-only entry, delivered to
      // the drop-box after its own independent random delay. Codes are shown
      // exactly once — the parrain keeps theirs, hands the neophyte the other.
      let tail = "";
      try {
        const circleInfo = (await listCircles()).find((c) => c.pubkey === m.circle);
        const treasurer = circleInfo?.seats?.[0];
        const jar = await getFaucet(new PublicKey(m.circle));
        const codes = treasurer && treasurer !== "11111111111111111111111111111111"
          ? await recordGrantInLedger(new PublicKey(m.circle), treasurer, jar.grantLamports)
          : null;
        tail = codes
          ? ` Ledger codes — yours: ${codes.codeParrain} · neophyte's: ${codes.codeNeophyte} (write them down; they are shown only once, and the treasurer sees only codes).`
          : " No ledger entry: the treasurer has not published a messaging key yet.";
      } catch {
        tail = " Ledger entry could not be prepared (the grant itself succeeded).";
      }
      setNote({ kind: "ok", text: "First-gas grant sent to your neophyte's wallet — welcome them." + tail });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  // Epic 1: I (a member in good standing) attest as parrain for a newcomer who
  // handed me their join code — one action after meeting them in circle.
  async function attestFor(m: MyMembership) {
    const code = (attestInput[m.circle] ?? "").trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(code)) { setNote({ kind: "err", text: "A join code is 64 hex characters." }); return; }
    if (!wallet) return;
    setBusy("attest-" + m.circle); setNote(null);
    try {
      // Epic 2: prefer the anonymous vouch-proof (no sponsor edge on-chain) when
      // this device holds the voting key; fall back to the named pilot form.
      if (haveVotingKey(m.commitment)) {
        await attestAdmissionAnonymously(wallet, m.circle, m.commitment, code);
        setNote({ kind: "ok", text: "Attested anonymously — your neophyte can join provisionally; nothing on-chain links you to them." });
      } else {
        await attestAdmission(wallet, new PublicKey(m.circle), m.commitment, code);
        setNote({ kind: "ok", text: "Attested (named pilot) — your neophyte can now join provisionally; a trusted servant completes their admission." });
      }
      setAttestInput((p) => ({ ...p, [m.circle]: "" }));
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function setWing(m: MyMembership) {
    const w = (wingInput[m.circle] ?? "").trim();
    if (!w || !wallet) return;
    setBusy("set-" + m.circle); setNote(null);
    try {
      const wingCommit = await memberCommitmentOf(m.circle, w);
      if (!wingCommit) throw new Error("That wallet isn't a (wallet-bound) member of this Circle.");
      await establishWingPeer(wallet, new PublicKey(m.circle), m.commitment, wingCommit);
      setNote({ kind: "ok", text: "WingPeer set." });
      setWingInput((p) => ({ ...p, [m.circle]: "" }));
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  async function endWing(m: MyMembership) {
    if (!wallet) return;
    setBusy("end-" + m.circle); setNote(null);
    try {
      await endWingPeer(wallet, new PublicKey(m.circle), m.commitment, m.commitment);
      setNote({ kind: "ok", text: "WingPeer ended." });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  if (memberships.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Mentorship &amp; progress</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>Your WingPeer (a member who mentors you) and your milestone chips, per Circle.</p>
      {memberships.map((m) => {
        const w = wings[m.circle];
        const cs = chips[m.circle] ?? [];
        return (
          <div key={m.pubkey} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div className="name">{m.circleName}</div>
            {/* The member's quipu (Epic 4): the cords as they hang. A member
                with none sees the bare cord — a beginning, not an absence. */}
            <div style={{ marginTop: 4 }}>
              <QuipuNecklace cords={cords[m.circle] ?? []} height={120} />
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              {cs.length ? cs.map((c) => <span key={c.milestone} className="badge badge-alt" style={{ marginRight: 4 }}>🏅 {milestoneLabel(c.milestone)}</span>) : <span className="muted">No chips yet.</span>}
            </div>
            <div className="sub" style={{ marginTop: 6 }}>
              WingPeer: {w && w.active ? <span className="mono">{w.wing.slice(0, 8)}…</span> : <span className="muted">none</span>}
              {w && w.active && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} disabled={busy === "end-" + m.circle} onClick={() => endWing(m)}>End</button>}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input className="mono" value={wingInput[m.circle] ?? ""} onChange={(e) => setWingInput((p) => ({ ...p, [m.circle]: e.target.value }))} placeholder="WingPeer's wallet address" style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-sm" disabled={busy === "set-" + m.circle} onClick={() => setWing(m)}>{busy === "set-" + m.circle ? "…" : (w && w.active ? "Change" : "Set WingPeer")}</button>
            </div>
            {(neophytes[m.circle] ?? []).map((t) => (
              <div className="row" key={t.commitment} style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span className="sub">You sponsor <span className="mono">{t.commitment.slice(0, 8)}…</span></span>
                <button className="btn btn-sm" disabled={busy === "gas-" + t.commitment} onClick={() => firstGas(m, t.commitment)}>
                  {busy === "gas-" + t.commitment ? "Sending…" : "Activate first-gas faucet"}
                </button>
              </div>
            ))}
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input className="mono" value={attestInput[m.circle] ?? ""} onChange={(e) => setAttestInput((p) => ({ ...p, [m.circle]: e.target.value }))} placeholder="Newcomer's join code (commitment)" style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-sm" disabled={busy === "attest-" + m.circle} onClick={() => attestFor(m)}>
                {busy === "attest-" + m.circle ? "…" : "Attest as parrain"}
              </button>
            </div>
          </div>
        );
      })}
      {note && <p className={note.kind === "err" ? "error" : "ok-note"} style={{ marginBottom: 0 }}>{note.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileCard() {
  const [profile, setProfile] = useState(() => getUserProfile());
  const [busy, setBusy] = useState(false);
  const tzs = useMemo(() => listTimezones(), []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const avatar = await fileToAvatarDataUrl(file);
      const next = { ...profile, avatar };
      setProfile(next);
      setUserProfile(next);
    } catch {
      /* ignore non-images */
    } finally {
      setBusy(false);
    }
  }
  function setTz(timezone: string) {
    const next = { ...profile, timezone: timezone || undefined };
    setProfile(next);
    setUserProfile(next);
  }
  function clearAvatar() {
    const next = { ...profile, avatar: undefined };
    setProfile(next);
    setUserProfile(next);
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>My profile</h3>
      <div className="row" style={{ gap: 12 }}>
        {profile.avatar ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profile.avatar} alt="" width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div className="muted sm" style={{ width: 48, height: 48, borderRadius: "50%", border: "1px dashed var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>—</div>
        )}
        <div className="meta" style={{ flex: 1 }}>
          <label className="sm">Avatar{" "}
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {profile.avatar && <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={clearAvatar}>Remove</button>}
        </div>
      </div>
      <div className="form-row col" style={{ marginTop: 10 }}>
        <label>Timezone</label>
        <select value={profile.timezone ?? ""} onChange={(e) => setTz(e.target.value)}>
          <option value="">Device default</option>
          {tzs.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <p className="muted sm" style={{ marginBottom: 0 }}>Stored on this device. The avatar replaces your Jazzicon here; the timezone localises message times.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function JoinCard({
  circles,
  wallet,
  owner,
  home,
  memberships,
  requests,
  loading,
  onChanged,
  onHome,
}: {
  circles: CircleInfo[];
  wallet: any;
  owner: PublicKey;
  home: string | null;
  memberships: MyMembership[];
  requests: JoinRequest[];
  loading: boolean;
  onChanged: () => void;
  onHome: (circle: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  const memberOf = useMemo(() => new Set(memberships.map((m) => m.circle)), [memberships]);
  const circle = circles.find((c) => c.pubkey === selected);
  const isSecretary = circle?.seats[SECRETARY_SEAT] === owner.toBase58();
  const isOpen = !!circle?.open;
  const canSelfIssue = (isOpen || isSecretary) && !!wallet;

  async function join() {
    if (!circle) return;
    setBusy(true);
    setNote(null);
    setSig(null);
    try {
      onHome(circle.pubkey);
      const commitment = await newMemberIdentity(); // votable identity: commitment = Poseidon(secret), secret kept on this device

      // Epic 1: in a two-sponsor Circle the door is the parrain's attestation.
      // If one exists for this commitment, enter provisionally; otherwise hand
      // the commitment to your parrain (same share flow as a join request).
      if (await getTwoSponsorPolicy(new PublicKey(circle.pubkey))) {
        if (await hasAttestation(new PublicKey(circle.pubkey), hex(commitment))) {
          const tx = await issueProvisionalMembership(wallet, new PublicKey(circle.pubkey), commitment, owner);
          setSig(tx);
          setNote(
            `Welcome — you are a provisional member of “${circle.name}”. Your page is live and your parrain can ` +
              "activate first gas; voting and roles open when a trusted servant confirms your admission."
          );
        } else {
          saveJoinRequest({
            circle: circle.pubkey,
            circleName: circle.name,
            commitment: hex(commitment),
            owner: owner.toBase58(),
            createdAt: Date.now(),
          });
          setNote(
            `“${circle.name}” admits by two sponsors. Share the request below with your parrain — ` +
              "once they attest, press Join again to enter provisionally."
          );
        }
        onChanged();
        return;
      }

      if (canSelfIssue) {
        // Permissionless circle → self-admit (open marker sent). Otherwise the
        // connected wallet is the Scribe-Secretary, who admits directly.
        const tx = await issueMembership(wallet, new PublicKey(circle.pubkey), commitment, owner, isOpen);
        setSig(tx);
        // F25: registration emails the Circle's address with the new member's wallet.
        const emailRes = await notifyCircleEmail({
          kind: "join",
          circleName: circle.name,
          circlePubkey: circle.pubkey,
          memberAddress: owner.toBase58(),
        });
        setNote(
          (isOpen
            ? `Welcome — you joined “${circle.name}”. `
            : `Welcome home — membership issued in “${circle.name}”. `) + emailNote(emailRes)
        );
        onChanged();
      } else {
        saveJoinRequest({
          circle: circle.pubkey,
          circleName: circle.name,
          commitment: hex(commitment),
          owner: owner.toBase58(),
          createdAt: Date.now(),
        });
        setNote(
          `“${circle.name}” is now your home circle. Membership is validated by the Circle's ` +
            "Scribe-Secretary — share the join request below with them."
        );
        onChanged();
      }
    } catch (e: any) {
      setNote("Could not join: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Join a Circle</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Pick your home circle. The only requirement for membership is the desire to reconnect.
      </p>
      <div className="row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ flex: 1 }}>
          <option value="">— choose a Circle —</option>
          {circles.map((c) => (
            <option key={c.pubkey} value={c.pubkey}>
              {c.name} ({c.memberCount} member{c.memberCount === 1 ? "" : "s"})
              {c.open ? " · open" : ""}
              {memberOf.has(c.pubkey) ? " — already a member" : ""}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!circle || busy || loading} onClick={join}>
          {busy ? "Joining…" : isOpen ? "Join" : isSecretary ? "Join (issue on-chain)" : "Request to join"}
        </button>
      </div>
      {circle && (
        <p className="muted sm" style={{ margin: "8px 0 0" }}>
          {isOpen
            ? "This Circle is open — you can join instantly, no validation needed."
            : "This Circle is validated — the Scribe-Secretary admits members."}
        </p>
      )}
      {circle && memberOf.has(circle.pubkey) && (
        <p className="muted" style={{ marginBottom: 0 }}>
          You're already a member of this Circle — joining again sets it as your home circle.
        </p>
      )}
      {note && <p style={{ marginBottom: 0 }}>{note}</p>}
      {sig && (
        <p style={{ marginBottom: 0 }}>
          <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      )}

      {requests.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 6px" }}>Pending join requests</h4>
          {requests.map((r) => (
            <div key={r.circle} className="request">
              <div className="name">{r.circleName}</div>
              <div className="sub">Give the Scribe-Secretary your wallet + this commitment:</div>
              <pre className="doc" style={{ maxHeight: 120, margin: "6px 0" }}>
                owner:      {r.owner}{"\n"}commitment: {r.commitment}
              </pre>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  clearJoinRequest(r.circle);
                  onChanged();
                }}
              >
                Dismiss
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SeventhTraditionCard({
  circles,
  foundation,
  home,
  wallet,
  onDonated,
}: {
  circles: CircleInfo[];
  foundation: CircleInfo | null;
  home: string | null;
  wallet: any;
  onDonated: () => void;
}) {
  type Target = "home" | "foundation" | string; // string = explicit circle pubkey
  const [target, setTarget] = useState<Target>("");

  // Circles (and so home/foundation) load after mount — default the target
  // once they arrive, without overriding a manual choice.
  useEffect(() => {
    if (target === "" && (home || foundation)) setTarget(home ? "home" : "foundation");
  }, [home, foundation]); // eslint-disable-line react-hooks/exhaustive-deps
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<number | null>(null);

  const resolved: CircleInfo | null = useMemo(() => {
    if (target === "home") return circles.find((c) => c.pubkey === home) ?? null;
    if (target === "foundation") return foundation;
    return circles.find((c) => c.pubkey === target) ?? null;
  }, [target, circles, home, foundation]);

  useEffect(() => {
    setTreasury(null);
    if (!resolved) return;
    treasuryBalance(new PublicKey(resolved.pubkey))
      .then(setTreasury)
      .catch(() => setTreasury(null));
  }, [resolved?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function give() {
    if (!resolved || !wallet) return;
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      setNote("Enter an amount in SOL.");
      return;
    }
    setBusy(true);
    setNote(null);
    setSig(null);
    try {
      const tx = await donateSol(wallet, new PublicKey(resolved.pubkey), BigInt(lamports));
      setSig(tx);
      setNote(`Thank you — ${amount} SOL to “${resolved.name}”. We are self-supporting through our own contributions.`);
      treasuryBalance(new PublicKey(resolved.pubkey)).then(setTreasury).catch(() => {});
      onDonated();
    } catch (e: any) {
      setNote("Donation failed: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>7th Tradition</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Every Circle is fully self-supporting, declining outside contributions. Give SOL to
        your home circle, any Circle, or the foundation — straight into its on-chain treasury,
        spendable only by Council group conscience.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="" disabled>
            — choose where to give —
          </option>
          <option value="home" disabled={!home}>
            My home circle{home ? ` — ${circles.find((c) => c.pubkey === home)?.name ?? ""}` : " (none set)"}
          </option>
          <option value="foundation" disabled={!foundation}>
            The foundation{foundation ? ` — ${foundation.name}` : " (not found on this cluster)"}
          </option>
          <optgroup label="Any Circle">
            {circles.map((c) => (
              <option key={c.pubkey} value={c.pubkey}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>

        <div className="row">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ flex: 1 }}
            aria-label="Amount in SOL"
          />
          <span className="muted">SOL</span>
          <button className="btn" disabled={!resolved || !wallet || busy} onClick={give}>
            {busy ? "Sending…" : "Give"}
          </button>
        </div>

        {resolved && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="sub">
              <Identicon seed={resolved.pubkey} size={18} className="inline-icon" /> {resolved.name}
            </span>
            <span className="pill">
              treasury: {treasury === null ? "…" : `${sol(treasury)} SOL`}
            </span>
          </div>
        )}

        {note && <p style={{ margin: 0 }}>{note}</p>}
        {sig && (
          <p style={{ margin: 0 }}>
            <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
