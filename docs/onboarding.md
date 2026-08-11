# Graphical onboarding (Epic 9)

A guided, three-macro-step visual flow that takes a newcomer from *nothing* to a
live page in under ten minutes. One action per screen, plain language, and the
position in the journey is **always visible** so nobody gets lost.

```
  1  Wallet   →   2  Vouch   →   3  Face
```

Route: **`/onboarding`** (`frontend/app/onboarding/page.tsx`).

## The three steps

### 1 · Wallet (F67)
- **`WalletChooser`** (`frontend/components/WalletChooser.tsx`) lists five vetted,
  **self-custodial** wallets — Phantom, Solflare, Glow, Trust Wallet, Jupiter
  Mobile — each with per-platform links (App Store, Play Store, web/extension).
- The wallets come from **`docs/wallets.json`** (the single source of truth,
  re-reviewed **each equinox**).
- **Order is randomised on every load** (uniform Fisher–Yates seeded only by
  `Math.random()`, never by any user identifier) so no wallet holds a permanent
  first position — Tradition **T6** (no endorsements).
- Explains sign-in: *no password* — you **sign a short message** to prove you
  hold the key; it costs nothing and moves no money.
- **Unskippable seed-phrase warning** — a checkbox the newcomer must read and
  tick, acknowledging they wrote their recovery phrase down offline. This is
  **copy only**: AHA never creates wallets and never touches seed phrases; the
  wallet apps do that. We only make sure the warning is impossible to skim past.

### 2 · Vouch
- Explains the **parrain (sponsor) attestation**: there is no sign-up form; you
  join because someone inside vouches for you on-chain.
- Explains the **fund-or-faucet** choice: pay a tiny network fee yourself, or use
  the free faucet so cost is never a barrier.
- **Links into the existing `/me` flow** for both the attestation and the faucet
  — this step orients, it does not reimplement those surfaces.

### 3 · Face
- Profile **picture** (reuses the existing F33 client-side resize,
  `fileToAvatarDataUrl` → `setUserProfile`) + an optional **bio** line.
- Shows the **empty quipu as a bare cord** (`QuipuNecklace cords={[]}`) — framed
  as *a beginning, not an absence*. No score, no "N of 12".
- **Provisional-member note**: one attestation ⇒ a live page + faucet
  immediately; but **no vote, no roles, and no access to other members' data**
  until a **second sponsor** confirms.

## Files
| File | Role |
|---|---|
| `docs/wallets.json` | F67 — the five self-custodial wallets + per-platform links; reviewed each equinox. |
| `frontend/components/WalletChooser.tsx` | Randomised, non-correlated wallet list. |
| `frontend/app/onboarding/page.tsx` | The 3-step stepper with an always-visible position indicator. |
| `docs/onboarding.md` | This document. |

## Honest status — what is real vs. deferred

**Real today:** the full three-step flow, the wallet chooser with real store
links and a genuinely uniform non-correlated shuffle, the unskippable seed-phrase
acknowledgement, the links into the existing `/me` attestation + faucet surfaces,
the bare-cord quipu, and Step 3's profile-picture upload (the existing
client-side resize actually saves to the local profile).

**Deferred — the remaining technical piece (F69, on-device cartoonisation):**
The intended privacy property is that a newcomer's **raw photo never leaves their
phone**: it is stylised on-device into a cartoon portrait that stays recognisable
to fellow members but defeats automated face-recognition. That requires an
**on-device image-to-cartoon model** (e.g. a quantised style-transfer / GAN
network running in-browser via WebGPU/WASM, or a native mobile model) that we
cannot ship as a stub without faking it.

So **F69 is explicitly deferred and labelled as such in the UI.** Today Step 3
accepts a **normal profile image** through the existing client-side resize; there
is no cartoonisation. The onboarding screen tells the newcomer this in plain
words ("Cartoonisation … is coming — it will run on your phone so the raw photo
never leaves it. For now this is a normal picture; keep that in mind when
choosing one."). When the model lands, it slots in between
`fileToAvatarDataUrl`'s decode step and the saved data URL — no other change to
the flow is needed.

## For the main agent — wiring
- Add a nav / call-to-action entry to **`/onboarding`** (e.g. a "New here? Start
  here" link in `frontend/components/Nav.tsx`, or a button on the home page and
  the `/me` page for not-yet-members).
- `WalletChooser` imports `../../docs/wallets.json`; `resolveJsonModule` is
  already on in `frontend/tsconfig.json`, so no config change is required.
