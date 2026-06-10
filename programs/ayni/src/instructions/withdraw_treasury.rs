use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::Circle;

/// Move SOL from a Circle's treasury, authorized by an executed 4-of-7
/// `WithdrawTreasury` proposal (group conscience over funds, Tradition 7). The
/// proposal pins `amount` + `recipient`; the treasury PDA signs the transfer.
/// Permissionless to trigger once authorized.
pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>) -> Result<()> {
    let proposal = &ctx.accounts.proposal;
    require!(proposal.executed, AyniError::ThresholdNotMet);

    let (amount, recipient) = match &proposal.action {
        ProposalAction::WithdrawTreasury { amount, recipient } => (*amount, *recipient),
        _ => return err!(AyniError::WrongProposalAction),
    };
    require!(
        ctx.accounts.recipient.key() == recipient,
        AyniError::WalletMismatch
    );

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
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: must equal the proposal's pinned recipient.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
