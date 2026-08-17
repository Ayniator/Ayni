use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::merkle;
use crate::state::{Circle, CircleRootAnchor, VisitPass};

/// F56 — verify a VISITING member: a Groth16 proof that the prover's identity
/// commitment is in `home_circle`'s anchored member set, checked by
/// `host_circle` without the host holding the visitor's home tree. Naming no
/// one: the proof is the `member_vote` circuit reused exactly as
/// `attest_admission_zk` reuses it — root = the ANCHORED home root, external
/// nullifier = the host Circle's key (masked to the field), choice = 1 ("I am
/// a member"). The nullifier Poseidon(secret, host_circle) is deterministic
/// per (member, host), so one member gets one VisitPass per host Circle and
/// the pass links to nothing else — not to the home roster position, not to a
/// wallet, not to passes at other hosts.
///
/// Honest limits, stated exactly:
/// * Freshness is the anchor's freshness: the proof must use the LAST
///   PUBLISHED root (`publish_member_root` is the permissionless crank), so a
///   member admitted since the last publish must crank first, and a member
///   revoked since the last epoch rebuild can still prove until the next
///   rebuild + publish. Same snapshot semantics member voting accepts.
/// * The pass proves "an anonymous member of home_circle" — level, standing
///   details, and identity stay home. That is the feature, not a gap.
/// * FOUNDATION CONSENT (ultracode CRITICAL fix, 2026-08-11b): a VisitPass means
///   "a member of a FOUNDATION-APPROVED child," not merely "a member of some
///   circle self-claiming this foundation as parent." The anchor this reads
///   (`CircleRootAnchor`) can only be created by `publish_member_root`, which now
///   requires the foundation's `FederationChild` approval (created by a
///   foundation Council seat). So a rogue self-claimed child has no anchor and
///   cannot mint a pass here — closing the federation-infiltration hole that the
///   raw `parent` field left open (`initialize_circle` is permissionless and
///   `parent` is caller-set).
/// * Submit through the relayer: a fee-payer wallet would link the visit to a
///   wallet, which is exactly what this exists to avoid.
pub fn verify_fellow_member(
    ctx: Context<VerifyFellowMember>,
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    // Cheap checks first: the anchored root is the only acceptable root.
    let entry = &ctx.accounts.anchor_entry;
    require!(entry.root != [0u8; 32], AyniError::AnchorMismatch);

    // Public-signal order (outputs first): [nullifier, root, proposalId, choice].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        entry.root,
        merkle::field_from_pubkey(&ctx.accounts.host_circle.key()),
        merkle::field_from_u8(1),
    ];

    verify_anchored_proof(
        ProofKind::MemberVote,
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        AyniError::VoteProofInvalid,
    )?;

    let pass = &mut ctx.accounts.visit_pass;
    pass.host_circle = ctx.accounts.host_circle.key();
    pass.home_circle = ctx.accounts.home_circle.key();
    pass.nullifier = nullifier;
    pass.verified_at = Clock::get()?.unix_timestamp;
    pass.bump = ctx.bumps.visit_pass;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct VerifyFellowMember<'info> {
    pub foundation: Account<'info, Circle>,

    /// The visitor's home Circle — in this federation (direct-parent rule).
    #[account(
        constraint = home_circle.key() == foundation.key()
            || home_circle.parent == foundation.key() @ AyniError::Unauthorized
    )]
    pub home_circle: Account<'info, Circle>,

    /// The Circle being visited — also in this federation.
    #[account(
        constraint = host_circle.key() == foundation.key()
            || host_circle.parent == foundation.key() @ AyniError::Unauthorized
    )]
    pub host_circle: Account<'info, Circle>,

    /// The home Circle's published root — seed-bound to (foundation, home), so
    /// a proof can only be checked against the root genuinely anchored for
    /// that Circle.
    #[account(
        seeds = [b"anchor", foundation.key().as_ref(), home_circle.key().as_ref()],
        bump = anchor_entry.bump,
        constraint = anchor_entry.circle == home_circle.key() @ AyniError::AnchorMismatch,
    )]
    pub anchor_entry: Account<'info, CircleRootAnchor>,

    /// One pass per member per host Circle (`init` collision = already
    /// verified; the pass persists — no need to re-prove).
    #[account(
        init,
        payer = payer,
        space = VisitPass::SPACE,
        seeds = [b"visit", host_circle.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub visit_pass: Account<'info, VisitPass>,

    /// A relayer pays, so the visitor's wallet never appears.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
