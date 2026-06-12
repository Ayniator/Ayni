# AHA · Ayni — Web App

Next.js front-end for the AHA fellowship. Three features, all reading directly
from the chain + IPFS (no backend):

- **Find a Circle Near You** — browser geolocation → an OpenStreetMap map and a
  distance-ranked list of every Circle that has published a directory profile.
  Each Circle is shown with its deterministic **Jazzicon** avatar.
- **Daily Reflections** — today's reading, pulled from a Circle's
  `daily_reflections_cid` on IPFS.
- **Documents** — the 12 Steps, Preamble, and Daily Reflections collection,
  pinned on IPFS with the CID committed on-chain by the Circle's Council.

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
