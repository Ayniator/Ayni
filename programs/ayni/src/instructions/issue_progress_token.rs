use anchor_lang::prelude::*;

use crate::state::{Circle, Membership, ProgressToken};

/// A Council seat awards a member a progress token (a milestone "chip", e.g. 30 /
/// 90 / 365 days) — the group celebrating the journey. One per (member,
/// milestone); the member must be a real membership of the Circle.
/// PDA: ["progress", circle, member, milestone].
pub fn issue_progress_token(ctx: Context<IssueProgressToken>, milestone: u32) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.token;
    t.circle = ctx.accounts.circle.key();
    t.member = ctx.accounts.member_membership.commitment;
    t.milestone = milestone;
    t.issued_at = now;
    t.issuer = ctx.accounts.seat.key();
    t.bump = ctx.bumps.token;
    Ok(())
}

#[derive(Accounts)]
#[instruction(milestone: u32)]
pub struct IssueProgressToken<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump = member_membership.bump,
    )]
    pub member_membership: Account<'info, Membership>,

    #[account(
        init,
        payer = seat,
        space = ProgressToken::SPACE,
        seeds = [b"progress", circle.key().as_ref(), member_membership.commitment.as_ref(), &milestone.to_le_bytes()],
        bump
    )]
    pub token: Account<'info, ProgressToken>,

    /// Any Council seat (signs + pays the chip's rent).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
