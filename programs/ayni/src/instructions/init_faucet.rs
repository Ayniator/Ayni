use anchor_lang::prelude::*;

use crate::state::{Circle, FaucetJar, FAUCET_DEFAULT_GRANT_LAMPORTS};

/// Create a Circle's gas-faucet jar (Trust Platform Epic 0). Any Council seat;
/// the jar starts at the default grant amount and holds only its own rent —
/// funding arrives by donation (plain transfer to the jar address) or by a
/// member-voted treasury refill (`refill_faucet`). PDA: ["faucet", circle].
pub fn init_faucet(ctx: Context<InitFaucet>) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let jar = &mut ctx.accounts.jar;
    jar.circle = ctx.accounts.circle.key();
    jar.grant_lamports = FAUCET_DEFAULT_GRANT_LAMPORTS;
    jar.granted = 0;
    jar.amount_changed_at = 0; // never retuned ⇒ no cooldown to wait out
    jar.bump = ctx.bumps.jar;
    Ok(())
}

#[derive(Accounts)]
pub struct InitFaucet<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = seat,
        space = FaucetJar::SPACE,
        seeds = [b"faucet", circle.key().as_ref()],
        bump
    )]
    pub jar: Account<'info, FaucetJar>,

    /// Any Council seat (signs + pays the jar's rent).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
