use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::AyniError;
use crate::state::Circle;

/// Donate any SPL / Token-2022 token to a Circle's self-supporting treasury
/// (Tradition 7) — the token counterpart of `donate` (which moves SOL). Anyone
/// may contribute any amount; the tokens land in a token account owned by the
/// Circle's `["treasury", circle]` PDA, so only the Council (4-of-7) can later
/// move them. Works for the foundation simply by passing the foundation Circle
/// (see `app/treasury/fund.ts` → `fundFoundation`).
pub fn donate_token(ctx: Context<DonateToken>, amount: u64) -> Result<()> {
    require!(amount > 0, AyniError::WrongProposalAction);

    let decimals = ctx.accounts.mint.decimals;
    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.donor_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.donor.to_account_info(),
        },
    );
    transfer_checked(cpi, amount, decimals)
}

#[derive(Accounts)]
pub struct DonateToken<'info> {
    pub circle: Account<'info, Circle>,

    /// The Circle treasury PDA — the owner/authority of the treasury token
    /// account. A plain account here (it only needs to be a valid owner pubkey).
    #[account(seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// The treasury's token account for `mint`, owned by the treasury PDA. The
    /// client creates it idempotently (associated token account) before/with the
    /// donation; here we only require it belongs to the treasury for this mint.
    #[account(
        mut,
        token::mint = mint,
        token::authority = treasury,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub donor: Signer<'info>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = donor,
    )]
    pub donor_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}
