# ADR 0003 — No phone-number registration

## Status

**Accepted** (ratifying a de-facto decision).

## Context

Some 12-step onboarding designs, and an early sketch of this one, assumed a
phone number for Sybil resistance or account recovery. That path was silently
dropped: the shipped system authenticates **only** by wallet signature.

Verified against the repo: there is **no phone, SMS, OTP, or Twilio path** in
the program or the client crypto/auth libraries. (`grep` for
`phone|sms|otp|twilio` across `programs/` and `frontend/lib/` returns only
unrelated matches — `NotParrain` error strings and a comment noting a passkey is
backed by *the phone's own biometric*, i.e. the device, not a phone number.)

A phone number is a strong deanonymizer: it ties a real legal identity, a
carrier record, and often a location to a fellowship membership. That is
categorically incompatible with an anonymous-by-design fellowship.

## Decision

**Ayni will never require, collect, or verify a phone number** — not for
registration, not for Sybil resistance, not for recovery. Sybil resistance comes
from the two-sponsor / attestation model (E1/E2) and ZK membership proofs;
recovery comes from wallet and passkey-wrapped local keystore mechanisms
(E8), never from an SMS reset.

## Consequences

- Onboarding cannot lean on "an SMS code proves you are a unique human." That
  work is carried by social vouching + ZK (see ADR 0004).
- No carrier metadata, no phone directory, nothing to subpoena or leak.
- Any future proposal to add phone verification must reopen **this ADR**; it is
  not a routine feature addition.
