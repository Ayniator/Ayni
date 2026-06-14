use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, CircleCountry};

/// Set a Circle's country (ISO-3166-1 alpha-2 code, e.g. "FR") — used to group
/// Circles by continent → country in the foundation directory. Any Council seat
/// may set it (routine directory upkeep, revocable by rotation). A separate PDA,
/// so the `Circle`/`CircleProfile` layouts are untouched and existing Circles
/// need no migration. The marker PDA is created on first use and updated
/// thereafter. PDA: ["country", circle].
pub fn set_circle_country(ctx: Context<SetCircleCountry>, code: String) -> Result<()> {
    require!(
        code.len() <= CircleCountry::MAX_CODE,
        AyniError::ProfileFieldTooLong
    );

    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let c = &mut ctx.accounts.country;
    c.circle = ctx.accounts.circle.key();
    c.code = code.to_uppercase();
    c.bump = ctx.bumps.country;
    Ok(())
}

#[derive(Accounts)]
pub struct SetCircleCountry<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = CircleCountry::SPACE,
        seeds = [b"country", circle.key().as_ref()],
        bump
    )]
    pub country: Account<'info, CircleCountry>,

    /// Any Council seat (signs + pays the marker rent on first set).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
