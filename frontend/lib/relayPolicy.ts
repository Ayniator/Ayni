// F55 — relayer admission policy (pure; no DOM, no network, no chain).
//
// The relayer (`/api/relay`) signs and pays for OTHER people's transactions so
// that anonymous actions — a ZK ballot, an anonymous attestation, a sealed
// message, a visit proof — are not deanonymized by their fee-payer. That makes
// it a machine that signs attacker-supplied bytes with a funded key, so the
// policy is a strict allowlist, validated here in one pure module the tests
// exercise directly:
//
//   * only known instructions of the Ayni program (8-byte Anchor
//     discriminators, pinned below and asserted against the IDL in
//     tests/relayer.ts);
//   * only instructions whose ONLY signer is the fee-payer — the relayer never
//     co-signs anything (no seat votes, no membership issuance, nothing where
//     a signature means authority; here it means only "paid the rent");
//   * the payer account must sit at the instruction's known payer index and be
//     the relayer's own key;
//   * account count and data length must match the instruction exactly (all
//     allowlisted instructions have fixed-size arguments).
//
// Everything else is refused before a single lamport moves. The route adds
// rate limiting and a spend floor on top; this module is the part that decides
// WHAT may be relayed at all.
//
// ACCEPTED, BOUNDED RESIDUAL (ultracode 2026-08-11b): the policy validates the
// SHAPE of an allowlisted instruction, not its CONTENT — it cannot, because the
// point of relaying is that the relayer never sees who is acting or what a
// sealed payload says. So an attacker can make the relayer pay rent for e.g.
// arbitrary `send_message` accounts (spam/drain). This is inherent to a
// fee-paying relay and is bounded, not eliminated, by the route's per-IP rate
// limit, daily transaction cap, and balance floor — a relayer is opt-in Circle
// infrastructure with a spend budget, not a free-money faucet. Timing/IP
// mixing to blunt the remaining correlation channel is the documented next
// step (docs/messaging-migration.md §3).

export interface RelayAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface RelayRequest {
  /** Account metas in instruction order (pubkeys base58). */
  keys: RelayAccountMeta[];
  /** Instruction data, base64. */
  data: string;
}

interface AllowedIx {
  name: string;
  /** Position of the fee-payer (the only permitted signer). */
  payerIndex: number;
  /** Exact number of account metas. */
  accountCount: number;
  /** Exact instruction-data length (discriminator + fixed-size args). */
  dataLen: number;
}

/** Anchor discriminator (hex) → allowed instruction. */
export const RELAY_ALLOWLIST: Record<string, AllowedIx> = {
  // cast_vote(choice, nullifier, proof_a, proof_b, proof_c)
  "14d40fbd45b44597": { name: "cast_vote", payerIndex: 2, accountCount: 4, dataLen: 8 + 1 + 32 + 64 + 128 + 64 },
  // attest_admission_zk(newcomer, root, nullifier, proofs)
  "10a45cd6d203ed97": { name: "attest_admission_zk", payerIndex: 5, accountCount: 7, dataLen: 8 + 32 + 32 + 32 + 64 + 128 + 64 },
  // activate_faucet_zk(root, nullifier, proofs) — F35's anonymous first-gas
  // path. Relaying it is the point: the ZK proof hides WHICH member endorsed
  // the grant, and a self-paid fee would hand that back by naming a wallet at
  // the exact moment of the endorsement. The relayer pays the `faucetnull`
  // rent (~0.00089 SOL) and the fee; the grant itself comes out of the Circle's
  // own jar, never the relayer, so this cannot be turned into a free-money tap
  // — and the jar pays at most one uniform grant per membership, ever.
  "297c242a39a3760e": { name: "activate_faucet_zk", payerIndex: 8, accountCount: 10, dataLen: 8 + 32 + 32 + 64 + 128 + 64 },
  // MACI sign-up (F39), a commit–reveal pair. Relaying is the whole point, for
  // the same reason as activate_faucet_zk: the sign-up proof establishes "a
  // member of this Circle joined this round" WITHOUT naming which one, and a
  // self-paid fee would hand that straight back by putting the member's wallet
  // on the transaction at the exact moment they enrol. Without these entries
  // the client detects the gap and self-pays — correct behaviour, but it means
  // an un-allowlisted relayer silently de-anonymises every sign-up.
  //
  // Discriminators verified two ways: sha256("global:<name>")[0..8] computed
  // independently, and cross-checked against the generated IDL, which also
  // confirms the account counts (5 and 8).
  "bb1e1edef153e84e": { name: "maci_signup_commit", payerIndex: 3, accountCount: 5, dataLen: 8 + 32 },
  "145fa611785ffa3a": { name: "maci_signup", payerIndex: 6, accountCount: 8, dataLen: 8 + 32 + 32 + 64 + 128 + 64 },
  // send_message(id, recipient, eph_pubkey, nonce, expires_at, ciphertext[528])
  "392822b2bd0a411a": { name: "send_message", payerIndex: 1, accountCount: 3, dataLen: 8 + 8 + 32 + 32 + 24 + 8 + 4 + 528 },
  // publish_maci_message(eph_pubkey, ciphertext[176])
  "d2363222771eac1f": { name: "publish_maci_message", payerIndex: 2, accountCount: 4, dataLen: 8 + 32 + 4 + 176 },
  // note_root()
  "26f0779c6009c069": { name: "note_root", payerIndex: 3, accountCount: 5, dataLen: 8 },
  // reinsert_member(epoch)
  "4c1e6e44b8f12854": { name: "reinsert_member", payerIndex: 6, accountCount: 8, dataLen: 8 + 8 },
  // publish_member_root() — caller is account index 6 (after the fedchild gate)
  "291472b35f621d9a": { name: "publish_member_root", payerIndex: 6, accountCount: 8, dataLen: 8 },
  // verify_fellow_member(nullifier, proofs)
  "48a626c4f1542b52": { name: "verify_fellow_member", payerIndex: 5, accountCount: 7, dataLen: 8 + 32 + 64 + 128 + 64 },
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type RelayVerdict = { ok: true; name: string } | { ok: false; reason: string };

/** Decide whether `req` may be relayed with `relayerPubkey` as fee-payer. */
export function validateRelayRequest(req: RelayRequest, relayerPubkey: string): RelayVerdict {
  if (!req || !Array.isArray(req.keys) || typeof req.data !== "string") {
    return { ok: false, reason: "malformed request" };
  }
  let data: Buffer;
  try {
    data = Buffer.from(req.data, "base64");
  } catch {
    return { ok: false, reason: "data is not base64" };
  }
  if (data.length < 8) return { ok: false, reason: "data shorter than a discriminator" };

  const disc = data.subarray(0, 8).toString("hex");
  const allowed = RELAY_ALLOWLIST[disc];
  if (!allowed) return { ok: false, reason: "instruction not allowlisted" };
  if (data.length !== allowed.dataLen) {
    return { ok: false, reason: `${allowed.name}: unexpected data length` };
  }
  if (req.keys.length !== allowed.accountCount) {
    return { ok: false, reason: `${allowed.name}: unexpected account count` };
  }
  for (let i = 0; i < req.keys.length; i++) {
    const k = req.keys[i];
    if (!k || typeof k.pubkey !== "string" || !BASE58.test(k.pubkey)) {
      return { ok: false, reason: `account ${i}: invalid pubkey` };
    }
    if (typeof k.isSigner !== "boolean" || typeof k.isWritable !== "boolean") {
      return { ok: false, reason: `account ${i}: malformed meta` };
    }
    if (i === allowed.payerIndex) {
      if (!k.isSigner) return { ok: false, reason: `${allowed.name}: payer must sign` };
      if (k.pubkey !== relayerPubkey) {
        return { ok: false, reason: `${allowed.name}: payer is not the relayer` };
      }
    } else if (k.isSigner) {
      // The relayer never co-signs and never relays something needing another
      // party's live signature — those flows are not anonymous anyway.
      return { ok: false, reason: `${allowed.name}: unexpected extra signer` };
    }
  }
  return { ok: true, name: allowed.name };
}
