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
        payer = payer,
        space = VisibilityPolicy::SPACE,
        seeds = [b"visibility", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump
    )]
    pub policy: Account<'info, VisibilityPolicy>,

    /// A key the member controls (owner or guardian). AUTHORISES ONLY — for a
    /// shielded membership this is the derived key, which holds nothing.
    pub member: Signer<'info>,

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
