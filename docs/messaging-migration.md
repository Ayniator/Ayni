# Messaging migration: moving 1:1 off chain (F63)

**Status: v1 SHIPPED (2026-08-11) — the relay mailbox is live; the libsignal
ratchet is the remaining v2 work.** What shipped as **F63 v1**:

- **The relay mailbox** (`frontend/app/api/mailbox/route.ts` + client
  `frontend/lib/mailbox.ts` + pure crypto `frontend/lib/mailboxCrypto.ts`,
  property-tested in `tests/mailbox.ts`): sends go OFF-CHAIN first — no
  recipient index, no public timestamp, no fee-payer, nothing in ledger
  history. Sealed sender and fixed-length padding carried over from F32.
- **Signed prekeys (coarse forward secrecy):** recipients publish a
  wallet-signed, rotating x25519 prekey (epoch-monotonic directory); senders
  seal to the prekey, devices delete old prekey secrets. Forward secrecy is
  prekey-granular, NOT per-message — that is v2's double ratchet.
- **The sunset bridge:** the Inbox sends via mailbox whenever the recipient
  has a bundle and falls back to on-chain F32 (labeled as the legacy path in
  the UI) only when they don't. F32 stays read-supported.
- **No enumeration at the relay** (exact-id lookups only, recipient-signed
  deletion, TTL) and **no logging** — same custody rules as the shard layer.

**F103 (2026-08-17) — hybrid post-quantum sealing (ADR 0002 Stage 1).** The
prekey model itself went hybrid: a v2 bundle carries an ML-KEM-768 (FIPS 203)
encapsulation key beside the x25519 SPK, wallet-signed **together** so a
downgrade (stripping or swapping the KEM key) breaks the signature; a v2
envelope seals under SHA-512(x25519-ECDH ‖ ML-KEM shared secret ‖ full public
transcript) via `nacl.secretbox` — confidential if EITHER assumption survives,
which is the PQXDH hybrid principle applied to v1's prekey layer. ML-KEM comes
from the audited `@noble/post-quantum`, never hand-rolled (the ADR's own
rule). Rollout is version-negotiated per recipient bundle (v1 bundles keep
getting v1 envelopes — mail never stops), an SPK without KEM halves forces
rotation at the next enrollment touch, cover traffic mirrors the target's
bundle version so the relay cannot split dummies from real mail by version,
and all request/reply pads grew uniformly (2 KiB → 4 KiB blocks) so ops stay
one size. **Honest transitional caveat** (Sentinel WARNING,
NRR-2026-08-17-f103-hybrid-pq): "uniform" holds per client build — during a
rolling deploy a stale cached client still pads to the old 2 KiB block, so the
relay can tell old-build from new-build requests until caches turn over. That
window reveals client version, not identity or content, and closes on its own;
it is the unavoidable cost of any wire-format change. Forward secrecy still
prekey-granular; deleting an old epoch deletes BOTH its secrets.

What v1(+F103) does NOT deliver (deliberately, per §2.5): X3DH/double-ratchet
per-message forward secrecy and post-compromise healing — that lands with the
libsignal adapter (v2), which ADR 0002 requires to be full PQXDH. F103 closes
the harvest-now-decrypt-later window at the sealing layer now, so v2's ratchet
adds per-message granularity to an already-hybrid base rather than being the
first PQ line of defence. The relay still observes recipient pull patterns and
IPs; batching/PIR remains open.

The rest of this document is the v2 target design, unchanged.

---

## 1. Why the current on-chain design cannot be Epic 7

Epic 7 asks for member-to-member messaging that is E2E encrypted, sealed-sender,
and leaves **no on-chain record of who wrote to whom or when**. Today's messaging
(`frontend/lib/messaging.ts` + the on-chain `Message` account) gets the
*content* and the *sender* right but structurally leaks the rest. The leaks are
in the account shape, not in a bug we can patch:

- **Recipient is a plaintext field.** `state.rs` `Message { recipient: Pubkey, … }`
  (line 614) stores the recipient in the clear, and the PDA is seeded on it:
  `send_message.rs` line 47, `seeds = [b"msg", recipient.as_ref(), &id.to_le_bytes()]`.
  The whole read path depends on it: `listInbox` does
  `memcmp { offset: 8, bytes: me }` (messaging.ts ~line 211). So the recipient of
  every message is not merely derivable — it is the index. Anyone can enumerate
  "how much mail does wallet X receive".
- **Timing is public.** `created_at` is written from the on-chain clock
  (`send_message.rs` line 31) and, even without it, the transaction's slot/blocktime
  timestamps every message. A public ledger records *when* each ciphertext landed.
- **The fee-payer links a message to a wallet.** `send_message.rs` lines 54–55:
  `payer: Signer<'info>` pays rent and signs the tx. Sealed sender keeps the
  sender out of the *account*, but the *transaction* is still signed and paid by
  someone observable on chain. Whoever funds the send is linkable to it.
- **Traffic analysis on a fixed-size, timestamped, recipient-indexed store is
  trivial.** Constant `CT_LEN` padding (good, keep it) removes the length signal,
  but with recipient + time in the clear an observer reconstructs the social
  graph by correlation alone.

None of these are fixable while the message lives in a program account on a
public chain. The recipient *must* be able to find their mail, and on-chain the
only way to "find" is to query a key everyone else can query too. **Off-chain
delivery is the only design that removes the metadata, because the metadata IS
the on-chain storage model.** (`state.rs` lines 608–611 already say as much in a
NOTE — this doc is the plan to act on it.)

What we KEEP from the current design: sealed sender (fresh single-use ephemeral
keypair, sender named+signed inside the ciphertext), fixed-length padding, and
the signature-derived x25519 identity key (`deriveBoxKeypair`) so a user needs
nothing to back up beyond their wallet.

---

## 2. Target cryptographic model: X3DH + double ratchet + sealed sender

The target is the Signal model, adapted to a wallet-derived long-term identity.

### 2.1 Keys
- **Identity key (IK).** The existing signature-derived x25519 keypair
  (`deriveBoxKeypair`, one wallet signature, session-cached). Long-term, wallet-
  recoverable. Never leaves the device; only the public half is ever published.
- **Signed prekey (SPK).** A medium-lived x25519 key, signed by IK, rotated on a
  schedule (e.g. weekly). Its signature lets a sender confirm the SPK belongs to
  the claimed identity.
- **One-time prekeys (OPK).** A pool of single-use x25519 keys. Each is consumed
  by exactly one session initiation, giving the *initiator's first message*
  forward secrecy and resistance to key-compromise replay. The pool is
  replenished from the device.

### 2.2 X3DH (session establishment)
To start a conversation with Bob, Alice fetches Bob's `(IK_B, SPK_B, sig, one OPK_B)`
bundle, generates an ephemeral `EK_A`, and computes the shared secret from the
four DH combinations:
`DH(IK_A, SPK_B) ‖ DH(EK_A, IK_B) ‖ DH(EK_A, SPK_B) ‖ DH(EK_A, OPK_B)`,
hashed into the root key. This authenticates both parties and seeds the ratchet.
The trust list (`trustlist.ts`, F64) is what tells Alice *which* IK she is
willing to open a session with in the first place.

### 2.3 Double ratchet (per-message keys)
Every message advances a symmetric-key ratchet; each DH round-trip advances a DH
ratchet. This gives:
- **Forward secrecy** — a compromise today cannot decrypt yesterday's messages.
- **Post-compromise (future) secrecy** — the next DH round-trip heals the session.

### 2.4 Sealed sender (unchanged in spirit)
The envelope carries the sender's identity *encrypted*, so the delivery service
never learns who sent a message — only the recipient can unseal it. This is the
same principle the current code already applies inside `Message.ciphertext`; in
the target it wraps the ratchet message and is handed to a relay, not a chain.

### 2.5 Reuse Signal, do not re-roll crypto
X3DH + double ratchet are subtle (replay handling, out-of-order messages, header
encryption, skipped-message keys). **Use `libsignal` / `libsignal-client` (the
audited implementation) via its WASM/JS bindings for the ratchet and session
store.** Write only the thin adapters: (a) an IK provider backed by
`deriveBoxKeypair`, and (b) our own prekey directory + transport. Do NOT
hand-implement the ratchet.

---

## 3. Delivery: relay service vs. "libsignal on chain"

The question is *where the ciphertext waits* between send and fetch, and *how the
recipient polls without announcing themselves*.

| Option | Metadata leak | Availability | Verdict |
|---|---|---|---|
| **Keep it on chain (status quo)** | recipient + time + fee-payer all public | permanent, censorship-resistant | fails Epic 7 by construction |
| **Dedicated delivery service (relay)** | relay sees recipient *pull* patterns + IP unless mitigated | depends on the relay staying up | **chosen**, with mitigations |
| **P2P / DHT mailbox** | store nodes see fetch patterns; harder NAT/availability | best-effort | fallback / future, not v1 |

**Decision: a dedicated delivery service (relay), with sealed sender + libsignal
on top, and explicit anti-metadata mitigations.** Rationale: it is the only
option that (a) lets a mostly-offline member receive mail, (b) removes recipient
and timing from a *public* record, and (c) is realistic to operate for a pilot.
"On chain" is disqualified above; P2P is a strong long-term goal but its
availability and NAT-traversal cost make it wrong for v1.

Because a relay is a trust concentration, it must be built to know as little as
possible:

- **Recipient addressing by unlinkable mailbox tags, not by wallet.** A message
  is deposited under a rotating, per-conversation *mailbox tag* derived from the
  shared session secret (an HMAC the sender and recipient both compute), never
  under the recipient's wallet or IK. The relay stores `(tag → sealed blob)` and
  learns no identity from the address.
- **Recipient polls a *set* of tags, ideally blindly.** To avoid the relay
  learning "this IP owns these tags", fetch should batch tags, add cover
  requests, and (target) use a PIR-style or oblivious fetch. v1 may ship simpler
  batched polling and document the residual.
- **No plaintext timestamps; store-and-purge.** The relay timestamps for GC only
  (TTL, mirroring today's `expires_at`) and does not expose ordering beyond what
  the ratchet headers already carry.
- **Transport anonymity is the user's/relay's job, not the crypto's.** IP-level
  linkage (the modern analogue of today's fee-payer leak) is mitigated by running
  the relay behind Tor / a mixnet and never logging source addresses. State this
  honestly: sealed sender hides *who wrote*; it does not by itself hide *which IP
  fetched*.
- **The relay is untrusted for confidentiality and authenticity.** It can delay
  or drop mail (an availability risk, mitigated by multiple relays / retry) but
  can never read it or forge a sender — that is guaranteed by libsignal + sealed
  sender, not by trusting the operator.

---

## 4. The prekey directory must NOT become an enumerable member list

Senders need to fetch a recipient's `(IK, SPK, OPK)` bundle before the first
message. The naive design — a public directory keyed by wallet — would recreate,
maybe even worsen, exactly the leak we are removing: an **enumerable list of
every member who can receive messages**. (Today's `MessagingKey` PDA,
`["msgkey", owner]`, `state.rs` 587–596, is already such an enumerable set; the
migration must not carry that property forward.)

Constraints on the directory:

- **Not enumerable / not scannable.** No "list all bundles" and no way to confirm
  membership of an address you do not already know. A lookup should require
  *already possessing* the recipient's identity handle (out-of-band, or via the
  trust list), not discover it.
- **Lookup by blinded handle.** Index bundles under `H(IK ‖ salt)` (or an
  OPRF/PIR lookup) so the directory returns a bundle to someone who already knows
  the identity but reveals nothing to a scanner probing addresses.
- **Introductions come through the trust relationship, not the directory.** You
  learn *whom to message* from an out-of-band exchange or an in-app introduction
  that both sides consent to — mirrored into `trustlist.ts` — not by browsing a
  roster. The directory only answers "give me the bundle for this identity I
  already hold".
- **OPK exhaustion is a liveness, not a privacy, matter.** If a recipient's OPK
  pool is empty, fall back to SPK-only X3DH (documented weaker first-message
  property) rather than leaking that the pool was probed.

This is the single most dangerous corner of the migration: get the directory
wrong and the off-chain design leaks the very member list the on-chain design was
criticised for.

---

## 5. Phased F32-sunset plan

The current on-chain path stays usable until the off-chain path is proven; we do
not rip out working messaging. Each phase is independently shippable.

- **Phase 0 — foundations (partly done).**
  - `trustlist.ts` (F64): client-side, encrypted trust list. **Done.**
  - This design doc (F63). **Done.**
  - Keep F32 exactly as-is; add a UI note that the recipient + timing are public
    (the code and `state.rs` already document it).

- **Phase 1 — off-chain transport skeleton, no ratchet.**
  - Stand up the relay (deposit `tag → sealed blob`, TTL GC, no source logging).
  - Sealed-sender envelope reused from F32, delivered via relay instead of chain.
  - Mailbox tags derived from a static shared secret (IK-to-IK DH) — interim,
    pre-ratchet. Recipient + timing now off the public chain.
  - Prekey directory v0: blinded-handle lookup, non-enumerable, SPK only.

- **Phase 2 — libsignal integration.**
  - Replace the interim envelope with libsignal X3DH + double ratchet (IK from
    `deriveBoxKeypair`, SPK/OPK managed on device).
  - OPK pool + replenishment; per-conversation rotating mailbox tags.
  - Forward secrecy + post-compromise secrecy now hold.

- **Phase 3 — metadata hardening.**
  - Batched/cover-traffic or PIR-style blind fetch; relay behind Tor/mixnet.
  - Multiple relays for availability; retry/failover.
  - PIR or OPRF prekey lookup to close residual directory probing.

- **Phase 4 — F32 sunset.**
  - Default new conversations to the off-chain path; mark on-chain send
    deprecated in the UI.
  - Read-only migration window: keep `listInbox`/`decryptMessage` so existing
    on-chain messages remain openable; disable `sendMessage` (on-chain) once
    adoption is sufficient.
  - Eventually stop indexing `Message` accounts; existing ones expire via
    `expires_at` and can be closed for rent (`deleteMessage` already exists).
  - Retire (or leave dormant) `MessagingKey` publication in favour of the
    non-enumerable prekey directory.

## 6. Honest scope statement

Built today: the encrypted client trust list and this plan. **Not** built: the
relay, the prekey directory, the libsignal integration, the ratchet, and every
metadata mitigation in Phase 3. Those are the large remaining work and require a
real off-chain service plus an audited libsignal binding — neither of which can
be faked inside the current on-chain codebase without recreating the leaks this
migration exists to remove.
