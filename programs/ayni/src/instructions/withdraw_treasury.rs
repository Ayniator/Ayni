use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::Circle;

/// Withdraw SOL from a Circle's treasury to `recipient`. Authority-gated: in
/// production the Circle `authority` is a Squads/Realms governance PDA, so the
/// m-of-n (e.g. 4-of-7) lives there. The treasury PDA signs the transfer.
pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.treasury;
    let seeds: &[&[u8]] = &[b"treasury", circle_key.as_ref(), &[bump]];
    let signer = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        },
        signer,
    );
    system_program::transfer(cpi, amount)
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(has_one = authority)]
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: any recipient of an authorized withdrawal.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
