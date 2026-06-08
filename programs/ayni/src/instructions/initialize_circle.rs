use anchor_lang::prelude::*;

use crate::council::Council;
use crate::errors::AyniError;
use crate::state::Circle;

pub fn initialize_circle(
    ctx: Context<InitializeCircle>,
    name: String,
    membership_period: i64,
    recovery_timelock: i64,
) -> Result<()> {
    require!(name.len() <= Circle::MAX_NAME, AyniError::NameTooLong);

    let circle = &mut ctx.accounts.circle;
    circle.world_service = ctx.accounts.world_service.key();
    circle.authority = ctx.accounts.authority.key();
    // Council starts empty (all seats vacant) at the default 4-of-7 threshold;
    // seats are filled via `appoint_seat`, then rotated by 4-of-7 vote. The
    // contest window for wallet migration is set per Circle here.
    circle.council = Council::empty();
    circle.council.recovery_timelock = recovery_timelock;
    circle.membership_period = membership_period;
    circle.member_count = 0;
    circle.name = name;
    circle.bump = ctx.bumps.circle;
    Ok(())
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeCircle<'info> {
    #[account(
        init,
        payer = authority,
        space = Circle::SPACE,
        seeds = [b"circle", world_service.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub circle: Account<'info, Circle>,

    /// CHECK: the AHA World Service Circle authority this Circle forks under.
    /// Verified only as a key used in the Circle PDA seeds.
    pub world_service: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
