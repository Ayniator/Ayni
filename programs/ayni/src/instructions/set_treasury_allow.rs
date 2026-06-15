use anchor_lang::prelude::*;

use crate::state::{Circle, TreasuryAllow};

/// Add or remove a recipient on a Circle's treasury allowlist (any Council seat).
/// Only enforced when `CircleConfig.treasury_allowlist` is on — then a
/// `withdraw_treasury` recipient must hold an entry with `allowed = true`.
/// A marker PDA, created on first use: ["treasallow", circle, recipient].
pub fn set_treasury_allow(
    ctx: Context<SetTreasuryAllow>,
    recipient: Pubkey,
    allowed: bool,
) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let a = &mut ctx.accounts.allow;
    a.circle = ctx.accounts.circle.key();
    a.recipient = recipient;
    a.allowed = allowed;
    a.bump = ctx.bumps.allow;
    Ok(())
}

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct SetTreasuryAllow<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = TreasuryAllow::SPACE,
        seeds = [b"treasallow", circle.key().as_ref(), recipient.as_ref()],
        bump
    )]
    pub allow: Account<'info, TreasuryAllow>,

    /// Any Council seat (signs + pays the marker rent on first set).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
