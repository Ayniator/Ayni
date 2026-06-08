use anchor_lang::prelude::*;

use crate::state::Circle;

/// Register the Circle's Token-2022 NonTransferable (soulbound) membership mint.
/// The mint is created out-of-band (spl-token CLI / a setup script) with the
/// NonTransferable extension and **mint authority = this Circle PDA**, so the
/// program can mint via `mint_membership_token`. Authority-gated.
pub fn set_membership_mint(ctx: Context<SetMembershipMint>, mint: Pubkey) -> Result<()> {
    ctx.accounts.circle.membership_mint = mint;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMembershipMint<'info> {
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,
    pub authority: Signer<'info>,
}
