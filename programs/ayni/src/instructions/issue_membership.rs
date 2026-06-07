use anchor_lang::prelude::*;

use crate::state::{Circle, Membership};

pub fn issue_membership(ctx: Context<IssueMembership>, commitment: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &mut ctx.accounts.circle;

    let membership = &mut ctx.accounts.membership;
    membership.circle = circle.key();
    membership.commitment = commitment;
    membership.issued_at = clock.unix_timestamp;
    membership.expires_at = clock.unix_timestamp + circle.membership_period;
    membership.level = 0;
    membership.bump = ctx.bumps.membership;

    circle.member_count = circle.member_count.saturating_add(1);

    // TODO(ayni): mint a Token-2022 NonTransferable (soulbound) membership token
    // bound to `commitment` via an anchor_spl::token_2022 CPI, for selective
    // public disclosure. Anonymity is preserved because the account is keyed by
    // the ZK commitment, not by a wallet.
    Ok(())
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct IssueMembership<'info> {
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = Membership::SPACE,
        seeds = [b"membership", circle.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub membership: Account<'info, Membership>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
