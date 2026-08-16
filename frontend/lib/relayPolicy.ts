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
//   * only instructions whose signers are (a) the fee-payer, which is always the
//     relayer, and (b) at most ONE further account, at an index pinned per
//     instruction (`authorityIndex`). The RELAYER still never co-signs anything
//     — no seat votes, no membership issuance, nothing where a signature means
//     authority; its signature means only "paid the rent". The second slot
//     exists for F61: a shielded membership's authority is a derived key with
//     zero lamports which must never be funded, so it has to be able to sign
//     while somebody else pays. Instructions without an `authorityIndex` keep
//     the original sole-signer rule exactly;
//   * the payer account must sit at the instruction's known payer index and be
//     the relayer's own key;
//   * account count must match the instruction exactly, and data length must
//     match exactly — except for `create_post`, the one entry with borsh
//     strings, which is bounded by the program's own field maxima instead.
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
  /**
   * F61 — the co-signer's signature, present only for instructions the
   * allowlist gives an `authorityIndex`. The client picks the blockhash,
   * builds the transaction with the relayer as fee-payer, signs it with the
   * derived key and sends the signature here; the route rebuilds the identical
   * message and adds its own signature. Nothing secret travels.
   */
  authority?: {
    /** Must equal `keys[authorityIndex].pubkey`. */
    pubkey: string;
    /** ed25519 signature over the compiled message, base64. */
    signature: string;
    /** The blockhash the client signed over. */
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

export interface AllowedIx {
  name: string;
  /**
   * Position of the fee-payer in the account metas, or `null` when the
   * instruction takes no payer account at all and the relayer is the
   * transaction fee-payer only (it must then appear in NO meta — see
   * `end_wing_peer`).
   */
  payerIndex: number | null;
  /** Exact number of account metas. */
  accountCount: number;
  /** Exact instruction-data length, or an inclusive [min, max] for the one
   *  instruction with variable-length arguments (`create_post`'s strings). */
  dataLen: number | [number, number];
  /**
   * F61 — position of the ONE permitted non-relayer signer, or undefined when
   * the relayer must be the sole signer (the original rule, unchanged for every
   * instruction that had it).
   *
   * WHY THIS EXISTS, and why it does not weaken the boundary. The original rule
   * was "the relayer never co-signs anything ... nothing where a signature means
   * authority". That rule is about the RELAYER's signature, and it still holds
   * absolutely: the relayer's key is never at `authorityIndex`, and its
   * signature can still only ever mean "paid the fee". What changes is that
   * SOMEBODY ELSE may sign in one pinned slot — and for F61 that somebody is a
   * key derived from the member's master secret which, by construction, has zero
   * lamports and must never be funded (funding it from the member's known wallet
   * is a single-hop transfer, the strongest chain-analysis link there is, and
   * would defeat the whole mechanism). Without this, a shielded member can act
   * only by paying with the wallet they were shielding away from.
   *
   * The residual is the same one already accepted for `send_message`: the
   * relayer pays rent for accounts it cannot inspect. It is *smaller* here,
   * because every co-signed instruction below is authorised on chain against a
   * `Membership` — a request from a key the program does not recognise fails
   * preflight and never reaches the ledger, so it burns no rent.
   */
  authorityIndex?: number;
  /**
   * F59 — compute units the relayed transaction needs above the 200k default.
   * When set, the route prepends a ComputeBudget SetComputeUnitLimit for
   * exactly this figure. Declared HERE, per instruction, rather than accepted
   * from the client: a caller-chosen limit is a knob for making the relayer
   * pay for heavier transactions than the allowlist reviewed.
   */
  computeUnits?: number;
}

/** Anchor discriminator (hex) → allowed instruction. */
export const RELAY_ALLOWLIST: Record<string, AllowedIx> = {
  // cast_vote(choice, nullifier, proof_a, proof_b, proof_c)
  "14d40fbd45b44597": { name: "cast_vote", payerIndex: 2, accountCount: 4, dataLen: 8 + 1 + 32 + 64 + 128 + 64 },
  // attest_admission_zk(newcomer, root, nullifier, proofs)
  "10a45cd6d203ed97": { name: "attest_admission_zk", payerIndex: 5, accountCount: 7, dataLen: 8 + 32 + 32 + 32 + 64 + 128 + 64 },

  // F59 — attest_presence_zk(subject_commitment, month, witness_root, 2 nullifiers, 2 proofs).
  // TWO Groth16 verifications do not fit the 200k default; the docs/presence.md
  // design REQUIRES the relayer (a self-paying wallet links itself to the
  // attestation's timing), which is why this carries a computeUnits declaration
  // rather than asking clients to prepend their own budget instruction.
  // Accounts: circle, member_tree, recent_roots(optional slot), presence, payer, system.
  "e03288b8bff02607": {
    name: "attest_presence_zk", payerIndex: 4, accountCount: 6,
    dataLen: 8 + 32 + 4 + 32 + 32 + 32 + (64 + 128 + 64) * 2,
    computeUnits: 600_000,
  },
  // F59 — clear_presence(subject_commitment, nullifier, proof). One verification
  // fits the default budget; rent from the closed record refunds to the payer,
  // i.e. the relayer — the member's wallet must appear nowhere near an erasure.
  "3f8285671a9e3447": { name: "clear_presence", payerIndex: 2, accountCount: 4, dataLen: 8 + 32 + 32 + 64 + 128 + 64 },
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

  // grant_visibility_key(drop_id, sealed, epoch) — F60 Phase-2. Needs no member
  // signature at all by design (an authority field would be a memcmp handle on
  // the granter, and the audience sizes derived from it would be the interest
  // graph Epic 5 forbids), so it is a sole-signer entry like the ones above.
  // Relaying it removes the last thing that named the granter: the fee-payer.
  "405770eaf0da8a5a": { name: "grant_visibility_key", payerIndex: 1, accountCount: 3, dataLen: 8 + 32 + 104 + 2 },

  // ---------------------------------------------------------------------
  // F61 — the shielded member's write paths. ONE co-signer each, at the
  // pinned index: the key derived from the member's master secret, which
  // holds nothing and must never be funded. The relayer pays; the derived
  // key authorises. Together these are what make shielding survivable —
  // without them a shielded member either cannot act or must pay from the
  // very wallet the shield exists to detach.
  //
  // Discriminators verified TWO ways, as the entries above are: computed
  // independently as sha256("global:<name>")[0..8], and cross-checked
  // against the generated IDL — which also pins the account counts and the
  // signer positions below (asserted in tests/relayer.ts).
  // ---------------------------------------------------------------------

  // shield_membership(tag, shielded_owner) — accounts:
  //   0 membership · 1 owner_tag · 2 member(sig) · 3 payer(sig,w) · 4 system
  // The co-signer here is the member's ORDINARY WALLET (only the current owner
  // may shield). Relaying does not hide that — nothing can, see docs — but it
  // means a member with an empty wallet can still shield.
  "4ab2b47e0bba603c": { name: "shield_membership", payerIndex: 3, accountCount: 5, dataLen: 8 + 32 + 32, authorityIndex: 2 },

  // upsert_member_profile(enc_pub, epoch, bio_ct[200], avatar_ref[64]) —
  //   0 circle · 1 member_membership · 2 profile · 3 member(sig) · 4 payer(sig,w) · 5 system
  "14c4ffb1f4680f36": { name: "upsert_member_profile", payerIndex: 4, accountCount: 6, dataLen: 8 + 32 + 2 + 200 + 64, authorityIndex: 3 },

  // set_visibility(avatar, quipu, bio) —
  //   0 circle · 1 member_membership · 2 policy · 3 member(sig) · 4 payer(sig,w) · 5 system
  "b61749a6ffea24c4": { name: "set_visibility", payerIndex: 4, accountCount: 6, dataLen: 8 + 1 + 1 + 1, authorityIndex: 3 },

  // create_post(nonce, text, image_cid, start_date, end_date) —
  //   0 circle · 1 membership · 2 post · 3 author(sig) · 4 payer(sig,w) · 5 system
  // The ONLY variable-length entry: disc(8) + nonce(8) + borsh text(4+n) +
  // borsh cid(4+n) + start(8) + end(8) = 40 + text + cid, so [40, 604].
  // The bounds are the
  // program's own limits (Post::MAX_TEXT 500, Post::MAX_CID 64), so a request
  // outside them could not succeed on chain anyway — the range is a budget
  // guard, not a semantic check.
  "7b5cb81de7180fca": { name: "create_post", payerIndex: 4, accountCount: 6, dataLen: [8 + 8 + 4 + 4 + 8 + 8, 8 + 8 + 4 + 500 + 4 + 64 + 8 + 8], authorityIndex: 3 },

  // tie_quipu_cord(step) —
  //   0 circle · 1 member_membership · 2 sponsor_membership · 3 wing_peer
  //   · 4 cord · 5 sponsor(sig) · 6 payer(sig,w) · 7 system
  "d2dd754a880d804d": { name: "tie_quipu_cord", payerIndex: 6, accountCount: 8, dataLen: 8 + 1, authorityIndex: 5 },

  // establish_wing_peer() —
  //   0 circle · 1 mentee_membership · 2 wing_membership · 3 wing_peer
  //   · 4 signer(sig) · 5 payer(sig,w) · 6 system
  // STALE ONCE, AND SILENTLY: this entry said 7 accounts long after F98 grew the
  // instruction to 11 (four karma accounts), so every RELAYED sponsorship was
  // being refused with "wrong account count" while the self-paying path worked —
  // exactly the kind of break nothing surfaces, because the UI falls back. Found
  // while adding F59's entries. If an instruction's accounts change, its row
  // here changes in the same commit.
  //   0 circle · 1 mentee_membership · 2 wing_membership · 3 wing_peer
  //   · 4 karma_params · 5 karma_award · 6 mentee_karma · 7 wing_karma
  //   · 8 signer(sig) · 9 payer(sig,w) · 10 system
  "91152f076c655741": { name: "establish_wing_peer", payerIndex: 9, accountCount: 11, dataLen: 8, authorityIndex: 8 },

  // end_wing_peer() —
  //   0 circle · 1 wing_peer · 2 membership · 3 signer(sig)
  // No rent, no payer ACCOUNT: the relayer is the transaction fee-payer only and
  // must appear in no meta at all. `payerIndex: null` is that rule.
  "f75c8f2915606379": { name: "end_wing_peer", payerIndex: null, accountCount: 4, dataLen: 8, authorityIndex: 3 },

  // attest_admission(newcomer_commitment) —
  //   0 circle · 1 parrain_membership · 2 attestation · 3 parrain(sig) · 4 payer(sig,w) · 5 system
  // The named admission path: the parrain's COMMITMENT is recorded on chain by
  // design (confirm_admission needs it for the distinct-persons rule), so this
  // does not make the attestation anonymous — `attest_admission_zk` above is the
  // anonymous form. What relaying removes is the parrain's WALLET as fee-payer.
  "fd0df13174cad9d4": { name: "attest_admission", payerIndex: 4, accountCount: 6, dataLen: 8 + 32, authorityIndex: 3 },
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type RelayVerdict =
  | { ok: true; name: string; authority: string | null; computeUnits?: number }
  | { ok: false; reason: string };

/** Decide whether `req` may be relayed with `relayerPubkey` as fee-payer.
 *
 *  On success, `authority` is the pubkey of the one permitted co-signer (F61)
 *  or null when the relayer is the sole signer. The route uses it to check that
 *  the client's supplied signature belongs where the policy says it may. */
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
  const okLen = Array.isArray(allowed.dataLen)
    ? data.length >= allowed.dataLen[0] && data.length <= allowed.dataLen[1]
    : data.length === allowed.dataLen;
  if (!okLen) {
    return { ok: false, reason: `${allowed.name}: unexpected data length` };
  }
  if (req.keys.length !== allowed.accountCount) {
    return { ok: false, reason: `${allowed.name}: unexpected account count` };
  }

  let authority: string | null = null;
  for (let i = 0; i < req.keys.length; i++) {
    const k = req.keys[i];
    if (!k || typeof k.pubkey !== "string" || !BASE58.test(k.pubkey)) {
      return { ok: false, reason: `account ${i}: invalid pubkey` };
    }
    if (typeof k.isSigner !== "boolean" || typeof k.isWritable !== "boolean") {
      return { ok: false, reason: `account ${i}: malformed meta` };
    }
    if (allowed.payerIndex !== null && i === allowed.payerIndex) {
      if (!k.isSigner) return { ok: false, reason: `${allowed.name}: payer must sign` };
      if (k.pubkey !== relayerPubkey) {
        return { ok: false, reason: `${allowed.name}: payer is not the relayer` };
      }
    } else if (allowed.authorityIndex !== undefined && i === allowed.authorityIndex) {
      // The one permitted co-signer (F61). The relayer must NOT be it: its
      // signature may only ever mean "paid the fee", never "authorised this".
      if (!k.isSigner) return { ok: false, reason: `${allowed.name}: authority must sign` };
      if (k.pubkey === relayerPubkey) {
        return { ok: false, reason: `${allowed.name}: the relayer may not be the authority` };
      }
      authority = k.pubkey;
    } else {
      if (k.isSigner) {
        // Any signer outside the two pinned slots is refused — the boundary is
        // "the relayer pays, and at most one named account authorises".
        return { ok: false, reason: `${allowed.name}: unexpected extra signer` };
      }
      if (allowed.payerIndex === null && k.pubkey === relayerPubkey) {
        // Fee-payer-only instructions must not carry the relayer as a plain
        // account: it would let a caller aim a write at the relayer's own key.
        return { ok: false, reason: `${allowed.name}: relayer must not appear in the accounts` };
      }
    }
  }
  if (allowed.authorityIndex !== undefined && authority === null) {
    return { ok: false, reason: `${allowed.name}: authority signature missing` };
  }
  return { ok: true, name: allowed.name, authority , computeUnits: allowed.computeUnits };
}
