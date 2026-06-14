# Running the AHA · Ayni frontend with Docker

A self-contained Next.js (standalone) image. **One command to launch:**

```bash
cd frontend
docker compose up --build
```

Then open **http://localhost:3000**.

- `--build` builds the image the first time (and after code changes). On later
  runs you can drop it: `docker compose up`.
- Run detached (in the background): `docker compose up --build -d`.
- Stop: `docker compose down` (add `--rmi local` to also delete the image).
- Logs: `docker compose logs -f`.

## What you get

- Multi-stage build → a small (~50 MB) runtime image (`aha-frontend`).
- Serves on port **3000** (change the mapping in `docker-compose.yml`, e.g.
  `"8080:3000"`).
- Includes the `/api/circle-email` route (Node runtime).

## Configuration

### Public settings (inlined into the browser bundle — set at **build** time)

Because Next inlines `NEXT_PUBLIC_*` at build time, these are **build args**.
Defaults live in `docker-compose.yml`; override them with a `.env` file placed
next to `docker-compose.yml` (Compose reads it automatically), then rebuild:

```ini
# frontend/.env   (keep out of git — it may hold an API key)
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_IPFS_GATEWAY=https://w3s.link/ipfs/
NEXT_PUBLIC_FOUNDATION_CIRCLE=DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo
NEXT_PUBLIC_AHA_EMAIL_DOMAIN=aha.community
```

```bash
docker compose up --build      # picks up the new .env values
```

> The public Solana devnet RPC (`api.devnet.solana.com`) is heavily rate-limited
> (HTTP 429). Use a dedicated endpoint (Helius/QuickNode/Triton/Alchemy free
> tier) via `NEXT_PUBLIC_RPC_URL` for a smooth experience.

### Server-side settings (the email route — set at **run** time)

Optional SMTP for `/api/circle-email`. Add to the same `.env`; no rebuild needed
(passed as container env):

```ini
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=secret
SMTP_FROM=Ayni <no-reply@aha.community>
AHA_EMAIL_DOMAIN=aha.community
```

Without `SMTP_HOST` the Circle address is still assigned; no mail is sent.

## Without Compose (plain Docker)

```bash
cd frontend
docker build -t aha-frontend \
  --build-arg NEXT_PUBLIC_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" \
  --build-arg NEXT_PUBLIC_FOUNDATION_CIRCLE="DH6uDzb77mZuF8TP2ucdHUkwyW6wyZkJj8nm3i79EAUo" .

docker run --rm -p 3000:3000 \
  -e SMTP_HOST=... -e SMTP_USER=... -e SMTP_PASS=... \
  aha-frontend
```

## Notes

- The image is production (`next start` via the standalone `server.js`), not the
  dev server — no hot reload. Rebuild to pick up code changes.
- `.dockerignore` excludes `node_modules`, `.next`, and `.env*.local`, so your
  local cache and secrets never enter the image.
- Files: `frontend/Dockerfile`, `frontend/docker-compose.yml`,
  `frontend/.dockerignore`, and `output: "standalone"` in `next.config.mjs`.
