use anchor_lang::prelude::*;

use crate::council::SEAT_TREASURER;
use crate::state::Circle;

/// Register the Circle's Token-2022 NonTransferable (soulbound) membership mint.
/// The mint is created out-of-band (spl-token CLI / a setup script) with the
/// NonTransferable extension and **mint authority = this Circle PDA**, so the
/// program can mint via `mint_membership_token`. Set by the **Treasurer** seat
/// (assets are the Treasurer's domain).
pub fn set_membership_mint(ctx: Context<SetMembershipMint>, mint: Pubkey) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    circle
        .council
        .require_seat(&ctx.accounts.treasurer.key(), SEAT_TREASURER)?;
    circle.membership_mint = mint;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMembershipMint<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    /// Must be the Council's Treasurer seat.
    pub treasurer: Signer<'info>,
}
