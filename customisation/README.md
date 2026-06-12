# Customisation

A place to **customise an AHA / Ayni deployment without forking the core** — drop
your fellowship's own branding, text, and configuration here, and point the app /
seed scripts at it.

Suggested layout (create what you need):

```
customisation/
  branding/        logo, colors, favicon, social image
  content/         your fellowship's own text:
                     twelve-steps.md · preamble.md · daily-reflections.json
  circles/         seed config for your Circles (name, city, lat/lon, doc CIDs)
  theme/           frontend overrides (CSS variables, copy)
```

Why a separate folder: the **core** (`programs/`, `circuits/`, `frontend/lib`)
stays generic and upgradeable; everything specific to *your* fellowship lives
here, so you can pull upstream changes without merge pain.

- The **Daily Reflections** and **Documents** features read their text from IPFS
  by CID — author the files under `content/`, pin them, and set the CIDs on-chain
  via `upsert_circle_profile` (see [../IMPLEMENTATION.md](../IMPLEMENTATION.md)).
- Circle seed configs here can drive `scripts/seed-devnet.js`.

> Stub directory — fill in as your deployment needs. Nothing here is required to
> run the generic Ayni.
