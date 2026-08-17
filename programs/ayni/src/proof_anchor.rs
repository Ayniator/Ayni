// F102 — the ProofAnchor seam (ADR 0002, Stage 2).
//
// Every on-chain ZK verification in this program goes through the ONE function
// in this module. Before the seam, each instruction constructed its own
// `Groth16Verifier::new(...)` against one of the three embedded verifying
// keys, so swapping the proof system (the day BN254's discrete log falls to a
// CRQC, or a transparent successor becomes viable at our circuit sizes) meant
// a program-wide rewrite of every site under time pressure. Now it means:
// re-express the circuits, re-run (or skip, if transparent) the ceremony, and
// replace THIS module's dispatch. The Poseidon commitments, nullifiers and
// Merkle trees survive any plausible successor unchanged — they are hashes,
// and the successor proves the same relations.
//
// Behaviour-preserving by construction: same verifying keys, same
// `groth16-solana` verifier, same per-site error codes. The zk-e2e roundtrips
// and the full anchor suite are the regression net.
//
// DISCIPLINE THIS SEAM IMPOSES (ADR 0002 "Consequences"): every NEW
// proof-carrying account records which proof system produced its proof, as a
// `proof_system: u8` field set to `PROOF_SYSTEM_GROTH16_BN254` — so a future
// system can coexist during a migration window instead of a flag-day.
// Existing accounts predate the rule and stay as they are (adding a field is
// a resize migration; the day the byte matters, absence IS the version tag:
// "no byte" == Groth16-BN254). Sentinel: a new proof-carrying account without
// the byte is a finding, same rule as a raw stored Pubkey with no rebind path.

use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

use crate::errors::AyniError;
use crate::verifying_key::VERIFYING_KEY;
use crate::verifying_key_ack::VERIFYING_KEY_ACK;
use crate::verifying_key_vote::VERIFYING_KEY_VOTE;

/// The proof-system version byte for accounts created from now on.
/// `0` = Groth16 over BN254, the only system this program has ever verified.
pub const PROOF_SYSTEM_GROTH16_BN254: u8 = 0;

/// Which (circuit, verifying key) pair a proof claims to satisfy.
///
/// One variant per shipped circuit — NOT per instruction. Eleven instructions
/// verify proofs today; they dispatch over these three kinds:
/// * `MemberVote`  — `member_vote.circom` (anonymous set-membership + choice +
///   domain-separated nullifier). Used by cast_vote, attest_admission_zk,
///   prove_personhood, activate_faucet_zk, verify_fellow_member,
///   clear_presence, attest_presence_zk (twice), maci_signup.
/// * `LineageGrant` — `lineage_grant.circom`. Used by grant_level,
///   issue_acknowledgment.
/// * `AckDisclose` — `ack_disclose.circom`. Used by verify_disclosure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProofKind {
    MemberVote,
    LineageGrant,
    AckDisclose,
}

impl ProofKind {
    const fn verifying_key(self) -> &'static Groth16Verifyingkey<'static> {
        match self {
            ProofKind::MemberVote => &VERIFYING_KEY_VOTE,
            ProofKind::LineageGrant => &VERIFYING_KEY,
            ProofKind::AckDisclose => &VERIFYING_KEY_ACK,
        }
    }
}

/// Verify one Groth16-BN254 proof against the embedded key for `kind`.
///
/// `invalid` is the per-site error the caller's ABI already promises — the
/// seam changes where verification LIVES, never what a failure looks like.
/// Const-generic over the public-input count so each circuit's arity is
/// checked at compile time, exactly as the direct construction did.
pub fn verify_anchored_proof<const N: usize>(
    kind: ProofKind,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; N],
    invalid: AyniError,
) -> Result<()> {
    Groth16Verifier::new(proof_a, proof_b, proof_c, public_inputs, kind.verifying_key())
        .and_then(|mut v| v.verify())
        .map_err(|_| Error::from(invalid))?;
    Ok(())
}
