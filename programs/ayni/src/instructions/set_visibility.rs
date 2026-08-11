use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Membership, VisibilityPolicy};

/// A member sets their own per-element visibility (Trust Platform Epic 5). Each
/// of avatar / quipu / bio takes a tier (0 = chosen ones, 1 = my circle, 2 = all
/// members). Signed by a key the member controls (owner or guardian) — never
/// imposed. Created on first use with the protective defaults implicitly (an
/// absent policy already means "my circle" everywhere); this instruction only
/// records a deliberate change.
pub fn set_visibility(ctx: Context<SetVisibility>, avatar: u8, quipu: u8, bio: u8) -> Result<()> {
    require!(
        VisibilityPolicy::valid_tier(avatar)
            && VisibilityPolicy::valid_tier(quipu)
            && VisibilityPolicy::valid_tier(bio),
        AyniError::InvalidVisibilityTier
    );
    require!(
        ctx.accounts
            .member_membership
            .is_member_key(&ctx.accounts.member.key()),
        AyniError::Unauthorized
    );

    let p = &mut ctx.accounts.policy;
    p.circle = ctx.accounts.circle.key();
    p.member = ctx.accounts.member_membership.commitment;
    p.avatar = avatar;
    p.quipu = quipu;
    p.bio = bio;
    p.bump = ctx.bumps.policy;
    Ok(())
}

#[derive(Accounts)]
pub struct SetVisibility<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump = member_membership.bump,
    )]
    pub member_membership: Account<'info, Membership>,

    #[account(
        init_if_needed,
        payer = member,
        space = VisibilityPolicy::SPACE,
        seeds = [b"visibility", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump
    )]
    pub policy: Account<'info, VisibilityPolicy>,

    /// A key the member controls (owner or guardian); signs + pays rent.
    #[account(mut)]
    pub member: Signer<'info>,

    pub system_program: Program<'info, System>,
}
