# Ayni — passkey unlock (Epic 8 · F65)

A passkey here is a **device-local unlock**, not an identity. It lets the phone
or laptop's own biometric (fingerprint / face / device PIN) stand in front of a
locally-encrypted keystore, so the member's zk secret doesn't sit in the clear.

Client: `frontend/lib/passkey.ts`. Nothing in this feature touches the chain.

---

## 1. The model — attestation, not biometrics

WebAuthn verifies the biometric **inside the authenticator's secure element**.
JavaScript — and therefore we, and therefore Solana — only ever receives a
**cryptographic assertion**: a credentialId and a signature / PRF output. The
fingerprint or face template never leaves the device, is never read by our code,
and is never transmitted.

> **Sentinel assertion — "no biometric leaves the device."** `passkey.ts` calls
> only `navigator.credentials.create/get`. It never reads biometric bytes and
> never sends anything anywhere. This is the invariant Sentinel should check.

## 2. What the keystore holds

- `registerPasskey(label)` creates a **platform** credential (built-in
  authenticator, `residentKey: required`, `userVerification: required`) and
  remembers its `credentialId` locally. No attestation is requested — we do not
  want to fingerprint the authenticator make/model.
- `unlockWithPasskey()` runs an assertion and returns a 32-byte symmetric
  **wrapping key**.
- `putKeystore(secret)` / `getKeystore()` encrypt / decrypt a small blob with
  `nacl.secretbox` under that key, in `localStorage`. The blob holds the
  member's **device-local identity material** — e.g. the zk `secret` behind their
  `identity_commitment` (see `docs/zk-lineage.md`). The plaintext secret never
  touches disk.

### Deriving the key — PRF, and the honest fallback

- **With the PRF extension** (`prf: { eval: { first: <fixed salt> } }`): the
  wrapping key is derived from the PRF output, which depends only on
  *(credential, salt)* — not on the per-assertion challenge — so it is **stable
  across unlocks and never stored**. This is the real path on modern platforms.
- **Without PRF** (older authenticators): a raw WebAuthn **assertion signature is
  useless as a KDF input** — ECDSA signatures are randomised (fresh `k` each
  call), so the same challenge signs to different bytes and could never decrypt
  what it encrypted. We do **not** fake determinism. The fallback stores a random
  wrap key locally and uses the passkey purely as a **presence / user-verification
  gate** in front of it. Still device-local, still no biometric exposure — but
  **weaker**, because the key rests in `localStorage`.

## 3. What a passkey is deliberately NOT

The passkey is **never the credential of record** and **never gates recovery on
its own**. Losing the device must not lose the identity. A passkey unlock failing
means "re-derive from the wallet", not "account lost".

---

## 4. Deferred: sponsor-bound social recovery (F66)

> **Honest status: not built.** "Recover through my two sponsors" is the missing
> piece and belongs with **Epic 11's shard model**, not here.

The intended shape, and the constraint that makes it non-trivial:

- The keystore secret is split (e.g. Shamir 2-of-N) into **shards** entrusted to
  the member's sponsors, so two sponsors can jointly help the member re-encrypt a
  fresh device keystore after losing a phone.
- **Raw sponsor pubkeys must NOT be published.** Epic 2 (E2) forbids revealing
  the sponsor edge — publishing "these two wallets are my sponsors" would leak
  exactly the lineage relationship the anonymous-vouch design protects. Recovery
  must therefore address sponsors through **blinded keys** (a per-member blinding
  factor over the sponsor's key), so shards route to the right people without the
  graph edge ever appearing on-chain or in any published index.

Because that blinding + shard-distribution scheme is Epic 11 work, F66 is
**deferred**. F65 ships only the device-local unlock above.
