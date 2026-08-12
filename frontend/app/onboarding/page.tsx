"use client";

// Epic 9 (F68) — graphical onboarding: a guided, three-macro-step visual flow.
//
//   1  Wallet   →   2  Vouch   →   3  Face
//
// Design constraints (Epic 9): ONE action per screen; plain language; the
// position in the journey is ALWAYS visible; target: a newcomer reaches a live
// page in under ten minutes. Where a real surface already exists (the /me flow,
// the parrain attestation, the faucet), this page LINKS into it rather than
// re-implementing it — onboarding orients, it does not duplicate.

import { useState } from "react";
import Link from "next/link";
import WalletChooser from "../../components/WalletChooser";
import QuipuNecklace from "../../components/QuipuNecklace";
import { fileToAvatarDataUrl, getUserProfile, setUserProfile } from "../../lib/profile";
import { useT } from "../../components/SettingsProvider";

const STEPS = [
  { n: 1, key: "wallet", label: "Wallet", hint: "Get a wallet" },
  { n: 2, key: "vouch", label: "Vouch", hint: "Get vouched for" },
  { n: 3, key: "face", label: "Face", hint: "Show your face" },
] as const;

export default function OnboardingPage() {
  const t = useT();
  const [step, setStep] = useState(1);
  const total = STEPS.length;

  return (
    <div className="onboarding" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>{t("onboarding.hero.title")}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("onboarding.hero.subtitle")}
      </p>

      {/* ALWAYS-VISIBLE position indicator — the newcomer never loses their place. */}
      <PositionIndicator current={step} onJump={setStep} />

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        {step === 1 && <StepWallet />}
        {step === 2 && <StepVouch />}
        {step === 3 && <StepFace />}
      </div>

      {/* Arrows — one clear forward action, and a way back. */}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
          ← {t("onboarding.back")}
        </button>
        <span className="muted sm">{t("onboarding.stepWord")} {step} {t("onboarding.ofWord")} {total}</span>
        {step < total ? (
          <button className="btn" onClick={() => setStep((s) => Math.min(total, s + 1))}>
            {t("onboarding.nextPrefix")} {t(`onboarding.step.${STEPS[step].key}`)} →
          </button>
        ) : (
          <Link className="btn" href="/me">{t("onboarding.openMyPage")} →</Link>
        )}
      </div>
    </div>
  );
}

function PositionIndicator({ current, onJump }: { current: number; onJump: (n: number) => void }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 0, marginTop: 12, alignItems: "center" }}>
      {STEPS.map((s, i) => (
        <div key={s.key} className="row" style={{ gap: 0, alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
          <button
            onClick={() => onJump(s.n)}
            className="btn btn-sm"
            title={t(`onboarding.hint.${s.key}`)}
            style={{
              borderRadius: 999,
              minWidth: 34,
              fontWeight: 700,
              opacity: s.n === current ? 1 : 0.55,
              background: s.n === current ? "var(--accent, #6b8f71)" : undefined,
              color: s.n === current ? "#fff" : undefined,
            }}
          >
            {s.n}
          </button>
          <span className="sm" style={{ margin: "0 8px", fontWeight: s.n === current ? 700 : 400, opacity: s.n === current ? 1 : 0.6 }}>
            {t(`onboarding.step.${s.key}`)}
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden style={{ flex: 1, height: 2, background: "var(--muted, #ccc)", opacity: 0.4, margin: "0 4px" }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Step 1 — Wallet ─────────────────────────────────────────────────────── */
function StepWallet() {
  // The seed-phrase warning is UNSKIPPABLE: Next is meant to move on, but this
  // acknowledgement is the one thing we refuse to let a newcomer skim past.
  // (Copy only — AHA does not create wallets or handle seed phrases. The wallet
  // apps below do that; we just make sure nobody misses the warning.)
  const [ack, setAck] = useState(false);
  const t = useT();
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>1 · {t("onboarding.wallet.title")}</h2>
      <p>
        {t("onboarding.wallet.p1a")} <strong>{t("onboarding.wallet.signMsg")}</strong>{t("onboarding.wallet.p1b")}
      </p>
      <p className="muted sm">{t("onboarding.wallet.pickOne")}</p>

      <WalletChooser />

      {/* The one warning we make unskippable. */}
      <div
        className="card"
        style={{ borderColor: "var(--warn, #c98a2b)", background: "color-mix(in srgb, var(--warn, #c98a2b) 8%, transparent)", padding: 14, marginTop: 16 }}
      >
        <div className="name" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-hidden>⚠️</span> {t("onboarding.wallet.seedWarnTitle")}
        </div>
        <p className="sm" style={{ margin: "8px 0" }}>
          {t("onboarding.wallet.seedP2a")} <em>{t("onboarding.wallet.emSeed")}</em> {t("onboarding.wallet.orWord")}
          <em> {t("onboarding.wallet.emRecovery")}</em>{t("onboarding.wallet.seedP2b")} <strong>{t("onboarding.wallet.emOnly")}</strong> {t("onboarding.wallet.seedP2c")}
        </p>
        <label className="row sm" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{t("onboarding.wallet.ackLabel")}</span>
        </label>
      </div>

      {!ack && (
        <p className="muted sm" style={{ marginTop: 10 }}>
          {t("onboarding.wallet.notAckedA")} <strong>{t("onboarding.wallet.step2")}</strong> {t("onboarding.wallet.notAckedB")}
        </p>
      )}
      {ack && (
        <p className="sm" style={{ marginTop: 10, color: "var(--accent, #6b8f71)" }}>
          {t("onboarding.wallet.ackedA")} <strong>{t("onboarding.wallet.step2Vouch")}</strong> →
        </p>
      )}
    </section>
  );
}

/* ── Step 2 — Vouch ──────────────────────────────────────────────────────── */
function StepVouch() {
  const t = useT();
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>2 · {t("onboarding.vouch.title")}</h2>
      <p>
        {t("onboarding.vouch.p1a")}{" "}
        <strong>{t("onboarding.vouch.parrain")}</strong> {t("onboarding.vouch.p1b")} <em>{t("onboarding.vouch.quote")}</em>
      </p>
      <ol className="sm" style={{ lineHeight: 1.7 }}>
        <li>{t("onboarding.vouch.li1")}</li>
        <li>{t("onboarding.vouch.li2")}</li>
        <li>
          {t("onboarding.vouch.li3a")}{" "}
          <strong>{t("onboarding.vouch.li3fund")}</strong> {t("onboarding.vouch.li3b")}{" "}
          <strong>{t("onboarding.vouch.li3faucet")}</strong> {t("onboarding.vouch.li3c")}
        </li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Link className="btn" href="/me">{t("onboarding.vouch.goToMyPage")} →</Link>
        <Link className="btn btn-ghost" href="/documents">{t("onboarding.vouch.readTraditions")}</Link>
      </div>
      <p className="muted sm" style={{ marginTop: 12 }}>
        {t("onboarding.vouch.p3a")} <strong>/me</strong> {t("onboarding.vouch.p3b")}
      </p>
    </section>
  );
}

/* ── Step 3 — Face ───────────────────────────────────────────────────────── */
function StepFace() {
  const t = useT();
  const [avatar, setAvatar] = useState<string | undefined>(() => getUserProfile().avatar);
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      // Existing client-side resize (F33). The image never leaves this device
      // except when YOU later publish it. F69 on-device cartoonisation is not
      // wired yet — see docs/onboarding.md; today this is a normal resized image.
      const dataUrl = await fileToAvatarDataUrl(f);
      setAvatar(dataUrl);
      setUserProfile({ ...getUserProfile(), avatar: dataUrl });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>3 · {t("onboarding.face.title")}</h2>
      <p>
        {t("onboarding.face.intro")}
      </p>

      <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div
          style={{
            width: 96, height: 96, borderRadius: "50%", overflow: "hidden",
            background: "var(--muted, #eee)", display: "grid", placeItems: "center", flex: "0 0 auto",
          }}
        >
          {avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={avatar} alt={t("onboarding.face.avatarAlt")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span className="muted sm">{t("onboarding.face.noPhoto")}</span>
          )}
        </div>
        <label className="btn btn-sm" style={{ cursor: "pointer" }}>
          {busy ? t("onboarding.face.processing") : avatar ? t("onboarding.face.changePhoto") : t("onboarding.face.choosePhoto")}
          <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        </label>
      </div>
      {err && <p className="error sm">{err}</p>}
      <p className="muted sm" style={{ marginTop: 6 }}>
        {t("onboarding.face.cartoonNote")}
      </p>

      <label className="sm" style={{ display: "block", marginTop: 12, fontWeight: 600 }}>{t("onboarding.face.bioLabel")}</label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
        placeholder={t("onboarding.face.bioPlaceholder")}
        style={{ width: "100%", marginTop: 4 }}
      />
      <p className="muted sm" style={{ marginTop: 4 }}>
        {t("onboarding.face.editProfileA")} <Link href="/me">/me</Link> {t("onboarding.face.editProfileB")}
      </p>

      {/* The bare cord — a beginning, not an absence. */}
      <div className="card" style={{ padding: 14, marginTop: 16 }}>
        <div className="name">{t("onboarding.face.quipuTitle")}</div>
        <p className="muted sm" style={{ margin: "4px 0 8px" }}>
          {t("onboarding.face.quipuDesc")}
        </p>
        <QuipuNecklace cords={[]} height={120} />
      </div>

      {/* Provisional-member note — one attestation gets you a live page; the rest
          waits for the second sponsor. */}
      <div
        className="card"
        style={{ padding: 14, marginTop: 16, borderColor: "var(--accent, #6b8f71)" }}
      >
        <div className="name">{t("onboarding.face.provTitle")}</div>
        <p className="sm" style={{ margin: "6px 0 0" }}>
          {t("onboarding.face.provA")} <strong>{t("onboarding.face.provLivePage")}</strong> {t("onboarding.face.provB")}{" "}
          <strong>{t("onboarding.face.provFaucet")}</strong>{t("onboarding.face.provC")}{" "}
          <strong>{t("onboarding.face.provSecondSponsor")}</strong> {t("onboarding.face.provD")}
        </p>
        {/* Epic 11 / F78 — say this BEFORE the member finishes, not after they lose a device. */}
        <p className="sm muted" style={{ margin: "8px 0 0" }}>
          {t("onboarding.face.recoveryA")} <strong>{t("onboarding.face.recoveryStrong")}</strong>{t("onboarding.face.recoveryB")}
        </p>
      </div>
    </section>
  );
}
