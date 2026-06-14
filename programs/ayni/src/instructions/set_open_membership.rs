use anchor_lang::prelude::*;

use crate::state::{Circle, OpenMembership};

/// Set a Circle's membership-admission policy: `open = true` makes joining
/// permissionless (anyone may self-admit); `open = false` restores the default
/// where the Scribe-Secretary seat validates and admits members.
///
/// Any Council seat may set it (membership policy is group conscience). The
/// marker PDA is created on first use and updated thereafter — the `Circle`
/// account is never touched, so existing Circles need no migration.
pub fn set_open_membership(ctx: Context<SetOpenMembership>, open: bool) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let m = &mut ctx.accounts.open_membership;
    m.circle = ctx.accounts.circle.key();
    m.open = open;
    m.bump = ctx.bumps.open_membership;
    Ok(())
}

#[derive(Accounts)]
pub struct SetOpenMembership<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = OpenMembership::SPACE,
        seeds = [b"openjoin", circle.key().as_ref()],
        bump
    )]
    pub open_membership: Account<'info, OpenMembership>,

    /// Any Council seat (signs + pays the marker rent on first toggle).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
