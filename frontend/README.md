# AHA · Ayni — Web App

Next.js front-end for the AHA fellowship. Four features, all reading directly
from the chain + IPFS (no backend):

- **Find a Circle Near You** — browser geolocation → an OpenStreetMap map and a
  distance-ranked list of every Circle that has published a directory profile.
  Each Circle is shown with its deterministic **Jazzicon** avatar.
- **Daily Reflections** — today's reading, pulled from a Circle's
  `daily_reflections_cid` on IPFS.
- **Documents** — the 12 Steps, Preamble, and Daily Reflections collection,
  pinned on IPFS with the CID committed on-chain by the Circle's Council.
- **My Circle** (`/me`) — connect a Solana wallet (Phantom, Solflare, Backpack…
  anything Wallet-Standard) to see your on-chain data, join a home circle, and
  practice the **7th Tradition**.
- **Create a Circle** (`/create`) — a permissionless wizard around
  `initialize_circle` + `initialize_member_tree`: name, parent (foundation by
  default), and the 7-seat Council (your wallet auto-takes one seat).
- **Administration of my Circle** (`/admin`) — shown **only** to wallets that
  hold a Council seat: your role, Council + group-conscience votes with CRUD,
  and member add/renew.

## My Circle

- **Your data** — SOL balance plus every `Membership` whose `owner` field is
  your wallet (one `memcmp` at offset 89). Fully anonymous memberships (no
  wallet bound) intentionally don't appear.
- **Join a Circle (home circle)** — pick a Circle; it becomes your home circle.
  Memberships are admitted by the Circle's **Secretary seat** (`issue_membership`),
  so: if your connected wallet *is* the Secretary, the membership is issued
  on-chain immediately (keyed by a fresh anonymous commitment, bound to your
  wallet); otherwise the app produces a **join request** (commitment + wallet)
  to hand to the Secretary, kept in `localStorage` until a matching membership
  appears on-chain.
- **7th Tradition** — donate SOL via the program's `donate` instruction into
  the per-Circle treasury PDA (`["treasury", circle]`) — to your home circle,
  any Circle, or the foundation (`NEXT_PUBLIC_FOUNDATION_CIRCLE`, see
  `.env.local.example`; falls back to the first Circle named like
  "World Service"/"Foundation"). Only the Council can move treasury funds.

On devnet, create the foundation Circle once with
`node ../scripts/seed-foundation.js` (the deployer key holds the Secretary
seat, so it can also admit members).

## Circle email (F25)

Every Circle gets a **mandatory, deterministic** address on the AHA mail domain —
`slug-<pda6>@${NEXT_PUBLIC_AHA_EMAIL_DOMAIN}` — assigned the moment it is created
(no opt-out, no extra on-chain state). The web app:

- shows the address on the **Create a Circle** confirmation, and
- POSTs to `app/api/circle-email/route.ts` to email that address on creation
  (*provision*) and on each registration (*join*, carrying the new member's wallet).

The route sends over SMTP when `SMTP_HOST` (+ friends) are set; otherwise it
returns the derived address with `configured:false` and the UI says no mail was
sent — it never fakes a send. See `.env.local.example` for the SMTP / domain vars.
Real mailbox provisioning on the live domain and a server-side (indexer) send
hook are the remaining pieces — tracked as F25 in `../BACKLOG.md`.

## Data sources

- **On-chain:** the `CircleProfile` PDA (`["profile", circle]`) — geo
  (microdegrees), name, city, address, and three IPFS CIDs. Set by any Council
  seat via `upsert_circle_profile`. Read in one `getProgramAccounts` call
  (`lib/solana.ts`).
- **IPFS:** read-only via a public gateway (`lib/ipfs.ts`).
- **Identicons:** `lib/jazzicon.ts` — a self-contained, deterministic
  Jazzicon SVG generator (no third-party identicon lib). Used everywhere a
  Circle/seat/member needs an avatar.

## Run

```bash
npm install
# point at your cluster + gateway (defaults: devnet + w3s.link)
export NEXT_PUBLIC_RPC_URL="https://api.devnet.solana.com"
export NEXT_PUBLIC_IPFS_GATEWAY="https://w3s.link/ipfs/"
npm run dev      # http://localhost:3000
```

The program IDL is bundled at `lib/ayni.json`; regenerate it with
`anchor build && cp ../target/idl/ayni.json lib/ayni.json` after on-chain changes.

## Daily Reflections JSON format

`daily_reflections_cid` points to a JSON object keyed by `"MM-DD"`:

```json
{
  "01-01": {
    "title": "A Fresh Start",
    "quote": "We are not saints…",
    "source": "Big Book, p.60",
    "reflection": "Today I practice progress, not perfection."
  }
}
```
