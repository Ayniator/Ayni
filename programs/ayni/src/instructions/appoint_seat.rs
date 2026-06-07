use anchor_lang::prelude::*;

use crate::council::COUNCIL_SEATS;
use crate::errors::AyniError;
use crate::state::Circle;

/// Seat a Council member (bootstrap / governance path). `authority` is the
/// Circle's governance PDA. Once the Council is seated, ongoing changes should
/// go through the 4-of-7 `propose`/`approve`/`execute` flow (RotateSeat), not
/// this admin path. Seats 0..2 are the named servants; 3..6 are elders.
pub fn appoint_seat(ctx: Context<AppointSeat>, seat_index: u8, holder: Pubkey) -> Result<()> {
    require!((seat_index as usize) < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
    ctx.accounts.circle.council.seats[seat_index as usize] = holder;
    Ok(())
}

#[derive(Accounts)]
pub struct AppointSeat<'info> {
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,
    pub authority: Signer<'info>,
}
