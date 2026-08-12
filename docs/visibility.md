# Visibility, ownership and the encrypted read path

Epic 5 (per-element visibility), F60 Phase-2, F61.

This document covers two things that turned out to be the same problem: who can
see a member's bio and avatar, and who can see that a person is a member at all.
The second was the worse leak, and it had nothing to do with the visibility
policy — it was in the shape of the `Membership` account.

## 1. The roster leak, and what closed it

### What was wrong

`Membership` stores an optional controlling wallet in `owner`, at byte offset 89
(8 discriminator + 32 circle + 32 commitment + 8 issued_at + 8 expires_at + 1
level). Solana RPC nodes serve `getProgramAccounts` with `memcmp` filters. So:

```
getProgramAccounts(AHA program, filters=[memcmp(offset=89, bytes=<any wallet>)])
```

returned every Circle that wallet belonged to. No key, no permission, no
relationship to the member, no rate limit worth the name. Point it at a wallet
you saw in a donation, a post, or a block explorer and you have that person's
membership list — the roster Epic 2 and Epic 5 exist to keep unpublished. For a
recovery fellowship this is the whole ballgame; the commitment-based anonymity
everywhere else in the program was undone by one convenience field.

It was there for a reason: `findMyMemberships` in `frontend/lib/member.ts` used
exactly that filter to answer "which memberships are mine?". `owner` was doing
two unrelated jobs — **authorising** the member's writes, and **indexing** the
member's own memberships — and the second job is what made it scannable.

### The fix: split the two jobs

**Indexing moves to `OwnerTag`** (`programs/ayni/src/state.rs`), a PDA whose
*address* is the index key:

```
tag  = SHA-256("aha-owner-tag-v1" ‖ viewing_secret ‖ circle ‖ u32le(index))
PDA  = ["mownr", tag]         →  { membership: Pubkey, bump: u8 }
```

There is no field to filter on, so there is nothing to enumerate. Computing the
address needs the member's viewing secret; going the other way needs to invert
SHA-256. Two tags belonging to the same member are unrelated values, so the
accounts cannot even be grouped by person.

**Authorisation stays on `owner`**, but the value changes. `shield_membership`
rebinds it to a key derived from the member's own master secret:

```
seed = SHA-256("aha-owner-key-v1" ‖ viewing_secret ‖ circle ‖ u32le(index))
owner = ed25519_from_seed(seed).public
```

The member can always re-derive it (the master secret is the credential of
record, and recovery reconstructs it bit-identically — CLAUDE.md), it never
appears anywhere else, and nobody can connect it to the wallet the person is
known by. Passing `Pubkey::default()` instead goes further — no key at all — but
the program refuses that unless a guardian remains, so shielding can never
strand a membership.

Both happen in **one instruction** deliberately. Split across two transactions
there is a window where the tag exists and the public wallet is still bound,
which hands an observer precisely the correlation the change removes.

The viewing secret itself is `SHA-256("aha-owner-view-v1" ‖ master)` — domain
separated from `walletSeed` and `zkSecretForCircle` in `lib/sharding.ts`, never
stored anywhere but a device-local cache, never shared, never in a shard.

### Before and after, exactly

| An observer with an RPC endpoint and a wallet address | Before | After shielding |
| --- | --- | --- |
| List that wallet's memberships (`memcmp` on `owner`) | **yes** | no — the wallet is not in the account |
| List all memberships, with circle + commitment + dates | yes | yes (unchanged; commitments are pseudonymous by design) |
| Group memberships by owner (same `owner` value across Circles) | yes | no — each Circle gets an unrelated derived key |
| Tell that a membership has been shielded | n/a | **yes** — an `OwnerTag` exists pointing at it |
| Count shielded memberships in the system | n/a | **yes** |
| Learn which wallet a shielded membership belongs to, from account state | yes | no |
| Learn which wallet a shielded membership belongs to, from **transaction history** | yes | **partly — see below** |

### What is honestly still inferable

1. **Transaction history is not account state.** Any transaction where the
   member's ordinary wallet pays the fee for a shielded membership's write puts
   the wallet and the shielded key in the same transaction, permanently. Passive
   whole-roster scanning is what this change kills; the transaction graph closes
   only when fees are paid by a relayer (`frontend/lib/relayer.ts`) or by the
   shielded key itself. **The shield transaction is itself an example**: it is
   signed by the wallet being unbound. An observer who indexes transactions,
   rather than scanning accounts, can still follow that edge.
2. **Shielded-ness is public.** The existence of an `OwnerTag`, and the count of
   them, is readable. It says nothing about who, but a member in a system where
   almost nobody has shielded is slightly conspicuous — an argument for making
   shielding the default at issuance, not a per-member choice (see §4).
3. **Unshielded memberships are exactly as enumerable as before.** Nothing was
   retro-fixed on chain. See the migration below.
4. **The rest of `Membership` is unchanged**: `circle`, `commitment`,
   `issued_at`, `expires_at`, `level`, `recovery_keys` and `require_cosign` are
   all still readable and filterable. `recovery_keys` in particular is a pubkey
   at a fixed offset — a guardian wallet is enumerable the same way `owner` used
   to be. **That is not fixed here** and remains open.

## 2. Migration

No account layout changed. `Membership` is byte-identical to what it was, so
every existing account keeps deserialising and no data migration is needed or
possible to get wrong. What changes is the *value* in `owner`, per membership,
when its member chooses to shield.

**Forward path (implemented).**

1. The member's device derives the viewing secret from the master secret.
2. `shieldMembership()` (`frontend/lib/visibility.ts`) sends
   `shield_membership(tag, shielded_owner)`, signed by the current owner wallet.
3. From then on `findMyMemberships` resolves that membership through the tag,
   and later writes for it are signed by `shieldedSigner()`.

**Backward compatibility (implemented).** `findMyMemberships` runs both paths and
unions the results: derived-address lookups for shielded memberships, plus the
legacy `memcmp` on `owner` for the rest. A member who never shields notices
nothing. A member who shields everything stops appearing in the legacy query
entirely.

**What the member must know before shielding.** After shielding, the membership
answers to the derived key, not to their wallet. Any write path that assumes
`owner == connected wallet` needs the derived signer added. As of this round
`publishProfile()` and `grantElementKeys()` take one; **`createPost` and the
other member-signed instructions in the frontend do not yet**, so a member who
shields today loses the ability to post from the UI until those call sites are
updated. That is a deliberate, stated limitation of this round, not an oversight
— see §4.

**The derived key never needs a balance, and this is load-bearing.**
`shield_membership` and `upsert_member_profile` both separate the **authority**
account from the **rent payer** account: the derived key signs, and any funded
wallet (or a relayer) pays. The first cut of this round got that wrong — it had
`payer = member`, which meant the derived key had to hold SOL, and the only
practical way to give it SOL is a single-hop transfer from a wallet the member is
already known by. That transfer is the *funding-source heuristic*, one of the
most reliable clustering techniques in real chain analysis, and it would have
been a **stronger** link than the co-signature caveat below — silently undoing
the property this whole mechanism exists to provide. Caught by Sentinel
(`reports/sentinel/NRR-2026-08-12-f60-f61-maci.md`, Regression 2, CRITICAL) and
fixed; `tests/epic5.ts` now asserts the shielded key's balance is still zero
after it has authorised every write in the suite.

## 3. The encrypted read path (F60 Phase-2)

Before this round, per-tier visibility was a rendering decision: `mayView()` in
the viewer's own browser. There was nothing else it could be, because there was
no serving layer at all — `frontend/lib/profile.ts` kept the avatar in
`localStorage`, so "never public by default" held only vacuously.

Now there is a serving layer, and it serves ciphertext.

```
MemberProfile   PDA ["mprofile", circle, commitment]
  enc_pub    X25519 public key, derived from the member's viewing secret
  epoch      key generation
  bio_ct     ALWAYS 200 bytes: nonce(24) ‖ secretbox(160-byte padded bio)
  avatar_ref 64 bytes: padded pointer to the avatar ciphertext, or zeroes
```

Element keys are per member, per element, per epoch:

```
K = SHA-256("aha-vis-elem-v1" ‖ viewing_secret ‖ circle ‖ commitment ‖ element ‖ u16le(epoch))
```

**Fixed length is the invariant.** A member with no bio stores 200 random bytes
(`opaqueBio()`). "Wrote nothing" and "wrote something you may not read" are the
same account, the same size, the same entropy. If `bio_ct` ever became
variable-length or optional, the length would become the disclosure and hidden
would stop being indistinguishable from absent.

### Key distribution without publishing the audience graph

The obvious design — an account per (owner, permitted viewer) — is exactly the
interest graph Epic 5 forbids. So the drop is addressed by a Diffie–Hellman
secret and names nobody:

```
shared  = X25519(owner_profile_secret, viewer_profile_public)
drop_id = SHA-256("aha-vis-drop-v1" ‖ shared ‖ owner_commitment ‖ u16le(epoch))
PDA     = ["vdrop", drop_id]  →  { sealed: [u8; 104], epoch: u16, bump: u8 }
sealed  = nonce ‖ secretbox(bio_key ‖ avatar_key, SHA-256("aha-vis-wrap-v1" ‖ shared))
```

Read every drop that exists and you have a pile of indistinguishable 104-byte
blobs. No granter, no recipient, no membership, **no authority field** — an
authority would be a memcmp handle on the granter, and the audience sizes
derived from it would be the graph itself. An element the viewer is not entitled
to travels as 32 zero bytes, so a partial grant and a full grant are the same
size.

`grant_visibility_key` takes **no membership account and requires no member
signature**, also deliberately: requiring one would put the granter's membership
into every grant transaction and publish "this membership granted access N
times" in the transaction log. It is safe to leave open because a drop is only
ever *looked up* at an address derived from a shared secret — a stranger cannot
compute an address anyone will read, and a forged drop at an address they can
compute would have to contain a key they do not know.

**Revocation is re-keying.** There is no revoke instruction and no close: the
member bumps `epoch`, which changes every element key and every drop address at
once, stranding the whole previous generation. Nothing named anybody on the way
in and nothing names anybody on the way out. `epoch` may only move forward, so a
rollback cannot resurrect stranded drops.

### What the read path does

`getTrustPage()` calls `openMemberProfile()`, which tries to decrypt and returns
what opened. There is no "may I?" step and `mayView` is not consulted for bio or
avatar: **possession of the key is the decision**. Three cases collapse to one
outcome — no profile published, nothing written, or not in the audience all
return `{}`, and the page renders the same bare card in every case. The member
page shows the served avatar in place of the identicon when it opens, and the
bio as an unlabelled line when it opens; when they do not open there is no
heading, no gap, no lock and no placeholder.

### Honest limits of the encrypted path

- **Granting is O(audience).** One drop, one transaction, one rent payment per
  viewer. That is fine for "chosen ones" and workable for a small Circle; it
  does not scale to "all members". The scalable form — release a tier key
  against a ZK circle-membership proof, inheriting Epic 2's machinery — is still
  Phase 3. The tier in `VisibilityPolicy` is therefore the member's *stated
  intent*, enforced by whom they grant to.
- **A viewer must have published a profile** (specifically an `enc_pub`) before
  anyone can seal a key to them.
- **The avatar ciphertext has nowhere to live yet.** `avatar_ref` is wired end to
  end and the read path fetches and decrypts it, but the repo has no upload path
  (`lib/ipfs.ts` is gateway-read-only), so in practice `avatar_ref` is zeroes
  today. The ciphertext must never be written to a public gateway in the clear —
  the field points at ciphertext, always.
- **The quipu is not encrypted and this is not claimed.** `QuipuCord` accounts
  are unencrypted on chain and world-readable by anyone reading the ledger
  directly; `mayView` gates the render only. Encrypting the quipu means moving
  cords off chain, which is a different feature.
- **The chosen-ones list stays client-side.** It never touches the chain, which
  is the point; it is also therefore not backed up.

## 4. Not done in this round

- **Shielding is opt-in and no UI exposes it yet.** The library and the
  instruction are in place; making it the default at issuance (pass the derived
  key as `owner` in `issue_membership`, so a membership is never bound to a
  public wallet in the first place) is the right end state and is not done.
- **Frontend write paths do not carry the shielded signer** (`createPost`,
  `tie_quipu_cord`, `set_visibility`, wing peers, attestations). Until they do,
  shielding costs a member those actions from the UI.
- **`recovery_keys` are still enumerable** by the same memcmp attack `owner`
  had. Same fix applies; not done.
- **Fee payment is not relayed**, so the transaction graph still links a wallet
  to the memberships it acts for. The separate `payer` account added this round
  is the seam a relayer slots into with no program change — but no relayer is
  wired to it yet.
- **`tag` and `drop_id` are unbound instruction arguments.** `OwnerTag` and
  `VisibilityKeyDrop` are `init`-only (never overwritten), but nothing binds the
  seed to the caller's own secret, so an observer who sees a pending
  `shield_membership` or `grant_visibility_key` and front-runs it with the same
  seed and junk data makes the legitimate `init` fail. That is griefing — a
  forced retry at the next index or epoch — not a data or privacy compromise.
  Untested and unfixed (Sentinel, same report).
- **`/board`** now renders nothing to an unconnected visitor and issues no post
  query; other public surfaces have not been re-audited in this round.

## Where the code is

| Piece | File |
| --- | --- |
| `OwnerTag`, `MemberProfile`, `VisibilityKeyDrop` | `programs/ayni/src/state.rs` |
| `shield_membership` | `programs/ayni/src/instructions/shield_membership.rs` |
| `upsert_member_profile` | `programs/ayni/src/instructions/upsert_member_profile.rs` |
| `grant_visibility_key` | `programs/ayni/src/instructions/grant_visibility_key.rs` |
| Derivations, sealing, opening (no chain imports) | `frontend/lib/visibilityCrypto.ts` |
| Shield / publish / grant / open, policy client | `frontend/lib/visibility.ts` |
| Two-path membership discovery | `frontend/lib/member.ts` (`findMyMemberships`) |
| Read path | `frontend/lib/trustpage.ts`, `frontend/app/member/[commitment]/page.tsx` |
| Unconnected-visitor gate | `frontend/app/board/page.tsx` |
| Tests | `tests/epic5.ts` |
