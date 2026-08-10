use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{AdmissionAttestation, Circle, Membership, MemberTree, ProvisionalMember};

/// Attestation B of the two-sponsor pair (Epic 1, amended v0.2): a trusted
/// servant — any holder of one of the 7 Council seats — co-attests the
/// newcomer, as a service function, not a worthiness screen. This completes
/// admission: the commitment enters the MemberTree (the votable set),
/// `member_count` increments, and the provisional marker closes (rent refunded
/// to the servant). The one-way glass opens in both directions at once.
///
/// Distinct-persons rule, enforced here: the servant's signing key must not be
/// a key of the parrain's membership — a parrain who also holds a seat cannot
/// single-handedly admit their own neophyte.
pub fn confirm_admission(ctx: Context<ConfirmAdmission>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let servant = ctx.accounts.servant.key();

    circle.council.require_any_seat(&servant)?;

    // Two different people. NAMED attestation: program-enforced — the seat
    // wallet must not control the parrain's membership. ANONYMOUS attestation
    // (Epic 2): there is no parrain identity to compare, by design; the rule
    // downgrades to circle-visible (the confirming seat is public and the other
    // six watch), documented in attest_admission_zk.rs.
    if !ctx.accounts.attestation.is_anonymous() {
        let pm = ctx
            .accounts
            .parrain_membership
            .as_ref()
            .ok_or(error!(AyniError::ParrainCannotConfirm))?;
        require!(
            pm.commitment == ctx.accounts.attestation.parrain,
            AyniError::ParrainCannotConfirm
        );
        require!(!pm.is_member_key(&servant), AyniError::ParrainCannotConfirm);
    }

    // Membership must still be live at the moment it becomes full.
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.membership.expires_at > now,
        AyniError::MembershipExpired
    );

    // The newcomer joins the votable set — this, and only this, is what turns
    // a provisional member into a full one.
    let commitment = ctx.accounts.membership.commitment;
    let mt: &mut MemberTree = &mut ctx.accounts.member_tree;
    merkle::insert_leaf(mt.depth, &mut mt.next_index, &mut mt.root, &mut mt.filled_subtrees, commitment)?;

    circle.member_count = circle.member_count.saturating_add(1);
    // `provisional` closes via the account constraint; its absence is what the
    // frontend (and any program) reads as "full member".
    Ok(())
}

#[derive(Accounts)]
pub struct ConfirmAdmission<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    /// The newcomer's (provisional) membership.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Account<'info, Membership>,

    /// The provisional marker — closed here, one-shot: a second confirmation
    /// has no marker left to close and fails at the constraint.
    #[account(
        mut,
        close = servant,
        has_one = circle,
        seeds = [b"provisional", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = provisional.bump,
        constraint = provisional.commitment == membership.commitment,
    )]
    pub provisional: Account<'info, ProvisionalMember>,

    /// The parrain's attestation for this newcomer, and through it the
    /// parrain's membership — both needed for the distinct-persons rule.
    #[account(
        seeds = [b"attest", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = attestation.bump,
        has_one = circle,
    )]
    pub attestation: Account<'info, AdmissionAttestation>,

    /// Required for a NAMED attestation (checked in the handler against
    /// `attestation.parrain`); pass null for an anonymous one.
    #[account(has_one = circle)]
    pub parrain_membership: Option<Account<'info, Membership>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Account<'info, MemberTree>,

    /// Any Council seat (signs; receives the marker's rent).
    #[account(mut)]
    pub servant: Signer<'info>,
}
