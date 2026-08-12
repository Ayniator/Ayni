# Private messaging — what the relay knows (F63 v2, metadata mixing)

**Status: shipped.** This document is the honest, current account of what the
off-chain mailbox hides and what it still leaks. It supersedes nothing in
`docs/messaging-migration.md` (which remains the v2/v3 *target* design — the
libsignal ratchet, PIR directory lookup and multi-relay work described there is
still ahead); it describes what is actually in the code today.

The user-facing copy for all of this is `msg.inbox.metadata` in
`frontend/lib/i18n.ts`. **If anything in §4 or §5 changes, that string changes in
the same commit.** Over-claiming there is a privacy defect, not a wording nit.

---

## 1. The starting point (F63 v1)

v1 moved private messages off the public ledger entirely and sealed them so the
relay could not read them or learn who wrote them:

- sealed sender — the author is named and signed only *inside* the ciphertext;
- fixed-length ciphertext (`MBX_CT_LEN` = 1040 bytes) — message length leaks
  nothing;
- mailbox addressed by an opaque wallet-derived id, no enumeration op;
- reads and deletes require the recipient wallet's signature.

What it left visible at the relay was the **shape of the traffic**:

```
put(to = BOX_B)  at T      →      get(BOX_B)  at T + δ
```

which reads as "somebody wrote to B at T, and B read it δ later". Sealed sender
hides *who wrote*; it does nothing about that pattern. The old inbox copy said
so, and called mixing "the documented next step, not yet shipped".

## 2. What v2 ships

Four measures, in `frontend/lib/mailboxMixing.ts` (pure, shared by the relay
route and the client), `frontend/lib/mailbox.ts` (client half) and
`frontend/app/api/mailbox/route.ts` (relay half).

### 2.1 Timing decorrelation

- **Client send jitter.** A real `put` is held for a uniform random delay of up
  to `maxSendJitterMs` (default 2.5 s) before it leaves the device, so the
  instant it reaches the relay is not the instant the member pressed *Send* —
  it no longer lines up with everything else the app did in that second.
- **Relay delivery buckets.** An envelope is stored on arrival but becomes
  readable only at the next boundary of a fixed grid
  (`AHA_MAILBOX_DELIVERY_BUCKET_SECS`, default 60, `0` disables). Delivery is
  therefore a batch release on a public timetable rather than a continuous
  stream that tracks send times.

**Ordering is preserved exactly.** `mbxReleaseAt` is a monotone ceiling: if A
arrives before B, A is released no later than B. `get` additionally sorts on the
full-precision arrival time (v1 sorted on whole seconds, leaving same-second
order to `readdir`) and sorts *before* capping the page at 100, so the delay can
never drop an older envelope out of the page in favour of a newer one. The
inbox's FIFO is strictly better defined after this change than before it.

### 2.2 Cover traffic (decoys)

Clients emit dummy `put`s on a constant cadence (`coverPeriodMs`, default one
per 3 minutes).

- **A dummy is a real sealed envelope.** Same op, same field set, same 32-byte
  ephemeral key, same 24-byte nonce, same fixed-length ciphertext, same padded
  request body. Its `expiresAt` — the one envelope field with real variety that
  the relay can read — is drawn from exactly the menu the compose form offers
  (Never / 1 day / 1 week / 30 days, weighted to the "Never" default), so "an
  expiry is set" never means "definitely a real message". **The relay has no
  notion of cover and cannot acquire one** — `route.ts` never references the
  marker, and the test asserts that.
- **The marker lives inside the ciphertext.** `{ cover: 1 }` on the inner
  envelope, which only the recipient's prekey secret can open. It is a distinct
  field, not a body prefix, so no real message can be suppressed by what its
  author happened to type.
- **A dummy never reaches the inbox.** `partitionCover` is the single gate on
  the delivery path: `fetchMailboxMessages` decrypts, partitions, and only ever
  builds `MailboxMessage`s from the `mail` half. A dummy cannot be rendered,
  replied to, counted or notified on.
- **Dummies clean themselves up.** Their ids ride along on the member's next
  ack, so one wallet signature deletes read mail and sweeps the decoys out of
  the same box — no extra prompt, no second round trip.
- **Destinations are only mailboxes we hold a live prekey for**: our own, plus
  peers whose bundle this session verified. That is deliberate: a decoy sent to
  a mailbox we cannot seal to properly would be undeletable litter in someone
  else's box. Cover targets are chosen uniformly over that set.
- **A real send claims the next decoy** (`noteRealPut`), so a client's `put`
  *rate* does not rise when the member starts writing to someone.
- **Capped** at `maxOutstandingCover` (16) decoys per fetch-and-ack cycle, well
  under the relay's `MAX_PER_BOX` = 500, so cover can never FIFO-evict real mail
  out of a mailbox the member has not cleared. When the cap is reached cover
  stops until the box is swept.

### 2.3 Size padding

v1 fixed the ciphertext length. v2 fixes everything around it:

- **Requests** are padded to a 2 KiB block (`padRequestBody`). A `put`, a `get`,
  an `ack` and a `bundle` lookup are the same size on the wire. The relay bounds
  `pad` at 8 KiB, and **discards it** — nothing about it is stored or echoed.
- **Replies** are padded too. Every reply is at least 1 KiB, so "this wallet has
  enabled private messaging" and "it has not" are the same length; `get` replies
  are padded to a power-of-two size class of rows, so an on-path observer reads
  at most log₂(count) rather than the exact envelope count.

This closes *wire* leaks. It does not blind the relay itself, which parses the
body it is padding.

### 2.4 Constant-rate polling

`planTick` schedules `get`s on a fixed period (`pollPeriodMs`, default 45 s)
from a random phase, **taking no input but (state, config, clock)** — mailbox
contents cannot influence the schedule, so a fetch never signals "the member has
mail" or "the member just opened the app".

Polling is armed by `fetchMailboxMessages` itself, so the inbox page needs no
change and no call site can forget it. It reuses the read-signature the member
already gave: `getSignedBytes(to, window)` is accepted for the current *or*
previous 10-minute window, which buys 10–20 minutes of silent polling per
signature. **When it lapses, polling simply stops** — the scheduler never
prompts the wallet on its own. Decoy `put`s need no signature and continue for
the rest of the session.

## 3. Cost, and how it interacts with the rate limits

A continuously-mixing client sends **1.67 requests/minute** (1.33 polls + 0.33
decoys). At 2 KiB up and ≥1 KiB down that is roughly **6 KB/minute**, or about
**360 KB for a full one-hour session** — the session then stops itself
(`maxSessionMs`), so a forgotten tab is not an open-ended data plan. Relay-side,
a member's decoys occupy at most 16 × ~1.6 KB ≈ 26 KB until the next sweep.

Against the relay's existing limiters (`tests/mailbox-mixing.test.mjs` asserts
all of this, and the limits are *imported* from `mailboxMixing.ts` by the route
so the two can never drift):

- **Per-IP, 30 req/min, all ops.** Mixing uses 1.67, i.e. under 6% — and the
  budget check requires it to stay under *half*, leaving ≥15 req/min for the
  member's own sends, reads and deletes. Roughly 8–9 continuously-mixing clients
  fit behind a single NAT address before they would start competing with each
  other; beyond that the backoff below is what protects delivery.
- **Global, 240 req/min, scoped to `bundle` + `put`.** Only decoy `put`s reach
  it (constant-rate polling is a `get`, deliberately not globally capped). At
  0.33 decoys/min per client, ≥360 concurrently-mixing clients fit while still
  leaving half the global budget for real puts and bundle lookups.
- **On a 429 the scheduler backs off** (doubling its periods, up to 8×, and
  recovering on success) rather than competing with the member's real traffic.
  Cover is always best-effort and its failures never surface to the member.

## 4. What genuinely improves

- "**This mailbox received something at T**" no longer implies anyone wrote to
  it. That was the load-bearing leak, and decoys are what remove it.
- "**This member fetched at T**" no longer implies they opened the app, had
  mail, or read anything.
- **Send time is decoupled from arrival time** (jitter) and **arrival time from
  delivery time** (buckets), so the classic `put`-then-`get` pairing no longer
  falls out of the timestamps.
- **On the wire, all mailbox traffic looks alike**: one request size, one reply
  size, one ciphertext size, one cadence.
- **Nothing new is remembered anywhere.** The cover cohort, the cached
  read-signature and the scheduler are in-memory for the tab and are cleared on
  `pagehide`. No new persistent identifier, no new localStorage entry, no new
  server-side state, no enumeration surface. The relay stores exactly what it
  stored in v1 plus one integer release time per envelope.

## 5. What still leaks — say this, do not soften it

1. **Source IP next to mailbox id.** The relay sees the network address every
   request comes from, alongside the mailbox that request names. Decoys make any
   *single* `put` uninformative, but an operator who correlates addresses over
   time still learns which addresses talk to which mailboxes. **This is the
   biggest remaining leak, and mixing does not close it.** Closing it is a
   transport problem — Tor, or a real mixnet — and is out of scope here (§6).
2. **First contact is uncovered.** Decoys only go to mailboxes this device holds
   a verified prekey bundle for, which it learns by sending a real message. So
   the *first* message to a new contact is the one `put` to that mailbox from
   this address, with no decoys around it.
3. **The prekey directory is still an enrollment oracle.** A non-null `bundle`
   reply proves that wallet has enabled private messaging. v1 accepted this as a
   bounded residual (it is throttled, and reply padding now hides it from an
   on-path observer, but not from the relay). Closing it needs private contact
   discovery — PIR or an OPRF.
4. **The relay still maps mailbox ↔ wallet**, because the mailbox id is a public
   derivation of the wallet and the directory is keyed by wallet.
5. **Coarse granularity, not anonymity.** Decoys at one per 3 minutes and a
   60-second release grid raise the cost of traffic analysis; they do not defeat
   a global passive adversary, and no configuration of this design would.
6. **Cover stops when the budget is full.** If a member never clears their
   mailbox, decoys stop after 16 — protecting their real mail from eviction at
   the price of their cover. That is the right trade, and it is a real gap.
7. **Everything above is per-relay.** A member on a metered connection can turn
   mixing off entirely (`localStorage["aha:mbx:mix"] = "off"`, or
   `NEXT_PUBLIC_AHA_MAILBOX_MIXING=off` at build time), which returns them to v1
   behaviour — messaging still works, with v1's metadata.

## 6. Deliberately NOT built

Each of these was considered and rejected for this round, with the reason:

- **A real mixnet, or routing the relay behind Tor.** This is the only thing
  that closes leak §5.1, and it is infrastructure, not code — a second relay
  hop, a hidden service, an onion transport. The brief for this round excluded
  new infrastructure, and half-building a mixnet (one hop, no batching, no
  padding between hops) would look like anonymity without providing it.
- **PIR / OPRF private contact discovery** for the prekey directory (leak §5.3).
  Needs a real primitive and a protocol change on both sides; it is the F63 v2
  directory item in `docs/messaging-migration.md` §4, not a mixing measure.
- **Server-side re-mixing / re-encryption of envelopes.** Would require the
  relay to hold key material — forbidden: no secret store on any server.
- **Random-destination decoys** (sending to mailbox ids nobody owns, to
  manufacture false edges). It would fabricate edges, but the envelopes would be
  undeletable by anyone and would sit in strangers' boxes until the 30-day TTL,
  where they could evict real mail. Litter in someone else's mailbox is not an
  acceptable price for our own cover.
- **A persistent cover cohort.** Keeping known contacts on disk would let decoys
  start covering a contact before the first real message (leak §5.2), but a
  plaintext contact list in `localStorage` is a worse leak on a shared or seized
  device than the one it buys back. Kept in memory, per session.
- **Fully constant-rate sending** (real messages waiting for the next scheduled
  slot). It is strictly better for privacy, and it means a message can sit
  unsent for minutes with no way to tell the member why. Instead a real send is
  immediate-with-jitter and *claims* the next decoy, which keeps the **rate**
  flat even though the phase is not.
- **Unattended background polling with an external wallet.** Each `get` needs a
  wallet signature, and an external wallet prompts for every one. Polling
  therefore runs only while a signature obtained for the member's own fetch is
  still valid (10–20 minutes) and then stops, rather than interrupting the
  member with prompts they did not ask for.
- **Padding error replies to a single length.** Success and failure replies are
  both padded to ≥1 KiB, but a 403 is still a 403 — status codes are not hidden.

## 7. Where the guarantees are tested

`tests/mailbox-mixing.test.mjs` (plain node, no framework):

- a decoy is byte-identical in shape to real mail, draws its expiry from exactly
  the compose form's menu, and two decoys never repeat;
- `route.ts` contains no way to recognise cover;
- a decoy decrypts, is recognised, is dropped, and **never** reaches the inbox —
  including a static check that the fetch path has no unpartitioned loop;
- a decoy carries no identity, body or signature even to its recipient, and
  never verifies as authored mail;
- delivery buckets never reorder mail and always delay; `0` disables them;
- every op leaves the device at one size; enrolled and unenrolled bundle replies
  are the same length; `get` replies collapse to size classes;
- polling is constant-rate and cannot depend on mailbox contents;
- a real send suppresses a decoy so the put rate stays flat;
- cover is capped below `MAX_PER_BOX` and resumes after a sweep;
- the session stops itself; a 429 backs it off;
- the cover budget fits inside both rate limits, against the *same constants*
  the route runs on;
- mixing disabled ⇒ v1 behaviour, and messaging still works;
- no network sink in `mailboxMixing.ts`, and no new persistent store in
  `mailbox.ts`;
- **end-to-end against the real relay route** (loaded with a `next/server` stub,
  since Next needs node ≥ 20 and this runtime is 18): hold-then-release,
  FIFO order, the client-side partition after a real round trip, the ride-along
  ack, v1 files already on disk still delivering, pad bounds, and a decoy `put`
  being answered identically to a real one.

`tests/mailbox.ts` (the v1 crypto property tests) is unchanged and still passes.
