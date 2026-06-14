use anchor_lang::prelude::*;

use crate::council::SEAT_SECRETARY;
use crate::state::{Circle, Membership};

/// Revoke (delete) a membership — the Scribe-Secretary seat's domain. Closes the
/// `Membership` account (rent → the Secretary) and decrements the roll.
///
/// Note: the member's commitment leaf remains in the append-only member tree, so
/// it is not retroactively removed from the votable set until the tree is rebuilt
/// — revocation prevents renewal and removes the on-chain membership record.
pub fn revoke_membership(ctx: Context<RevokeMembership>) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_seat(&ctx.accounts.secretary.key(), SEAT_SECRETARY)?;
    let c = &mut ctx.accounts.circle;
    c.member_count = c.member_count.saturating_sub(1);
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeMembership<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle, close = secretary)]
    pub membership: Account<'info, Membership>,

    #[account(mut)]
    pub secretary: Signer<'info>,
}
