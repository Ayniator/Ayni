use anchor_lang::prelude::*;

use crate::state::{Circle, Membership};

pub fn renew_membership(ctx: Context<RenewMembership>) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &ctx.accounts.circle;
    let membership = &mut ctx.accounts.membership;

    // Extend from the later of now or the current expiry, so renewing early
    // never loses time and renewing late never back-dates the new term.
    let base = membership.expires_at.max(clock.unix_timestamp);
    membership.expires_at = base + circle.membership_period;

    // TODO(ayni): require a donation transfer into the Circle treasury (Squads
    // multisig) as the act of renewal — self-support, Tradition 7.
    Ok(())
}

#[derive(Accounts)]
pub struct RenewMembership<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Account<'info, Membership>,

    /// Anyone may pay to renew a membership (a member can renew anonymously,
    /// or another member can gift a renewal).
    pub payer: Signer<'info>,
}
