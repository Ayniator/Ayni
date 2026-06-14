use anchor_lang::prelude::*;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::{Circle, TreasuryConfig};

/// Apply an executed 4-of-7 `SetTreasuryWallet` proposal: write the new treasury
/// steward wallet into the Circle's `TreasuryConfig`. Mirrors `withdraw_treasury`
/// — the contestable, time-locked proposal authorizes; this carries it out.
/// Permissionless to trigger once authorized; one-shot per proposal.
pub fn set_treasury_wallet(ctx: Context<SetTreasuryWallet>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.executed, AyniError::ThresholdNotMet);
    require!(!proposal.drained, AyniError::AlreadyExecuted);

    let new_wallet = match &proposal.action {
        ProposalAction::SetTreasuryWallet { new_wallet } => *new_wallet,
        _ => return err!(AyniError::WrongProposalAction),
    };
    require!(new_wallet != Pubkey::default(), AyniError::WalletMismatch);

    proposal.drained = true; // consumed — cannot be replayed

    let cfg = &mut ctx.accounts.treasury_config;
    cfg.circle = ctx.accounts.circle.key();
    cfg.wallet = new_wallet;
    cfg.bump = ctx.bumps.treasury_config;
    Ok(())
}

#[derive(Accounts)]
pub struct SetTreasuryWallet<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init_if_needed,
        payer = payer,
        space = TreasuryConfig::SPACE,
        seeds = [b"treasurycfg", circle.key().as_ref()],
        bump
    )]
    pub treasury_config: Account<'info, TreasuryConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
