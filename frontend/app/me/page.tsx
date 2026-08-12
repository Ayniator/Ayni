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
import { activateFaucet, activateFaucetAnonymously, getFaucet, hasFaucetGrant, listMenteesOf } from "../../lib/faucet";
import { flushLedgerQueue, recordGrantInLedger } from "../../lib/faucetLedger";
import { attestAdmission, getTwoSponsorPolicy, hasAttestation, issueProvisionalMembership } from "../../lib/admission";
import { attestAdmissionAnonymously, castMemberVote, haveVotingKey, newMemberIdentity } from "../../lib/zk-vote";
import { ALL_MEMBERS, CHOSEN, DEFAULT_VISIBILITY, MY_CIRCLE, TIER_LABEL, Tier, Visibility, getVisibility, setVisibility, shieldMembership } from "../../lib/visibility";
import { isMembershipShielded, shieldingIsFullyPrivate } from "../../lib/shielded";
import { getOrCreateMaster } from "../../lib/masterSecret";
import { StoneMark } from "../../components/StoneMark";
import { setStoneMark } from "../../lib/stonemark";
import { useT } from "../../components/SettingsProvider";

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, "") || "0";
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString();

export default function Me() {
  const t = useT();
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
      <h1>{t("me.hero.title")}</h1>
      <p className="lede">
        {t("me.hero.lede")}
      </p>

      {error && <p className="error">{error}</p>}

      {!connected && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {t("me.notConnected")}
          </p>
        </div>
      )}

      {connected && publicKey && !loading && memberships.length === 0 && (
        <div className="card" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>👋 {t("me.gs.title")}</h3>
          <ol className="sm" style={{ margin: "0 0 4px", paddingLeft: 18, lineHeight: 1.7 }}>
            <li><a href="/">{t("me.gs.step1Link")}</a> {t("me.gs.step1Map")} <a href="/create">{t("me.gs.step1Link2")}</a>.</li>
            <li><strong>{t("me.gs.step2Strong")}</strong>{t("me.gs.step2Rest")}</li>
            <li>{t("me.gs.step3Pre")} <a href="/inbox">{t("me.gs.step3Link")}</a> {t("me.gs.step3Post")}</li>
          </ol>
          <p className="muted sm" style={{ margin: 0 }}><AnonymousNote t={t} /></p>
        </div>
      )}

      {connected && publicKey && (
        <div className="grid two" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <WalletCard publicKey={publicKey} balance={balance} memberships={memberships} byPubkey={byPubkey} home={home} />
            <VotesCard wallet={wallet ?? null} memberships={memberships} />
            <MentorshipCard wallet={wallet ?? null} memberships={memberships} />
            <VisibilityCard wallet={wallet ?? null} memberships={memberships} />
            <ShieldCard wallet={wallet ?? null} memberships={memberships} />
            <ProfileCard />
            <RecoveryCard />
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
  const t = useT();
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

      <h3 style={{ margin: "16px 0 8px" }}>{t("me.wallet.myMemberships")}</h3>
      {memberships.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("me.wallet.noMembership")}
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
                {home === m.circle && <span className="badge">{t("me.wallet.homeBadge")}</span>}
                {isSecretary && <span className="badge badge-alt">{t("me.wallet.secretaryBadge")}</span>}
              </div>
              <div className="sub">
                {m.active ? <>{t("me.wallet.memberThrough")} {day(m.expiresAt)}</> : <>{t("me.wallet.expired")} {day(m.expiresAt)}</>}
              </div>
            </div>
            <span className="pill">{m.active ? t("me.wallet.active") : t("me.wallet.expired")}</span>
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
  const t = useT();

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
      setNote({ kind: "err", text: t("me.votes.noVotingKey") });
      return;
    }
    setBusy(v.proposal); setNote({ kind: "ok", text: t("me.votes.proving") });
    try {
      await castMemberVote(wallet, v.circle, v.proposal, choice);
      setNote({ kind: "ok", text: `${t("me.votes.anonymousPre")} ${choice ? t("me.votes.yes") : t("me.votes.no")} ${t("me.votes.ballotCastSuffix")}` });
      setDone((d) => ({ ...d, [v.proposal]: true }));
    } catch (e: any) {
      const msg = String(e?.message || e);
      setNote({ kind: "err", text: /already in use|nullifier/i.test(msg) ? t("me.votes.alreadyVoted") : msg });
    } finally { setBusy(null); }
  }

  if (memberships.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.votes.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>{t("me.votes.subtitle")}</p>
      {votes === null && <p className="muted sm">{t("me.votes.loading")}</p>}
      {votes && votes.length === 0 && <p className="muted sm" style={{ margin: 0 }}>{t("me.votes.none")}</p>}
      {votes && votes.map((v) => (
        <div key={v.proposal} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div className="name">{v.label}</div>
          <div className="sub">{v.circleName} · {v.yes} {t("me.votes.yesLabel")} / {v.no} {t("me.votes.noLabel")}</div>
          {done[v.proposal] ? (
            <p className="ok-note" style={{ margin: "6px 0 0" }}>✓ {t("me.votes.ballotCastDone")}</p>
          ) : (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn btn-sm" disabled={busy === v.proposal} onClick={() => vote(v, true)}>{busy === v.proposal ? t("me.votes.provingShort") : t("me.votes.voteYes")}</button>
              <button className="btn btn-sm btn-ghost" disabled={busy === v.proposal} onClick={() => vote(v, false)}>{t("me.votes.voteNo")}</button>
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
  const t = useT();

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
      setNote({ kind: "ok", text: `${t("me.mentor.sendingInAbout")} ${waitS}${t("me.mentor.sendingSuffix")}` });
      await new Promise((r) => setTimeout(r, waitS * 1000));

      // F35 → Epic 2: prefer the anonymous endorsement (no sponsor edge, no
      // parrain wallet in the transaction) whenever this device holds the ZK
      // voting key; fall back to the deprecated named form only when it can't
      // prove — same rule as the attestation above.
      const anon = haveVotingKey(m.commitment);
      if (anon) {
        await activateFaucetAnonymously(wallet, new PublicKey(m.circle), m.commitment, menteeCommitment);
      } else {
        await activateFaucet(wallet, new PublicKey(m.circle), m.commitment, menteeCommitment);
      }

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
          ? ` ${t("me.mentor.ledgerYours")} ${codes.codeParrain} · ${t("me.mentor.ledgerNeophyte")} ${codes.codeNeophyte} ${t("me.mentor.ledgerWriteDown")}`
          : " " + t("me.mentor.noLedgerEntry");
      } catch {
        tail = " " + t("me.mentor.ledgerCouldNotPrepare");
      }
      // Say which form actually went out. The named fallback publishes the
      // sponsor edge; the member deserves to know that before they use it again.
      const how = anon ? "" : " " + t("me.mentor.firstGasNamed");
      setNote({ kind: "ok", text: t("me.mentor.firstGasSent") + how + tail });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  // Epic 1: I (a member in good standing) attest as parrain for a newcomer who
  // handed me their join code — one action after meeting them in circle.
  async function attestFor(m: MyMembership) {
    const code = (attestInput[m.circle] ?? "").trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(code)) { setNote({ kind: "err", text: t("me.mentor.joinCodeHex") }); return; }
    if (!wallet) return;
    setBusy("attest-" + m.circle); setNote(null);
    try {
      // Epic 2: prefer the anonymous vouch-proof (no sponsor edge on-chain) when
      // this device holds the voting key; fall back to the named pilot form.
      if (haveVotingKey(m.commitment)) {
        await attestAdmissionAnonymously(wallet, m.circle, m.commitment, code);
        setNote({ kind: "ok", text: t("me.mentor.attestedAnon") });
      } else {
        await attestAdmission(wallet, new PublicKey(m.circle), m.commitment, code);
        setNote({ kind: "ok", text: t("me.mentor.attestedNamed") });
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
      if (!wingCommit) throw new Error(t("me.mentor.notMember"));
      await establishWingPeer(wallet, new PublicKey(m.circle), m.commitment, wingCommit);
      setNote({ kind: "ok", text: t("me.mentor.wingPeerSet") });
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
      setNote({ kind: "ok", text: t("me.mentor.wingPeerEnded") });
      load();
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  if (memberships.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.mentor.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>{t("me.mentor.subtitle")}</p>
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
              {cs.length ? cs.map((c) => <span key={c.milestone} className="badge badge-alt" style={{ marginRight: 4 }}>🏅 {milestoneLabel(c.milestone)}</span>) : <span className="muted">{t("me.mentor.noChips")}</span>}
            </div>
            <div className="sub" style={{ marginTop: 6 }}>
              {t("me.mentor.wingPeerLabel")} {w && w.active ? <span className="mono">{w.wing.slice(0, 8)}…</span> : <span className="muted">{t("me.mentor.none")}</span>}
              {w && w.active && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} disabled={busy === "end-" + m.circle} onClick={() => endWing(m)}>{t("me.mentor.end")}</button>}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input className="mono" value={wingInput[m.circle] ?? ""} onChange={(e) => setWingInput((p) => ({ ...p, [m.circle]: e.target.value }))} placeholder={t("me.mentor.wingPlaceholder")} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-sm" disabled={busy === "set-" + m.circle} onClick={() => setWing(m)}>{busy === "set-" + m.circle ? "…" : (w && w.active ? t("me.mentor.change") : t("me.mentor.setWingPeer"))}</button>
            </div>
            {(neophytes[m.circle] ?? []).map((mentee) => (
              <div className="row" key={mentee.commitment} style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span className="sub">{t("me.mentor.youSponsor")} <span className="mono">{mentee.commitment.slice(0, 8)}…</span></span>
                <button className="btn btn-sm" disabled={busy === "gas-" + mentee.commitment} onClick={() => firstGas(m, mentee.commitment)}>
                  {busy === "gas-" + mentee.commitment ? t("me.sending") : t("me.mentor.activateFaucet")}
                </button>
              </div>
            ))}
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input className="mono" value={attestInput[m.circle] ?? ""} onChange={(e) => setAttestInput((p) => ({ ...p, [m.circle]: e.target.value }))} placeholder={t("me.mentor.newcomerCodePlaceholder")} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-sm" disabled={busy === "attest-" + m.circle} onClick={() => attestFor(m)}>
                {busy === "attest-" + m.circle ? "…" : t("me.mentor.attestAsParrain")}
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

// Per-element visibility (Epic 5): the member sets who may see each element.
// Everything defaults to "my circle"; opening up is a deliberate act.
function VisibilityCard({ wallet, memberships }: { wallet: any; memberships: MyMembership[] }) {
  const [vis, setVis] = useState<Record<string, Visibility>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const t = useT();

  useEffect(() => {
    for (const m of memberships)
      getVisibility(new PublicKey(m.circle), m.commitment)
        .then((v) => setVis((p) => ({ ...p, [m.circle]: v }))).catch(() => {});
  }, [memberships]);

  async function save(m: MyMembership, v: Visibility) {
    if (!wallet) return;
    setBusy(m.circle); setNote(null);
    try {
      await setVisibility(wallet, new PublicKey(m.circle), m.commitment, v);
      setVis((p) => ({ ...p, [m.circle]: v }));
      setNote({ kind: "ok", text: t("me.visibility.saved") });
    } catch (e: any) { setNote({ kind: "err", text: String(e?.message || e) }); }
    finally { setBusy(null); }
  }

  if (memberships.length === 0) return null;
  const tierSelect = (m: MyMembership, key: keyof Visibility, v: Visibility) => (
    <select value={v[key]} disabled={busy === m.circle}
      onChange={(e) => save(m, { ...v, [key]: Number(e.target.value) as Tier })}>
      {[MY_CIRCLE, ALL_MEMBERS, CHOSEN].map((tier) => <option key={tier} value={tier}>{TIER_LABEL[tier as Tier]}</option>)}
    </select>
  );

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.visibility.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>
        {t("me.visibility.subtitle")}
      </p>
      {memberships.map((m) => {
        const v = vis[m.circle] ?? DEFAULT_VISIBILITY;
        return (
          <div key={m.pubkey} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <div className="name sm">{m.circleName}</div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <label className="sm">{t("me.visibility.avatar")} {tierSelect(m, "avatar", v)}</label>
              <label className="sm">{t("me.visibility.quipu")} {tierSelect(m, "quipu", v)}</label>
              <label className="sm">{t("me.visibility.bio")} {tierSelect(m, "bio", v)}</label>
            </div>
          </div>
        );
      })}
      {note && <p className={note.kind === "err" ? "error" : "ok-note"} style={{ marginBottom: 0 }}>{note.text}</p>}
    </div>
  );
}

function ProfileCard() {
  const [profile, setProfile] = useState(() => getUserProfile());
  const [busy, setBusy] = useState(false);
  // F62 — the avatar is a CHOICE of two first-class paths: draw a mark (a sign
  // that reveals nothing biometric) or upload a photo. Neither is the default.
  const [mode, setMode] = useState<"none" | "draw" | "photo">("none");
  const tzs = useMemo(() => listTimezones(), []);
  const t = useT();

  function saveMark(url: string) {
    setStoneMark(url);
    const next = { ...profile, avatar: url };
    setProfile(next);
    setUserProfile(next);
    setMode("none");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const avatar = await fileToAvatarDataUrl(file);
      const next = { ...profile, avatar };
      setProfile(next);
      setUserProfile(next);
      setStoneMark(undefined); // a photo replaces any drawn mark
      setMode("none");
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
    setStoneMark(undefined);
    setMode("none");
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.profile.title")}</h3>
      <div className="row" style={{ gap: 12 }}>
        {profile.avatar ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profile.avatar} alt="" width={48} height={48} className="stone-avatar" />
        ) : (
          <div className="muted sm stone-avatar-empty">—</div>
        )}
        <div className="meta" style={{ flex: 1 }}>
          <div className="sm" style={{ marginBottom: 6 }}>{t("me.profile.avatar")}</div>
          {/* Epic 6 / F62 — two first-class paths to an avatar. The stone-mark
              is a personal sign drawn inside the AHA triangle: an identity that
              reveals nothing biometric, which is what a fellowship built on
              anonymity actually needs. The photo path is the older one and puts
              a real face on the profile. Neither is preselected. */}
          <div className="stone-choice">
            <button
              className="btn btn-sm btn-ghost"
              aria-pressed={mode === "draw"}
              onClick={() => setMode(mode === "draw" ? "none" : "draw")}
            >
              {t("me.profile.drawStoneMark")}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              aria-pressed={mode === "photo"}
              disabled={busy}
              onClick={() => setMode(mode === "photo" ? "none" : "photo")}
            >
              Upload a photo
            </button>
            {profile.avatar && (
              <button className="btn btn-sm btn-ghost" onClick={clearAvatar}>{t("me.profile.remove")}</button>
            )}
          </div>
        </div>
      </div>

      {mode === "draw" && (
        <div className="stone-panel">
          <StoneMark onSave={saveMark} onCancel={() => setMode("none")} />
        </div>
      )}
      {mode === "photo" && (
        <div className="stone-panel">
          <label className="sm">
            Choose an image{" "}
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <p className="muted sm" style={{ marginBottom: 0 }}>
            Your photo is turned into a drawing on this device — the original is never saved,
            sent or logged. If you would rather be known by a sign, draw a stone-mark instead.
          </p>
        </div>
      )}

      <div className="form-row col" style={{ marginTop: 10 }}>
        <label>{t("me.profile.timezone")}</label>
        <select value={profile.timezone ?? ""} onChange={(e) => setTz(e.target.value)}>
          <option value="">{t("me.profile.deviceDefault")}</option>
          {tzs.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <p className="muted sm" style={{ marginBottom: 0 }}>{t("me.profile.storedNote")}</p>
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
  const t = useT();

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
            t("me.join.provisionalPre") + ` “${circle.name}”. ` + t("me.join.provisionalPost")
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
            `“${circle.name}” ` + t("me.join.twoSponsorBody")
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
            ? t("me.join.joinedPre") + ` “${circle.name}”. `
            : t("me.join.issuedPre") + ` “${circle.name}”. `) + emailNote(emailRes)
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
          `“${circle.name}” ` + t("me.join.homeCircleBody")
        );
        onChanged();
      }
    } catch (e: any) {
      setNote(t("me.join.couldNotJoin") + " " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.join.title")}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("me.join.subtitle")}
      </p>
      <div className="row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ flex: 1 }}>
          <option value="">{t("me.join.chooseCircle")}</option>
          {circles.map((c) => (
            <option key={c.pubkey} value={c.pubkey}>
              {c.name} ({c.memberCount} {c.memberCount === 1 ? t("me.join.member") : t("me.join.members")})
              {c.open ? " · " + t("me.join.openTag") : ""}
              {memberOf.has(c.pubkey) ? " — " + t("me.join.alreadyMemberTag") : ""}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!circle || busy || loading} onClick={join}>
          {busy ? t("me.join.joining") : isOpen ? t("me.join.join") : isSecretary ? t("me.join.joinIssue") : t("me.join.requestToJoin")}
        </button>
      </div>
      {circle && (
        <p className="muted sm" style={{ margin: "8px 0 0" }}>
          {isOpen
            ? t("me.join.openInfo")
            : t("me.join.validatedInfo")}
        </p>
      )}
      {circle && memberOf.has(circle.pubkey) && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {t("me.join.alreadyMemberNote")}
        </p>
      )}
      {note && <p style={{ marginBottom: 0 }}>{note}</p>}
      {sig && (
        <p style={{ marginBottom: 0 }}>
          <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
            {t("me.viewTransaction")}
          </a>
        </p>
      )}

      {requests.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 6px" }}>{t("me.join.pendingRequests")}</h4>
          {requests.map((r) => (
            <div key={r.circle} className="request">
              <div className="name">{r.circleName}</div>
              <div className="sub">{t("me.join.giveSecretary")}</div>
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
                {t("me.join.dismiss")}
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
  const t = useT();

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
      setNote(t("me.seventh.enterAmount"));
      return;
    }
    setBusy(true);
    setNote(null);
    setSig(null);
    try {
      const tx = await donateSol(wallet, new PublicKey(resolved.pubkey), BigInt(lamports));
      setSig(tx);
      setNote(`${t("me.seventh.thankYouPre")} ${amount} SOL ${t("me.seventh.thankYouTo")} “${resolved.name}”. ${t("me.seventh.selfSupporting")}`);
      treasuryBalance(new PublicKey(resolved.pubkey)).then(setTreasury).catch(() => {});
      onDonated();
    } catch (e: any) {
      setNote(t("me.seventh.donationFailed") + " " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("me.seventh.title")}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("me.seventh.subtitle")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="" disabled>
            {t("me.seventh.chooseWhere")}
          </option>
          <option value="home" disabled={!home}>
            {t("me.seventh.myHomeCircle")}{home ? ` — ${circles.find((c) => c.pubkey === home)?.name ?? ""}` : " (" + t("me.seventh.noneSet") + ")"}
          </option>
          <option value="foundation" disabled={!foundation}>
            {t("me.seventh.theFoundation")}{foundation ? ` — ${foundation.name}` : " (" + t("me.seventh.notFound") + ")"}
          </option>
          <optgroup label={t("me.seventh.anyCircle")}>
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
            aria-label={t("me.seventh.amountAria")}
          />
          <span className="muted">SOL</span>
          <button className="btn" disabled={!resolved || !wallet || busy} onClick={give}>
            {busy ? t("me.sending") : t("me.seventh.give")}
          </button>
        </div>

        {resolved && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="sub">
              <Identicon seed={resolved.pubkey} size={18} className="inline-icon" /> {resolved.name}
            </span>
            <span className="pill">
              {t("me.seventh.treasuryLabel")} {treasury === null ? "…" : `${sol(treasury)} SOL`}
            </span>
          </div>
        )}

        {note && <p style={{ margin: 0 }}>{note}</p>}
        {sig && (
          <p style={{ margin: 0 }}>
            <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
              {t("me.viewTransaction")}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

// The anonymity note carries an in-sentence link on the phrase "zero-knowledge
// proofs technology" (italic, → Wikipedia, new tab). The sentence is one
// translated string with a "{zk}" placeholder kept verbatim in every locale; the
// link text is its own translated key, so word order and wording localise while
// the split stays reliable. If a translation drops the placeholder, the sentence
// still renders in full (just without the link).
function AnonymousNote({ t }: { t: (k: string) => string }) {
  const text = t("me.gs.anonymousNote");
  const parts = text.split("{zk}");
  if (parts.length !== 2) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <a
        href="https://en.wikipedia.org/wiki/Zero-knowledge_proof"
        target="_blank"
        rel="noreferrer"
      >
        <i>{t("me.gs.zkLink")}</i>
      </a>
      {parts[1]}
    </>
  );
}

// ---------------------------------------------------------------------------
// F61 — shield a membership.
//
// English copy is inline here on purpose (this round ships the feature; the
// locales are translated separately). The copy is the feature as much as the
// transaction is: shielding is irreversible, it costs the member one permanent
// transaction-history link, and whether their later actions are private at all
// depends on whether this deployment runs a relayer. A member who is not told
// those three things cannot consent to it.
// ---------------------------------------------------------------------------

function ShieldCard({ wallet, memberships }: { wallet: any; memberships: MyMembership[] }) {
  const [state, setState] = useState<Record<string, "unknown" | "shielded" | "open">>({});
  const [relayed, setRelayed] = useState<boolean | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    shieldingIsFullyPrivate().then(setRelayed).catch(() => setRelayed(false));
  }, []);

  // Which of my memberships already answer to a derived key? Answerable only
  // from this device's own viewing secret — it is a derivation, never a query,
  // and it tells nobody else anything.
  useEffect(() => {
    if (!wallet) return;
    for (const m of memberships) {
      isMembershipShielded(wallet, new PublicKey(m.circle), m.commitment)
        .then((s) => setState((p) => ({ ...p, [m.pubkey]: s ? "shielded" : "open" })))
        .catch(() => setState((p) => ({ ...p, [m.pubkey]: "unknown" })));
    }
  }, [wallet, memberships]);

  async function shield(m: MyMembership) {
    if (!wallet) return;
    setBusy(m.pubkey);
    setNote(null);
    let master: Uint8Array | null = null;
    try {
      const got = await getOrCreateMaster();
      master = got.master;
      await shieldMembership(wallet, new PublicKey(m.circle), m.commitment, master);
      setState((p) => ({ ...p, [m.pubkey]: "shielded" }));
      setOpen(null);
      setNote({
        kind: "ok",
        text:
          "Shielded. Nobody can look up this membership by your wallet address any more." +
          " Your later actions here will use a key derived from your master secret; this app handles that for you." +
          (got.created
            ? " This device also created your master secret — set up recovery now, or losing this device loses the ability to act for this membership."
            : ""),
      });
    } catch (e: any) {
      setNote({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  if (memberships.length === 0) return null;
  const anyOpen = memberships.some((m) => state[m.pubkey] !== "shielded");

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🛡 Shield a membership</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>
        Right now, anyone who knows your wallet address can list every Circle you belong to. They
        need no key, no permission and no relationship to you — the membership record carries your
        wallet address in a field the whole world can search. Shielding removes it and gives you a
        private way to find your own membership instead.
      </p>

      {relayed === false && anyOpen && (
        <p className="sm" style={{ marginTop: 0, color: "var(--warn, #b8860b)" }}>
          <strong>No relayer is running on this deployment.</strong> Shielding will still close the
          search above — the thing anyone can run against anyone. But every action you take
          afterwards (a post, a cord, a visibility change) will be paid for by your wallet, which
          puts your wallet and your shielded membership in the same transaction. Someone who reads
          transaction history, rather than searching account records, could follow that.
        </p>
      )}

      {memberships.map((m) => {
        const s = state[m.pubkey] ?? "unknown";
        return (
          <div key={m.pubkey} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span className="name sm">{m.circleName}</span>
              {s === "shielded" ? (
                <span className="pill">shielded</span>
              ) : (
                <button
                  className="btn btn-sm"
                  disabled={busy !== null || s === "unknown"}
                  onClick={() => setOpen(open === m.pubkey ? null : m.pubkey)}
                >
                  {open === m.pubkey ? "Cancel" : "Shield this membership"}
                </button>
              )}
            </div>

            {open === m.pubkey && (
              <div className="sm" style={{ marginTop: 8 }}>
                <p style={{ marginTop: 0 }}>
                  <strong>What this does.</strong> Your membership stops answering to your wallet
                  and starts answering to a key derived from your own master secret. You keep every
                  action you have today — posting, choosing a wing, tying a cord, setting
                  visibility, sponsoring a newcomer — and this app uses the derived key for them
                  automatically. You do not have to hold or remember it.
                </p>
                <p>
                  <strong>What it costs, exactly.</strong>
                </p>
                <ul style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>
                    <strong>It cannot be undone.</strong> There is no un-shield.
                  </li>
                  <li>
                    <strong>This one transaction is signed by your wallet</strong> — it has to be,
                    because only the current owner may shield. So anyone reading transaction
                    history can always link your wallet to this membership at this moment. What
                    shielding removes is the passive search that needs no history and no effort.
                  </li>
                  <li>
                    <strong>It depends on your master secret.</strong> The derived key comes from
                    it, and only recovery brings it back. If you have not set up recovery, do that
                    too — otherwise losing this device loses the ability to act for this membership.
                  </li>
                  <li>
                    <strong>Someone can still see that a membership was shielded</strong>, and how
                    many have been. They cannot see whose.
                  </li>
                  {relayed === false && (
                    <li>
                      <strong>Your wallet will pay for your later actions</strong> on this
                      deployment, and will therefore appear alongside this membership again each
                      time. See the note above.
                    </li>
                  )}
                  {relayed === true && (
                    <li>
                      A relayer is running here, so your later actions are paid for by it and your
                      wallet will not appear in them at all.
                    </li>
                  )}
                </ul>
                <button className="btn btn-sm" disabled={busy !== null} onClick={() => shield(m)}>
                  {busy === m.pubkey ? "Shielding…" : "I understand — shield it"}
                </button>
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
    </div>
  );
}

// Epic 11 — entry point to the shard ceremony and the recovery wizard. Both
// flows are purely local (nothing on chain); this card only routes to them.
function RecoveryCard() {
  const t = useT();
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🪶 {t("me.recovery.title")}</h3>
      <p className="muted sm" style={{ marginTop: 0 }}>
        {t("me.recovery.desc")}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <a className="btn btn-sm" href="/recovery/setup">{t("me.recovery.setupBtn")}</a>
        <a className="btn btn-sm btn-ghost" href="/recovery">{t("me.recovery.recoverBtn")}</a>
      </div>
    </div>
  );
}
