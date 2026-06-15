use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Membership, WingPeer};

/// A member designates (or changes) their WingPeer — a more-experienced member
/// who mentors them. The caller must control the mentee membership (its owner or
/// a guardian key); the wing must be a real membership of the same Circle. A
/// member sets their own wing — never imposed. PDA: ["wingpeer", circle, mentee].
pub fn establish_wing_peer(ctx: Context<EstablishWingPeer>) -> Result<()> {
    require!(
        ctx.accounts
            .mentee_membership
            .is_member_key(&ctx.accounts.signer.key()),
        AyniError::Unauthorized
    );
    let mentee = ctx.accounts.mentee_membership.commitment;
    let wing = ctx.accounts.wing_membership.commitment;
    require!(mentee != wing, AyniError::Unauthorized); // can't wing yourself

    let now = Clock::get()?.unix_timestamp;
    let w = &mut ctx.accounts.wing_peer;
    w.circle = ctx.accounts.circle.key();
    w.mentee = mentee;
    w.wing = wing;
    w.established_at = now;
    w.active = true;
    w.bump = ctx.bumps.wing_peer;
    Ok(())
}

#[derive(Accounts)]
pub struct EstablishWingPeer<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), mentee_membership.commitment.as_ref()],
        bump = mentee_membership.bump,
    )]
    pub mentee_membership: Account<'info, Membership>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), wing_membership.commitment.as_ref()],
        bump = wing_membership.bump,
    )]
    pub wing_membership: Account<'info, Membership>,

    #[account(
        init_if_needed,
        payer = signer,
        space = WingPeer::SPACE,
        seeds = [b"wingpeer", circle.key().as_ref(), mentee_membership.commitment.as_ref()],
        bump
    )]
    pub wing_peer: Account<'info, WingPeer>,

    /// A key the mentee controls (owner or guardian).
    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
