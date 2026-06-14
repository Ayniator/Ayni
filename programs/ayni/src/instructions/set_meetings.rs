use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{CircleMeetings, Circle};

/// Set/replace a Circle's meeting calendar (recurring patterns + exceptional
/// sessions, as a JSON string). Any Council seat may publish it; every member
/// (and visitor) can read it. Created on first call, updated thereafter.
pub fn set_meetings(ctx: Context<SetMeetings>, data: String) -> Result<()> {
    require!(data.len() <= CircleMeetings::MAX_DATA, AyniError::ProfileFieldTooLong);
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;
    let m = &mut ctx.accounts.meetings;
    m.circle = ctx.accounts.circle.key();
    m.data = data;
    m.bump = ctx.bumps.meetings;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMeetings<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = CircleMeetings::SPACE,
        seeds = [b"meetings", circle.key().as_ref()],
        bump
    )]
    pub meetings: Account<'info, CircleMeetings>,

    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
