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
  newCommitment,
  saveJoinRequest,
  setHomeCircle,
  treasuryBalance,
} from "../../lib/member";
import { emailNote, notifyCircleEmail } from "../../lib/circleEmail";
import CircleAdmin from "../admin/CircleAdmin";
import { fileToAvatarDataUrl, getUserProfile, listTimezones, setUserProfile } from "../../lib/profile";

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

      {connected && publicKey && (
        <div className="grid two" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <WalletCard publicKey={publicKey} balance={balance} memberships={memberships} byPubkey={byPubkey} home={home} />
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
      const commitment = newCommitment();
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
