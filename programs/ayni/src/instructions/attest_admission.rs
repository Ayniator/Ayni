use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{AdmissionAttestation, Circle, Membership};

/// Attestation A of the two-sponsor pair (Epic 1, amended v0.2): the parrain —
/// any member in good standing who has met the newcomer in person — attests
/// with one action. One attestation per newcomer: the PDA seed is the refusal
/// of a second. The parrain cannot be the newcomer, and their membership must
/// be unexpired.
///
/// Named-pilot honesty: this records the parrain's membership commitment, one
/// more edge of the same kind the WingPeer bond already records; it is needed
/// so `confirm_admission` can enforce the distinct-persons rule. The anonymous
/// form (a ZK proof of "a member in good standing attested", naming no one) is
/// Epic 2's work and replaces this account, not the flow.
pub fn attest_admission(ctx: Context<AttestAdmission>, newcomer_commitment: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts
            .parrain_membership
            .is_member_key(&ctx.accounts.parrain.key()),
        AyniError::Unauthorized
    );
    require!(
        ctx.accounts.parrain_membership.expires_at > now,
        AyniError::MembershipExpired
    );
    require!(
        ctx.accounts.parrain_membership.commitment != newcomer_commitment,
        AyniError::SelfAttestation
    );

    let a = &mut ctx.accounts.attestation;
    a.circle = ctx.accounts.circle.key();
    a.newcomer = newcomer_commitment;
    a.parrain = ctx.accounts.parrain_membership.commitment;
    a.nullifier = [0u8; 32]; // named form — see attest_admission_zk for the anonymous one
    a.attested_at = now;
    a.bump = ctx.bumps.attestation;
    Ok(())
}

#[derive(Accounts)]
#[instruction(newcomer_commitment: [u8; 32])]
pub struct AttestAdmission<'info> {
    pub circle: Account<'info, Circle>,

    /// The parrain's own membership — in good standing, in this Circle.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), parrain_membership.commitment.as_ref()],
        bump = parrain_membership.bump,
    )]
    pub parrain_membership: Account<'info, Membership>,

    /// One per newcomer — `init` collision IS the refusal of a second parrain.
    #[account(
        init,
        payer = payer,
        space = AdmissionAttestation::SPACE,
        seeds = [b"attest", circle.key().as_ref(), newcomer_commitment.as_ref()],
        bump
    )]
    pub attestation: Account<'info, AdmissionAttestation>,

    /// A key the parrain's membership recognises (owner or guardian).
    pub parrain: Signer<'info>,

    /// Rent payer — SEPARATE from the authority above, and that separation is
    /// the whole of F61's usability story. A shielded membership's authority is
    /// the key derived in `shield_membership`, which has never held a lamport
    /// and must never need to: funding a freshly-derived "anonymous" pubkey from
    /// a wallet the member is already known by is a single-hop funding transfer,
    /// one of the most reliable clustering heuristics in chain analysis, and a
    /// far STRONGER link than the co-signature this instruction already implies.
    /// The derived key signs; somebody else's lamports pay — an ordinary wallet,
    /// or the F55 relayer, which takes this slot with no program change.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
