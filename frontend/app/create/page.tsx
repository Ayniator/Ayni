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
import { useT } from "../../components/SettingsProvider";
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
import { CreateEligibility, checkCreateEligibility, solOf } from "../../lib/createGate";

function pk(s: string): PublicKey | null {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
}

export default function Create() {
  const t = useT();
  const { publicKey, connected } = useWallet();
  const wallet = useAnchorWallet();
  const me = publicKey?.toBase58() ?? "";

  const [circles, setCircles] = useState<CircleInfo[]>([]);
  // F92 — creation preconditions. `null` = not yet answered; the wizard is not
  // rendered until both are known and open.
  const [gate, setGate] = useState<CreateEligibility | null>(null);
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
    if (!name.trim()) return t("create.err.name");
    if (nameBytes > MAX_NAME_BYTES) return `${t("create.err.nameBytesPre")}${nameBytes}${t("create.err.nameBytesMid")}${MAX_NAME_BYTES}.`;
    if (!country) return t("create.err.country");
    if (coordsEntered && !coordsValid) return t("create.err.coords");
    const parentKey = pk(parent);
    if (!parentKey) return t("create.err.parent");
    const seatKeys: PublicKey[] = [];
    for (let i = 0; i < 7; i++) {
      const k = pk(seats[i]);
      if (!k) return `${SEAT_ROLES[i]} ${t("create.err.seatInvalid")}`;
      seatKeys.push(k);
    }
    const seen = new Set(seatKeys.map((k) => k.toBase58()));
    if (seen.size !== 7) return t("create.err.distinct");
    return { parent: parentKey, seatKeys };
  }

  async function submit() {
    const v = validate();
    if (typeof v === "string") return setError(v);
    if (!wallet) return setError(t("create.err.connectWallet"));
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
      await safe(t("create.step.setCountry"), () => setCircleCountry(wallet, circlePk, country));

      // If permissionless, set the open policy (the creator holds a seat).
      if (openJoin) await safe(t("create.step.setOpen"), () => setOpenMembership(wallet, circlePk, true));

      // Publish the directory profile only if "Show on map & list" is checked —
      // that profile IS the home-page listing/map pin. Unchecked ⇒ never listed.
      const latN = parseFloat(lat), lonN = parseFloat(lon);
      if (showOnMap && Number.isFinite(latN) && Number.isFinite(lonN)) {
        await safe(t("create.step.publishMap"), () =>
          upsertCircleProfile(wallet, circlePk, {
            latMicrodeg: Math.round(latN * 1e6),
            lonMicrodeg: Math.round(lonN * 1e6),
            name: name.trim(), city: city.trim(), address: address.trim(),
            twelveStepsCid: "", preambleCid: "", dailyReflectionsCid: "",
          })
        );
      } else if (showOnMap) {
        steps.push("ℹ " + t("create.step.notListed"));
      } else {
        steps.push("ℹ " + t("create.step.hidden"));
      }

      // Publish the recurring meeting schedule (member-visible calendar).
      if (recurring.length) {
        await safe(t("create.step.publishSchedule"), () =>
          setMeetings(wallet, circlePk, { recurring, sessions: [] })
        );
      }

      // Founding board post — needs a membership; the creator can self-issue only
      // as the Scribe-Secretary, so post on-chain in that case.
      const postText = foundingPost.trim() || `🎉 ${t("create.post.birthdayPre")}${name.trim()}${t("create.post.birthdayPost")}`;
      if (mySeat === SECRETARY) {
        await safe(t("create.step.foundBoard"), async () => {
          const commit = newCommitment();
          await issueMembership(wallet, circlePk, commit, publicKey!, false);
          const now = Math.floor(Date.now() / 1000);
          await createPost(wallet, circlePk, membershipPda(circlePk, commit), postText, "", now - 60, now + 365 * 24 * 3600);
        });
      } else {
        steps.push("ℹ " + t("create.step.postSkipped"));
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

  // F92 — ask both gates once the wallet and the Circle list are in.
  useEffect(() => {
    if (!publicKey) { setGate(null); return; }
    let live = true;
    checkCreateEligibility(publicKey, circles)
      .then((g) => live && setGate(g))
      .catch(() => live && setGate(null));
    return () => { live = false; };
  }, [publicKey, circles]);

  // The blocking popup: shown INSTEAD of the wizard, never over a usable form.
  // Two distinct reasons, never conflated — one is about standing, the other is
  // about lamports, and telling a member "you cannot" without saying which
  // would be the worst of both.
  const blocked = connected && gate && !gate.ok;
  if (blocked) {
    const sponsorGate = !gate.validated;
    return (
      <div className="gate-scrim">
        <div className="card gate-modal" role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>
            {sponsorGate ? t("create.gate.sponsorTitle") : t("create.gate.fundsTitle")}
          </h2>
          <p style={{ marginBottom: 10 }}>
            {sponsorGate ? t("create.gate.sponsorBody") : t("create.gate.fundsBody")}
          </p>
          {!sponsorGate && (
            <p className="mono sm" style={{ margin: "0 0 10px" }}>
              {t("create.gate.needLabel")} {solOf(gate.required)} SOL ·{" "}
              {t("create.gate.haveLabel")} {solOf(gate.balance)} SOL
            </p>
          )}
          <p style={{ margin: 0 }}>
            <a href={sponsorGate ? "/me" : "/wallet"} className="btn btn-sm">
              {sponsorGate ? t("create.gate.sponsorAction") : t("create.gate.fundsAction")}
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <>
        <h1>{t("create.done.title")}</h1>
        <div className="card">
          <div className="row">
            <Identicon seed={done.res.circle} size={46} />
            <div className="meta" style={{ flex: 1, minWidth: 0 }}>
              <div className="name" style={{ fontSize: 18 }}>{name}</div>
              <div className="sub mono">{done.res.circle}</div>
            </div>
          </div>
          <p style={{ marginBottom: 6 }}>
            <strong>{t("create.done.addressLabel")}</strong> <span className="mono">{done.email}</span>
          </p>
          <p className="muted sm" style={{ marginTop: 0 }}>{done.emailMsg}</p>
          <p style={{ marginBottom: 6 }}>
            <strong>{t("create.done.membershipLabel")}</strong>{" "}
            {done.open ? t("create.done.membershipOpen") : t("create.done.membershipGated")}
          </p>
          <p style={{ marginBottom: 4 }}>
            <a href={explorerTx(done.res.txCircle)} target="_blank" rel="noreferrer">{t("create.done.circleTx")}</a>
            {" · "}
            <a href={explorerTx(done.res.txTree)} target="_blank" rel="noreferrer">{t("create.done.treeTx")}</a>
          </p>
          {done.steps.length > 0 && (
            <ul className="sm" style={{ margin: "6px 0" }}>
              {done.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <p className="muted sm">
            {t("create.done.youHold")} <strong>{SEAT_ROLES[mySeat]}</strong> {t("create.done.seatManage")}{" "}
            <a href="/me">{t("create.done.myCircle")}</a> {t("create.done.adminBlock")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="hero hero-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/circle.png" alt={t("create.hero.alt")} className="hero-img" />
        <div className="hero-overlay">
          <h1>{t("create.hero.title")}</h1>
        </div>
      </section>
      <p className="lede">
        {t("create.lede.pre")} <em>{t("create.lede.is")}</em> {t("create.lede.post")}
      </p>

      {!connected && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {t("create.connect.pre")} <b>{t("create.connect.selectWallet")}</b> {t("create.connect.mid")}{" "}
            <a href="https://www.solflare.com/" target="_blank" rel="noreferrer">Solflare</a> {t("create.connect.or")}{" "}
            <a href="https://phantom.com/" target="_blank" rel="noreferrer">Phantom</a>.
          </p>
        </div>
      )}

      {connected && (
        <div className="card">
          <div className="form-row col">
            <label>{t("create.form.nameLabel")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("create.form.namePlaceholder")} />
            <span className="muted sm">
              {nameBytes}/{MAX_NAME_BYTES} {t("create.form.bytesAddr")} <span className="mono">{emailPreview}</span>
            </span>
          </div>

          <div className="form-row col" style={{ marginTop: 12 }}>
            <label>{t("create.form.parentLabel")}</label>
            {circles.length > 0 ? (
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                {circles.map((c) => (
                  <option key={c.pubkey} value={c.pubkey}>
                    {c.name}
                    {foundationOf(circles)?.pubkey === c.pubkey ? t("create.form.foundationTag") : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder={t("create.form.parentPlaceholder")} />
            )}
            <span className="muted sm">
              {parentName ? `${t("create.form.federatedPre")}${parentName}.` : t("create.form.parentHint")}
            </span>
          </div>

          <h3 style={{ margin: "18px 0 4px" }}>{t("create.council.title")}</h3>
          <div className="form-row col" style={{ marginBottom: 8 }}>
            <label>{t("create.council.yourSeat")}</label>
            <select value={mySeat} onChange={(e) => setMySeat(Number(e.target.value))}>
              {SEAT_ROLES.map((r, i) => (
                <option key={r} value={i}>{r}</option>
              ))}
            </select>
            <span className="muted sm">
              {t("create.council.yourSeatHint")}
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
                placeholder={i === mySeat ? t("create.council.you") : t("create.council.walletAddress")}
                className="mono"
                style={i === mySeat ? { opacity: 0.7 } : undefined}
              />
            </div>
          ))}
          <p className="muted sm" style={{ marginTop: 8 }}>
            {t("create.council.seatsNote")}
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>{t("create.policy.title")}</h3>
          <div className="form-row col">
            <select value={openJoin ? "open" : "gated"} onChange={(e) => setOpenJoin(e.target.value === "open")}>
              <option value="gated">{t("create.policy.gated")}</option>
              <option value="open">{t("create.policy.open")}</option>
            </select>
            <span className="muted sm">
              {t("create.policy.hint")}
            </span>
          </div>

          <h3 style={{ margin: "18px 0 4px" }}>{t("create.location.title")}</h3>
          <div className="form-row">
            <label>{t("create.location.gpsLabel")}</label>
            <input type="number" step="0.00001" min="-90" max="90" value={lat} onChange={(e) => setLat(e.target.value)} placeholder={t("create.location.latPlaceholder")} style={{ maxWidth: 130 }} />
            <input type="number" step="0.00001" min="-180" max="180" value={lon} onChange={(e) => setLon(e.target.value)} placeholder={t("create.location.lonPlaceholder")} style={{ maxWidth: 130 }} />
          </div>
          {coordsEntered && !coordsValid && (
            <p className="error" style={{ margin: "0 0 6px" }}>
              ⚠ {t("create.location.coordsInvalid")}
            </p>
          )}
          <p className="muted sm" style={{ margin: "0 0 6px" }}>
            {t("create.location.geocoderNote")}
          </p>
          <div className="form-row"><label>{t("create.location.cityLabel")}</label><input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("create.location.cityPlaceholder")} /></div>
          <div className="form-row">
            <label>{t("create.location.country")}</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} required style={{ flex: 1 }}>
              <option value="">{t("create.location.chooseCountry")}</option>
              {COUNTRIES.map((co) => <option key={co.code} value={co.code}>{co.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>{t("create.location.addressLabel")}</label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("create.location.addressPlaceholder")} /></div>
          <label className="form-row" style={{ cursor: "pointer", gap: 8 }}>
            <input type="checkbox" checked={showOnMap} onChange={(e) => setShowOnMap(e.target.checked)} style={{ width: "auto", flex: "0 0 auto" }} />
            <span className="sm">{t("create.location.showOnMap")} <span className="muted">{t("create.location.showOnMapHint")}</span></span>
          </label>
          <p className="muted sm" style={{ marginTop: 4 }}>
            {showOnMap
              ? t("create.location.willAppear")
              : t("create.location.unlisted")}
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>{t("create.meeting.title")}</h3>
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
              <option value="monthly">{t("create.meeting.monthly")}</option>
              <option value="weekly">{t("create.meeting.weekly")}</option>
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
            <input value={pat.note ?? ""} onChange={(e) => setPat({ ...pat, note: e.target.value })} placeholder={t("create.meeting.notePlaceholder")} style={{ flex: 1, minWidth: 120 }} />
            <button className="btn btn-sm" onClick={addPattern}>{t("create.meeting.add")}</button>
          </div>
          <p className="muted sm" style={{ marginTop: 4 }}>
            {t("create.meeting.hint")}
          </p>

          <h3 style={{ margin: "18px 0 4px" }}>{t("create.founding.title")}</h3>
          <div className="form-row col">
            <textarea rows={2} value={foundingPost} onChange={(e) => setFoundingPost(e.target.value)}
              placeholder={`🎉 ${t("create.post.birthdayPre")}${name || "[circle]"}${t("create.post.birthdayPost")}`} />
            <span className="muted sm">{t("create.founding.hint")}</span>
          </div>

          <button className="btn btn-sm btn-ghost" style={{ marginTop: 14 }} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? t("create.advanced.hide") : t("create.advanced.show")}
          </button>
          {advanced && (
            <div className="form" style={{ marginTop: 10 }}>
              <div className="form-row">
                <label>{t("create.advanced.termLabel")}</label>
                <input type="number" min="0.1" step="0.5" value={years} onChange={(e) => setYears(e.target.value)} style={{ maxWidth: 120 }} />
                <span className="muted sm">{t("create.advanced.years")}</span>
              </div>
              <div className="form-row">
                <label>{t("create.advanced.timelockLabel")}</label>
                <input type="number" min="0" step="1" value={timelockDays} onChange={(e) => setTimelockDays(e.target.value)} style={{ maxWidth: 120 }} />
                <span className="muted sm">{t("create.advanced.timelockUnit")}</span>
              </div>
            </div>
          )}

          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}

          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? t("create.submitBusy") : t("create.submit")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
