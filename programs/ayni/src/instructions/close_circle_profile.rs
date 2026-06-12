use anchor_lang::prelude::*;

use crate::state::{Circle, CircleProfile};

/// Remove a Circle from the public directory by closing its `CircleProfile`
/// account — the Circle disappears from "Find a Circle Near You" (the map reads
/// profile accounts). The Circle itself, its Council, members, and treasury are
/// untouched; only the directory listing is deleted. Rent is returned to the
/// acting seat. Any Council seat may delist its Circle.
pub fn close_circle_profile(ctx: Context<CloseCircleProfile>) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;
    // The `close = seat` account constraint zeroes the profile and refunds rent.
    Ok(())
}

#[derive(Accounts)]
pub struct CloseCircleProfile<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        close = seat,
        seeds = [b"profile", circle.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, CircleProfile>,

    /// Any Council seat (receives the reclaimed rent).
    #[account(mut)]
    pub seat: Signer<'info>,
}
