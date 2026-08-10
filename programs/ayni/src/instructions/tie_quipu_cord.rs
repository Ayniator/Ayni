use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Membership, QuipuCord, WingPeer};

/// The sponsor ties a quipu cord for a completed step (Trust Platform Epic 3):
/// "I receive a cord in the step's alchemical colour when I complete a step,
/// tied by my sponsor as the closing act of the ceremony." The sponsor — the
/// member's designated wing (their WingPeer, the sponsor bond) — signs; the
/// member does not tie their own cord.
///
/// One cord per (member, step); the PDA seed is the refusal of a second. Steps
/// are 1..=12. Binary and personal — nothing here to compare or game: the cord
/// records only which step and when.
pub fn tie_quipu_cord(ctx: Context<TieQuipuCord>, step: u8) -> Result<()> {
    require!(
        (QuipuCord::FIRST_STEP..=QuipuCord::LAST_STEP).contains(&step),
        AyniError::InvalidStep
    );

    let now = Clock::get()?.unix_timestamp;

    // The sponsor signs with a key of their own membership, in good standing.
    require!(
        ctx.accounts
            .sponsor_membership
            .is_member_key(&ctx.accounts.sponsor.key()),
        AyniError::Unauthorized
    );
    require!(
        ctx.accounts.sponsor_membership.expires_at > now,
        AyniError::MembershipExpired
    );

    // The sponsor must be the member's designated wing (the sponsor bond), and a
    // member cannot tie their own cord.
    let member = ctx.accounts.member_membership.commitment;
    let sponsor = ctx.accounts.sponsor_membership.commitment;
    require!(member != sponsor, AyniError::SelfAttestation);
    require!(
        ctx.accounts.wing_peer.active && ctx.accounts.wing_peer.wing == sponsor,
        AyniError::NotParrain
    );

    let c = &mut ctx.accounts.cord;
    c.circle = ctx.accounts.circle.key();
    c.member = member;
    c.step = step;
    c.sponsor = sponsor;
    c.completed_at = now;
    c.bump = ctx.bumps.cord;
    Ok(())
}

#[derive(Accounts)]
#[instruction(step: u8)]
pub struct TieQuipuCord<'info> {
    pub circle: Account<'info, Circle>,

    /// The walker's membership.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump = member_membership.bump,
    )]
    pub member_membership: Account<'info, Membership>,

    /// The sponsor's membership (the wing side of the bond).
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), sponsor_membership.commitment.as_ref()],
        bump = sponsor_membership.bump,
    )]
    pub sponsor_membership: Account<'info, Membership>,

    /// The member's sponsor bond — seed-bound to the member, so it can't be
    /// swapped for someone else's.
    #[account(
        has_one = circle,
        seeds = [b"wingpeer", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump = wing_peer.bump,
    )]
    pub wing_peer: Account<'info, WingPeer>,

    /// One cord per (member, step) — `init` collision IS the refusal of a second.
    #[account(
        init,
        payer = sponsor,
        space = QuipuCord::SPACE,
        seeds = [b"quipu", circle.key().as_ref(), member_membership.commitment.as_ref(), &[step]],
        bump
    )]
    pub cord: Account<'info, QuipuCord>,

    /// The sponsor (signs + pays the cord's rent — the closing act of the rite).
    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub system_program: Program<'info, System>,
}
