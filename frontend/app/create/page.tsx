"use client";

// F23 — Create a Circle. A guided, permissionless wizard around
// initialize_circle + initialize_member_tree. The creator takes one of the 7
// Council seats (so they can also sign the member-tree init) and fills the
// other six. On success the Circle's mandatory @aha-domain address is shown and
// notified (F25).

import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Identicon from "../../components/Identicon";
import RoleIcon from "../../components/RoleIcon";
import {
  CircleInfo, explorerTx, foundationOf, listCircles,
  issueMembership, membershipPda, newCommitment,
} from "../../lib/member";
import { SEAT_ROLES, SECRETARY, setOpenMembership } from "../../lib/admin";
import {
  CreateCircleResult,
  MAX_NAME_BYTES,
  createCircle,
  nameByteLength,
} from "../../lib/createCircle";
import { circleEmail, emailNote, notifyCircleEmail } from "../../lib/circleEmail";
import { upsertCircleProfile } from "../../lib/foundation";
import {
  Recurrence, WEEKDAYS, ORDINALS, describeRecurrence, setMeetings,
} from "../../lib/meetings";
import { createPost } from "../../lib/posts";
import { validCoord } from "../../lib/geo";
import { COUNTRIES } from "../../lib/countries";
import { setCircleCountry } from "../../lib/country";

function pk(s: string): PublicKey | null {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
}

export default function Create() {
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();
  const me = publicKey?.toBase58() ?? "";

  const [circles, setCircles] = useState<CircleInfo[]>([]);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [mySeat, setMySeat] = useState<number>(SECRETARY);
  const [seats, setSeats] = useState<string[]>(Array(7).fill(""));
  const [years, setYears] = useState("1");
  const [timelockDays, setTimelockDays] = useState("7");
  const [openJoin, setOpenJoin] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  // Location
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [address, setAddress] = useState("");
  const [showOnMap, setShowOnMap] = useState(true);

  // Meeting schedule (recurring patterns) + founding board post
  const [recurring, setRecurring] = useState<Recurrence[]>([]);
  const [pat, setPat] = useState<Recurrence>({ freq: "monthly", ordinal: 2, weekday: 3, time: "18:00", note: "" });
  const [foundingPost, setFoundingPost] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ res: CreateCircleResult; email: string; emailMsg: string; open: boolean; steps: string[] } | null>(null);

  useEffect(() => {
    listCircles()
      .then((cs) => {
        setCircles(cs);
        const f = foundationOf(cs);
        setParent(f?.pubkey ?? cs[0]?.pubkey ?? "");
      })
      .catch(() => {});
  }, []);

  // Keep the creator's wallet locked into their chosen seat.
  useEffect(() => {
    if (!me) return;
    setSeats((prev) => {
      const next = prev.map((s) => (s === me ? "" : s)); // clear my address from any old seat
      next[mySeat] = me;
      return next;
    });
  }, [me, mySeat]);

  const nameBytes = nameByteLength(name);
  const emailPreview = useMemo(() => circleEmail(name || "your-circle"), [name]);
  const parentName = circles.find((c) => c.pubkey === parent)?.name;

  function setSeat(i: number, v: string) {
    setSeats((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  // Local-only coordinate check (F71): no third-party geocoder is ever called.
  const coordsEntered = lat.trim() !== "" || lon.trim() !== "";
  const coordsValid = validCoord(parseFloat(lat), parseFloat(lon));

  function addPattern() {
    setRecurring((p) => [...p, { ...pat, note: pat.note?.trim() || undefined }]);
  }

  function validate(): { parent: PublicKey; seatKeys: PublicKey[] } | string {
    if (!name.trim()) return "Give the Circle a name.";
    if (nameBytes > MAX_NAME_BYTES) return `Name is ${nameBytes} bytes; the limit is ${MAX_NAME_BYTES}.`;
    if (!country) return "Choose the Circle's country — it's required so the Circle is grouped on the foundation directory.";
    if (coordsEntered && !coordsValid) return "GPS coordinates are invalid — latitude must be −90 … 90 and longitude −180 … 180.";
    const parentKey = pk(parent);
    if (!parentKey) return "Choose a valid parent Circle.";
    const seatKeys: PublicKey[] = [];
    for (let i = 0; i < 7; i++) {
      const k = pk(seats[i]);
      if (!k) return `${SEAT_ROLES[i]} is not a valid address.`;
      seatKeys.push(k);
    }
    const seen = new Set(seatKeys.map((k) => k.toBase58()));
    if (seen.size !== 7) return "Each seat must be a distinct wallet (one holder per seat).";
    return { parent: parentKey, seatKeys };
  }

  async function submit() {
    const v = validate();
    if (typeof v === "string") return setError(v);
    if (!wallet) return setError("Connect a wallet first.");
    setError(null);
    setBusy(true);
    try {
      const res = await createCircle(wallet, {
        parent: v.parent,
        name: name.trim(),
        seats: v.seatKeys,
        membershipPeriodSecs: Math.max(1, Math.round(parseFloat(years) * 365 * 24 * 60 * 60)),
        recoveryTimelockSecs: Math.max(0, Math.round(parseFloat(timelockDays) * 24 * 60 * 60)),
      });
      const circlePk = new PublicKey(res.circle);
      const steps: string[] = [];
      const safe = async (label: string, fn: () => Promise<any>) => {
        try { await fn(); steps.push("✓ " + label); }
        catch (e: any) { steps.push("✗ " + label + " — " + String(e?.message || e).slice(0, 80)); }
      };

      // Country is mandatory — record it on-chain (the creator holds a seat).
      await safe("set country", () => setCircleCountry(wallet, circlePk, country));

      // If permissionless, set the open policy (the creator holds a seat).
      if (openJoin) await safe("set open membership", () => setOpenMembership(wallet, circlePk, true));

      // Publish the directory profile only if "Show on map & list" is checked —
      // that profile IS the home-page listing/map pin. Unchecked ⇒ never listed.
      const latN = parseFloat(lat), lonN = parseFloat(lon);
      if (showOnMap && Number.isFinite(latN) && Number.isFinite(lonN)) {
        await safe("publish to map & list", () =>
          upsertCircleProfile(wallet, circlePk, {
            latMicrodeg: Math.round(latN * 1e6),
            lonMicrodeg: Math.round(lonN * 1e6),
            name: name.trim(), city: city.trim(), address: address.trim(),
            twelveStepsCid: "", preambleCid: "", dailyReflectionsCid: "",
          })
        );
      } else if (showOnMap) {
        steps.push("ℹ not listed yet — add GPS coordinates to appear on the map & list");
      } else {
        steps.push("ℹ hidden — not shown on the map or list (no public profile published)");
      }

      // Publish the recurring meeting schedule (member-visible calendar).
      if (recurring.length) {
        await safe("publish meeting schedule", () =>
          setMeetings(wallet, circlePk, { recurring, sessions: [] })
        );
      }

      // Founding board post — needs a membership; the creator can self-issue only
      // as the Scribe-Secretary, so post on-chain in that case.
      const postText = foundingPost.trim() || `🎉 This is the birthday announcement for ${name.trim()} — our Circle is founded today. Welcome!`;
      if (mySeat === SECRETARY) {
        await safe("found the board (membership + first post)", async () => {
          const commit = newCommitment();
          await issueMembership(wallet, circlePk, commit, publicKey!, false);
          const now = Math.floor(Date.now() / 1000);
          await createPost(wallet, circlePk, membershipPda(circlePk, commit), postText, "", now - 60, now + 365 * 24 * 3600);
        });
      } else {
        steps.push("ℹ founding post skipped (only the Scribe-Secretary can post at creation)");
      }

      // F25: the Circle's address is provisioned/announced the moment it exists.
      const emailRes = await notifyCircleEmail({
        kind: "provision",
        circleName: name.trim(),
        circlePubkey: res.circle,
      });
      setDone({
        res,
        email: emailRes.to ?? circleEmail(name.trim(), res.circle),
        emailMsg: emailNote(emailRes),
        open: openJoin,
        steps,
      });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1>Circle created</h1>
        <div className="card">
          <div className="row">
            <Identicon seed={done.res.circle} size={46} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name" style={{ fontSize: 18 }}>{name}</div>
              <div className="sub mono">{done.res.circle}</div>
            </div>
          </div>
          <p style={{ marginBottom: 6 }}>
            <strong>Circle address:</strong> <span className="mono">{done.email}</span>
          </p>
          <p className="muted sm" style={{ marginTop: 0 }}>{done.emailMsg}</p>
          <p style={{ marginBottom: 6 }}>
            <strong>Membership:</strong>{" "}
            {done.open ? "Open — anyone may join without validation." : "Scribe-Secretary validates each member."}
          </p>
          <p style={{ marginBottom: 4 }}>
            <a href={explorerTx(done.res.txCircle)} target="_blank" rel="noreferrer">Circle transaction</a>
            {" · "}
            <a href={explorerTx(done.res.txTree)} target="_blank" rel="noreferrer">member-tree transaction</a>
          </p>
          {done.steps.length > 0 && (
            <ul className="sm" style={{ margin: "6px 0" }}>
              {done.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <p className="muted sm">
            You hold the <strong>{SEAT_ROLES[mySeat]}</strong> seat — manage members &amp; votes from{" "}
            <a href="/me">My Circle</a> (the Administration block at the bottom). Your Circle now appears on “Find a Circle”.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="hero hero-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/circle.png" alt="A fellowship Circle gathered in rhythm" className="hero-img" />
        <div className="hero-overlay">
          <h1>Create a Circle</h1>
        </div>
      </section>
      <p className="lede">
        Open a new fellowship Circle — permissionless and owner-less. You seat its 7-member
        Council; from there the Council <em>is</em> the authority.
      </p>

      {!connected && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Connect a Solana wallet to create a Circle — use the <b>“Select Wallet”</b> button at the top right.
            Don’t have one yet? Get <a href="https://www.solflare.com/" target="_blank" rel="noreferrer">Solflare</a> or{" "}
            <a href="https://phantom.com/" target="_blank" rel="noreferrer">Phantom</a>.
          </p>
        </div>
      )}

      {connected && (
        <div className="card">
          <div className="form-row col">
            <label>Circle name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AHA Nairobi" />
            <span className="muted sm">
              {nameBytes}/{MAX_NAME_BYTES} bytes · address will be <span className="mono">{emailPreview}</span>
            </span>
          </div>

          <div className="form-row col" style={{ marginTop: 12 }}>
            <label>Nests under (parent)</label>
            {circles.length > 0 ? (
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                {circles.map((c) => (
                  <option key={c.pubkey} value={c.pubkey}>
                    {c.name}
                    {foundationOf(circles)?.pubkey === c.pubkey ? " (foundation)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="parent Circle address" />
            )}
            <span className="muted sm">
              {parentName ? `Federated under ${parentName}.` : "The World Service / foundation Circle is the usual parent."}
            </span>
          </div>

          <h3 style={{ margin: "18px 0 4px" }}>The 7-seat Council</h3>
          <div className="form-row col" style={{ marginBottom: 8 }}>
            <label>Your seat</label>
            <select value={mySeat} onChange={(e) => setMySeat(Number(e.target.value))}>
              {SEAT_ROLES.map((r, i) => (
                <option key={r} value={i}>{r}</option>
              ))}
            </select>
            <span className="muted sm">
              Your connected wallet fills this seat (and signs the member-tree setup). The Scribe-Secretary admits members.
            </span>
          </div>

          {SEAT_ROLES.map((role, i) => (
            <div className="form-row" key={role} style={{ marginTop: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <RoleIcon seat={i} /> {role}
              </label>
              <input
                value={seats[i]}
                onChange={(e) => setSeat(i, e.target.value)}
                disabled={i === mySeat}
                placeholder={i === mySeat ? "you" : "wallet address"}
                className="mono"
                style={i === mySeat ? { opacity: 0.7 } : undefined}
              />
            </div>
          ))}
          <p className="muted sm" style={{ marginTop: 8 }}>
            Each seat must be a distinct wallet held by a trusted servant — there is no admin key,
            so the Council (4-of-7) is the only authority. Decisions need real co-signers.
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>Membership policy</h3>
          <div className="form-row col">
            <select value={openJoin ? "open" : "gated"} onChange={(e) => setOpenJoin(e.target.value === "open")}>
              <option value="gated">Scribe-Secretary validates each member (default)</option>
              <option value="open">Open — anyone may join, permissionless</option>
            </select>
            <span className="muted sm">
              You can change this anytime from the administration console. Open circles still
              record each member; they just skip Scribe-Secretary approval.
            </span>
          </div>

          <h3 style={{ margin: "18px 0 4px" }}>Location</h3>
          <div className="form-row">
            <label>GPS lat / lon</label>
            <input type="number" step="0.00001" min="-90" max="90" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="latitude (−90 … 90)" style={{ maxWidth: 130 }} />
            <input type="number" step="0.00001" min="-180" max="180" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="longitude (−180 … 180)" style={{ maxWidth: 130 }} />
          </div>
          {coordsEntered && !coordsValid && (
            <p className="error" style={{ margin: "0 0 6px" }}>
              ⚠ Coordinates look invalid — latitude must be −90 … 90 and longitude −180 … 180 (and not 0, 0).
            </p>
          )}
          <p className="muted sm" style={{ margin: "0 0 6px" }}>
            Enter the coordinates directly — we don't send your address to third-party
            geocoders; everything you type stays in your browser until you publish on-chain.
          </p>
          <div className="form-row"><label>City</label><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="city / town" /></div>
          <div className="form-row">
            <label>Country *</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} required style={{ flex: 1 }}>
              <option value="">— choose a country (required) —</option>
              {COUNTRIES.map((co) => <option key={co.code} value={co.code}>{co.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Address</label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="meeting place / landmark" /></div>
          <label className="form-row" style={{ cursor: "pointer", gap: 8 }}>
            <input type="checkbox" checked={showOnMap} onChange={(e) => setShowOnMap(e.target.checked)} style={{ width: "auto", flex: "0 0 auto" }} />
            <span className="sm">Show on map &amp; list <span className="muted">— list this Circle on the “Find a Circle” home page</span></span>
          </label>
          <p className="muted sm" style={{ marginTop: 4 }}>
            {showOnMap
              ? "The Circle will appear on “Find a Circle” (needs GPS coordinates above)."
              : "The Circle stays unlisted — it won’t appear on the home page or map."}
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>Meeting schedule</h3>
          {recurring.length > 0 && (
            <ul style={{ margin: "0 0 8px" }}>
              {recurring.map((r, i) => (
                <li key={i} className="sm">
                  {describeRecurrence(r)}{" "}
                  <button className="btn btn-sm btn-ghost" style={{ padding: "1px 7px" }} onClick={() => setRecurring((p) => p.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-row" style={{ flexWrap: "wrap", gap: 6 }}>
            <select value={pat.freq} onChange={(e) => setPat({ ...pat, freq: e.target.value as any })}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
            {pat.freq === "monthly" && (
              <select value={pat.ordinal} onChange={(e) => setPat({ ...pat, ordinal: Number(e.target.value) })}>
                {ORDINALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <select value={pat.weekday} onChange={(e) => setPat({ ...pat, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <input type="time" value={pat.time} onChange={(e) => setPat({ ...pat, time: e.target.value })} style={{ maxWidth: 110 }} />
            <input value={pat.note ?? ""} onChange={(e) => setPat({ ...pat, note: e.target.value })} placeholder="note (optional)" style={{ flex: 1, minWidth: 120 }} />
            <button className="btn btn-sm" onClick={addPattern}>Add</button>
          </div>
          <p className="muted sm" style={{ marginTop: 4 }}>
            e.g. “every 2nd Wednesday of the month at 18:00”. Members see these on the Circle calendar; add one-off sessions later.
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>Founding board post</h3>
          <div className="form-row col">
            <textarea rows={2} value={foundingPost} onChange={(e) => setFoundingPost(e.target.value)}
              placeholder={`🎉 This is the birthday announcement for ${name || "[circle]"} — our Circle is founded today. Welcome!`} />
            <span className="muted sm">Posted to the board at creation (only if you take the Scribe-Secretary seat, since posting needs a membership).</span>
          </div>

          <button className="btn btn-sm btn-ghost" style={{ marginTop: 14 }} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? "Hide advanced" : "Advanced settings"}
          </button>
          {advanced && (
            <div className="form" style={{ marginTop: 10 }}>
              <div className="form-row">
                <label>Membership term</label>
                <input type="number" min="0.1" step="0.5" value={years} onChange={(e) => setYears(e.target.value)} style={{ maxWidth: 120 }} />
                <span className="muted sm">years</span>
              </div>
              <div className="form-row">
                <label>Recovery time-lock</label>
                <input type="number" min="0" step="1" value={timelockDays} onChange={(e) => setTimelockDays(e.target.value)} style={{ maxWidth: 120 }} />
                <span className="muted sm">days — the contest window before high-stakes votes execute</span>
              </div>
            </div>
          )}

          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}

          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "Creating on-chain…" : "Create Circle"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
