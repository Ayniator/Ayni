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

const STEPS = [
  { n: 1, key: "wallet", label: "Wallet", hint: "Get a wallet" },
  { n: 2, key: "vouch", label: "Vouch", hint: "Get vouched for" },
  { n: 3, key: "face", label: "Face", hint: "Show your face" },
] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const total = STEPS.length;

  return (
    <div className="onboarding" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Welcome — let&apos;s get you a seat</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Three steps. No password, no email, no fee. Most people finish in under ten minutes.
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
          ← Back
        </button>
        <span className="muted sm">Step {step} of {total}</span>
        {step < total ? (
          <button className="btn" onClick={() => setStep((s) => Math.min(total, s + 1))}>
            Next: {STEPS[step].label} →
          </button>
        ) : (
          <Link className="btn" href="/me">Open my page →</Link>
        )}
      </div>
    </div>
  );
}

function PositionIndicator({ current, onJump }: { current: number; onJump: (n: number) => void }) {
  return (
    <div className="row" style={{ gap: 0, marginTop: 12, alignItems: "center" }}>
      {STEPS.map((s, i) => (
        <div key={s.key} className="row" style={{ gap: 0, alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
          <button
            onClick={() => onJump(s.n)}
            className="btn btn-sm"
            title={s.hint}
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
            {s.label}
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
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>1 · Get a wallet</h2>
      <p>
        Your wallet is how you sign in — there is no username or password. When AHA needs to know
        it&apos;s you, your wallet asks you to <strong>sign a short message</strong>. Signing proves
        you hold the key; it costs nothing and moves no money.
      </p>
      <p className="muted sm">Pick one wallet below and install it. Any of them works.</p>

      <WalletChooser />

      {/* The one warning we make unskippable. */}
      <div
        className="card"
        style={{ borderColor: "var(--warn, #c98a2b)", background: "color-mix(in srgb, var(--warn, #c98a2b) 8%, transparent)", padding: 14, marginTop: 16 }}
      >
        <div className="name" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span aria-hidden>⚠️</span> Write down your seed phrase — this is the one thing you cannot undo
        </div>
        <p className="sm" style={{ margin: "8px 0" }}>
          When your wallet shows you a list of secret words (your <em>seed phrase</em> or
          <em> recovery phrase</em>), write them on paper and keep them somewhere safe and private.
          They are the <strong>only</strong> way to recover your account. Nobody — not AHA, not your
          sponsor, not the wallet company — can restore them for you. Never type them into a website,
          never photograph them, never share them with anyone who asks.
        </p>
        <label className="row sm" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I have set up a wallet and written my seed phrase down somewhere safe and offline.</span>
        </label>
      </div>

      {!ack && (
        <p className="muted sm" style={{ marginTop: 10 }}>
          Once you&apos;ve done this, tick the box above — then go to <strong>Step 2</strong> to be vouched for.
        </p>
      )}
      {ack && (
        <p className="sm" style={{ marginTop: 10, color: "var(--accent, #6b8f71)" }}>
          Good. Your keys are yours. Continue to <strong>Step 2 · Vouch</strong> →
        </p>
      )}
    </section>
  );
}

/* ── Step 2 — Vouch ──────────────────────────────────────────────────────── */
function StepVouch() {
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>2 · Get vouched for</h2>
      <p>
        AHA has no sign-up form. You join because someone already inside vouches for you — your{" "}
        <strong>parrain</strong> (sponsor). They record a private attestation on-chain that says,
        in effect, <em>&ldquo;I know this person and they belong here.&rdquo;</em>
      </p>
      <ol className="sm" style={{ lineHeight: 1.7 }}>
        <li>Tell your parrain the wallet address you just set up.</li>
        <li>They open their own page and add their attestation for you.</li>
        <li>
          For the tiny network fee your first actions cost, you have a choice:{" "}
          <strong>fund your wallet</strong> yourself with a small amount of SOL, or use the{" "}
          <strong>faucet</strong> — a free top-up so cost is never a barrier to a seat.
        </li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Link className="btn" href="/me">Go to my page (attestation &amp; faucet) →</Link>
        <Link className="btn btn-ghost" href="/documents">Read about the Traditions</Link>
      </div>
      <p className="muted sm" style={{ marginTop: 12 }}>
        The attestation and the faucet both live on your <strong>/me</strong> page — this step just
        points you there so you don&apos;t have to hunt for them.
      </p>
    </section>
  );
}

/* ── Step 3 — Face ───────────────────────────────────────────────────────── */
function StepFace() {
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
      <h2 style={{ marginTop: 0 }}>3 · Show your face</h2>
      <p>
        A picture and a line about yourself help your Circle recognise you. Your photo is resized on
        this device before it is used.
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
            <img src={avatar} alt="Your profile picture" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span className="muted sm">no photo yet</span>
          )}
        </div>
        <label className="btn btn-sm" style={{ cursor: "pointer" }}>
          {busy ? "Processing…" : avatar ? "Change photo" : "Choose a photo"}
          <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        </label>
      </div>
      {err && <p className="error sm">{err}</p>}
      <p className="muted sm" style={{ marginTop: 6 }}>
        Cartoonisation (a stylised portrait that stays recognisable but defeats face-recognition) is
        coming — it will run on your phone so the raw photo never leaves it. For now this is a normal
        picture; keep that in mind when choosing one.
      </p>

      <label className="sm" style={{ display: "block", marginTop: 12, fontWeight: 600 }}>A line about you (optional)</label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
        placeholder="A sentence or two — as much or as little as you like."
        style={{ width: "100%", marginTop: 4 }}
      />
      <p className="muted sm" style={{ marginTop: 4 }}>
        You can edit your full profile any time on your <Link href="/me">/me</Link> page.
      </p>

      {/* The bare cord — a beginning, not an absence. */}
      <div className="card" style={{ padding: 14, marginTop: 16 }}>
        <div className="name">Your quipu</div>
        <p className="muted sm" style={{ margin: "4px 0 8px" }}>
          Everyone starts here: a single bare cord. As you complete steps, your sponsor ties a knot
          for each one — it fills over time. There is no score and no &ldquo;how far along&rdquo;;
          it simply holds what you have done.
        </p>
        <QuipuNecklace cords={[]} height={120} />
      </div>

      {/* Provisional-member note — one attestation gets you a live page; the rest
          waits for the second sponsor. */}
      <div
        className="card"
        style={{ padding: 14, marginTop: 16, borderColor: "var(--accent, #6b8f71)" }}
      >
        <div className="name">You&apos;re in — provisionally</div>
        <p className="sm" style={{ margin: "6px 0 0" }}>
          With one sponsor&apos;s attestation you get a <strong>live page</strong> and the{" "}
          <strong>faucet</strong>, so you can find your feet right away. Until a{" "}
          <strong>second sponsor</strong> confirms you, you remain a provisional member: no vote, no
          roles, and no access to other members&apos; data. This is the fellowship&apos;s way of
          welcoming you quickly while keeping everyone safe.
        </p>
      </div>
    </section>
  );
}
