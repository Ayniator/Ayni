use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::month;
use crate::state::{Circle, MemberTree, Presence, RecentRoots};

/// Canonical external nullifier for a presence attestation.
///
/// The month is IN the preimage, which is what stops a proof for March being
/// replayed as a proof for April: change the month and both parties' nullifiers
/// change, so a proof simply does not verify against the other month's public
/// inputs.
///
/// The tag is distinct from `AHA-faucet-grant` and from the raw newcomer
/// commitment / `field_from_pubkey(circle)` / proposal nonce used elsewhere, so
/// one member's separate anonymous acts never share a nullifier and cannot be
/// joined by an observer who sees both.
///
/// Masking the top three bits of the big-endian hash puts the value below
/// BN254's p (p > 2^253), so the encoding is always a valid field element and
/// never needs a reduction the prover could disagree with. The browser prover
/// must mask identically.
pub fn presence_external_nullifier(
    circle: &Pubkey,
    subject_commitment: &[u8; 32],
    month_index: u32,
) -> [u8; 32] {
    let mut b = hashv(&[
        b"AHA-presence-month",
        circle.as_ref(),
        subject_commitment.as_ref(),
        &month_index.to_le_bytes(),
    ])
    .to_bytes();
    b[0] &= 0x1f;
    b
}

/// F59 — "last stood in circle: March 2026", vouched by a fellow member.
///
/// WHAT THIS MEANS, AND WHAT IT DOES NOT. The chain cannot know who stood in a
/// room. It knows that two DIFFERENT members of this Circle both produced a
/// proof naming the same month. Every string in the UI must use the vouching
/// wording; none may say attendance was verified, because it was not.
///
/// Two parties, both anonymous, both proving with the SAME shipped
/// `member_vote` verifying key — no new circuit, no new ceremony, F44 stays out
/// of scope:
///
/// * **Subject (consent).** Proves against `single_leaf_root(commitment)` — the
///   F35-R2 trick from `activate_faucet_zk`. The only witness satisfying that
///   root is a secret `s` with `Poseidon(s) == commitment`, so **nobody can be
///   written about involuntarily**, and a wallet-less or shielded member can
///   still act, which an `owner` signature could not achieve.
/// * **Witness (anonymity).** Proves against the member tree root or a
///   `RecentRoots` entry — byte-identical to `attest_admission_zk`'s F54 gate.
///   The witness is any member of the tree and is named nowhere.
///
/// **The distinct-persons rule, restored on chain.** Both proofs are taken under
/// the same external nullifier `E`. Since the circuit computes
/// `nullifier = Poseidon(secret, proposalId)`, requiring the two nullifiers to
/// differ proves two different secrets acted. This is strictly stronger than
/// `confirm_admission`, whose own comment concedes the rule "downgrades from
/// program-enforced to circle-visible" for anonymous attestations. The shared
/// `E` is load-bearing: comparing nullifiers taken under different `proposalId`s
/// would prove nothing at all, since a single member could produce both.
///
/// **Closed months only.** Attesting the CURRENT month narrows a member to a
/// window a public meeting calendar can resolve to one evening. This rule must
/// never be relaxed for convenience.
///
/// **Compute.** Two Groth16 verifications do not fit the 200k default; the
/// client must prepend a `ComputeBudget::SetComputeUnitLimit`. Verified with
/// the cheap checks first so a malformed call fails before the pairing work.
///
/// Submit through the relayer: a wallet that pays this fee links itself to the
/// attestation's timing, and the two writes land close together (see
/// `docs/presence.md` §4.4 on the relay operator's view).
#[allow(clippy::too_many_arguments)]
pub fn attest_presence_zk(
    ctx: Context<AttestPresenceZk>,
    subject_commitment: [u8; 32],
    month_index: u32,
    witness_root: [u8; 32],
    subject_nullifier: [u8; 32],
    witness_nullifier: [u8; 32],
    subject_proof_a: [u8; 64],
    subject_proof_b: [u8; 128],
    subject_proof_c: [u8; 64],
    witness_proof_a: [u8; 64],
    witness_proof_b: [u8; 128],
    witness_proof_c: [u8; 64],
) -> Result<()> {
    // --- cheap checks first, before any pairing work ------------------------

    // Two different people. Checked before the proofs are verified because it
    // costs nothing and rejects the self-attestation case immediately.
    require!(
        subject_nullifier != witness_nullifier,
        AyniError::WitnessIsSubject
    );

    // Only a month that has already closed.
    let now_month = month::current_month()?;
    require!(month_index < now_month, AyniError::MonthNotClosed);

    // Strictly forward. On a freshly initialised account `last_month` is 0,
    // which would wrongly reject a genuine attestation for month 0 — but month 0
    // is January 1970, which cannot be a closed month for any live clock, so the
    // case is unreachable rather than merely unlikely.
    let presence = &mut ctx.accounts.presence;
    require!(
        month_index > presence.last_month,
        AyniError::MonthWentBackwards
    );

    // The witness proves against the current root or one still in the F54 ring
    // buffer, so a concurrent admission does not kill an in-flight proof.
    let is_current = witness_root == ctx.accounts.member_tree.root;
    let is_recent = ctx
        .accounts
        .recent_roots
        .as_ref()
        .map(|rr| rr.contains(&witness_root))
        .unwrap_or(false);
    require!(is_current || is_recent, AyniError::RootNotRecent);

    // --- the two proofs -----------------------------------------------------

    let external = presence_external_nullifier(
        &ctx.accounts.circle.key(),
        &subject_commitment,
        month_index,
    );
    let choice = crate::merkle::field_from_u8(1); // 1 = "I attest"

    // Subject: consent. The root is computed ON CHAIN from the commitment, so
    // the caller cannot substitute a tree they control.
    let subject_root = crate::merkle::single_leaf_root(&subject_commitment)?;
    let subject_inputs: [[u8; 32]; 4] = [subject_nullifier, subject_root, external, choice];
    verify_anchored_proof(
        ProofKind::MemberVote,
        &subject_proof_a,
        &subject_proof_b,
        &subject_proof_c,
        &subject_inputs,
        AyniError::VoteProofInvalid,
    )?;

    // Witness: membership of the Circle, under the SAME external nullifier.
    let witness_inputs: [[u8; 32]; 4] = [witness_nullifier, witness_root, external, choice];
    verify_anchored_proof(
        ProofKind::MemberVote,
        &witness_proof_a,
        &witness_proof_b,
        &witness_proof_c,
        &witness_inputs,
        AyniError::VoteProofInvalid,
    )?;

    // --- the whole of the state change --------------------------------------
    //
    // One scalar, overwritten. Nothing accumulates, so there is nothing to sum.
    presence.last_month = month_index;
    presence.bump = ctx.bumps.presence;
    Ok(())
}

#[derive(Accounts)]
#[instruction(subject_commitment: [u8; 32])]
pub struct AttestPresenceZk<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Account<'info, MemberTree>,

    /// F54 ring buffer; may be absent for a Circle that has never cranked
    /// `note_root`, in which case only the exact current root is accepted.
    #[account(
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Option<Box<Account<'info, RecentRoots>>>,

    /// Thirteen bytes, keyed by the subject's commitment. `init_if_needed`
    /// because the FIRST attestation and every later one must be
    /// indistinguishable in cost and shape — a separate "open a presence
    /// record" instruction would itself be a first-attendance signal.
    #[account(
        init_if_needed,
        payer = payer,
        space = Presence::SPACE,
        seeds = [b"presence", circle.key().as_ref(), subject_commitment.as_ref()],
        bump
    )]
    pub presence: Account<'info, Presence>,

    /// A relayer pays, so neither party's wallet appears.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
