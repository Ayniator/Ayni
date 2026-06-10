use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};

use crate::council::SEAT_TREASURER;
use crate::errors::AyniError;
use crate::state::Circle;

/// Mint one soulbound membership token to a member's Token-2022 account, for
/// selective public disclosure / wallet visibility. The token is non-transferable
/// (the mint carries the NonTransferable extension), so it cannot be sold or
/// moved — anonymity is preserved because the on-chain membership record is keyed
/// by a ZK commitment, not by this token. The Circle PDA is the mint authority.
pub fn mint_membership_token(ctx: Context<MintMembershipToken>) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require!(
        circle.membership_mint == ctx.accounts.mint.key(),
        AyniError::Unauthorized
    );
    // The Treasurer seat stewards the soulbound mint — otherwise anyone could
    // mint membership tokens to any account and fabricate apparent membership.
    circle
        .council
        .require_seat(&ctx.accounts.treasurer.key(), SEAT_TREASURER)?;

    let parent = circle.parent;
    let name = circle.name.clone();
    let bump = circle.bump;
    let seeds: &[&[u8]] = &[b"circle", parent.as_ref(), name.as_bytes(), &[bump]];
    let signer = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.member_token_account.to_account_info(),
            authority: ctx.accounts.circle.to_account_info(),
        },
        signer,
    );
    mint_to(cpi, 1)
}

#[derive(Accounts)]
pub struct MintMembershipToken<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The member's Token-2022 account (created by the client beforehand).
    #[account(mut)]
    pub member_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Must be the Council's Treasurer seat (authorizes the mint).
    pub treasurer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}
