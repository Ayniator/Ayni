# AHA email send-worker (F25)

A small poller that fires the per-Circle emails for events that **don't pass
through the web UI** — a membership issued by a script, another client, or
directly on-chain. The web app already sends on create/join; this covers
everything else, so notifications are complete regardless of how a Circle or
membership comes into being.

## How it works

- Polls the program for `Circle` and `Membership` accounts every `POLL_SECONDS`.
- When a **new** account appears, POSTs to the frontend's `/api/circle-email`
  route (which holds the SMTP creds) — `provision` for a new Circle, `join` for
  a new membership (with the member's `owner` wallet if not anonymous).
- **Baseline-safe:** the first run records all existing accounts as already-seen
  *without emailing*, so it never blasts the back-catalog. State persists to
  `STATE_FILE`; restarts don't re-send.

## Run it

```bash
cd indexer
npm install
EMAIL_ENDPOINT="https://aha.a13z.org:8443/api/circle-email" \
RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" \
INSECURE_TLS=1 \
node email-indexer.js
```

(`INSECURE_TLS=1` only if you point `EMAIL_ENDPOINT` at the alt-port/self-signed
endpoint; not needed for a clean public cert.)

### As a container (compose snippet)

```yaml
  email-indexer:
    build: ./indexer
    environment:
      EMAIL_ENDPOINT: "http://frontend:3000/api/circle-email"   # in-network, no TLS needed
      RPC_URL: "${NEXT_PUBLIC_RPC_URL}"
    volumes:
      - ./indexer/ayni.json:/app/ayni.json:ro                   # the IDL
      - email_indexer_data:/data
    restart: unless-stopped
```

Pointing `EMAIL_ENDPOINT` at `http://frontend:3000/...` over the compose network
avoids TLS entirely and never leaves the host.

## The remaining ops step: make the `@aha` addresses *receive*

Sending is done (Mailgun). For the derived `slug-<pda6>@DOMAIN` addresses to
actually **receive** mail, the mail domain needs inbound routing. With Mailgun:

1. Add/verify the sending+receiving domain in Mailgun (MX records on the domain
   you control, e.g. a subdomain like `mg.tips-profile.com` or a real `aha`
   domain).
2. Create a **Route** (Receiving → Routes) that catches `.*@DOMAIN` and either
   forwards to a real inbox/list or stores it for an API to read.
3. Set the frontend's `AHA_EMAIL_DOMAIN` (and `NEXT_PUBLIC_AHA_EMAIL_DOMAIN`) to
   that domain so the derived addresses match the MX'd domain.

Until then, outbound provision/join mail is delivered, but replies to a
`@aha.community` address bounce (that domain has no MX / isn't ours). This is a
DNS/Mailgun-dashboard task, not code.
