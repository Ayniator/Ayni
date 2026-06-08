use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::Circle;

/// Donate SOL to a Circle's self-supporting treasury (Tradition 7). The treasury
/// is a per-Circle PDA; anyone may contribute. Withdrawals go through
/// `withdraw_treasury` (authority = the Circle's Squads/Realms governance).
pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
    let cpi = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.donor.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        },
    );
    system_program::transfer(cpi, amount)
}

#[derive(Accounts)]
pub struct Donate<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub donor: Signer<'info>,

    pub system_program: Program<'info, System>,
}
