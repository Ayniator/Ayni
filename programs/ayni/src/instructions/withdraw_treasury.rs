use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::{Circle, CircleConfig, TreasuryAllow};

/// Move SOL from a Circle's treasury, authorized by an executed 4-of-7
/// `WithdrawTreasury` proposal (group conscience over funds, Tradition 7). The
/// proposal pins `amount` + `recipient`; the treasury PDA signs the transfer.
/// Permissionless to trigger once authorized.
///
/// If the Circle has turned on `CircleConfig.treasury_allowlist`, the recipient
/// must additionally hold a `TreasuryAllow` entry with `allowed = true` (a
/// spend-allowlist / mission-control on top of the 4-of-7 vote).
pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>) -> Result<()> {
    require!(ctx.accounts.proposal.executed, AyniError::ThresholdNotMet);
    // One-shot: an executed WithdrawTreasury authorizes exactly ONE transfer of
    // the pinned amount. Without this guard the (permissionless) call could be
    // replayed to drain the whole treasury — the critical bug this fixes.
    require!(!ctx.accounts.proposal.drained, AyniError::AlreadyExecuted);

    let (amount, recipient) = match &ctx.accounts.proposal.action {
        ProposalAction::WithdrawTreasury { amount, recipient } => (*amount, *recipient),
        _ => return err!(AyniError::WrongProposalAction),
    };
    require!(amount > 0, AyniError::WrongProposalAction);
    require!(
        ctx.accounts.recipient.key() == recipient,
        AyniError::WalletMismatch
    );

    // Spend allowlist (mission control): when enabled, the recipient must be on
    // the allowlist. `config` is seed-bound + init_if_needed, so it can't be
    // omitted to bypass an enabled allowlist.
    if ctx.accounts.config.treasury_allowlist {
        let allow = ctx
            .accounts
            .allow
            .as_ref()
            .ok_or(error!(AyniError::Unauthorized))?;
        require!(
            allow.allowed && allow.recipient == recipient,
            AyniError::Unauthorized
        );
    }

    // Mark consumed before the CPI (no re-entrancy window).
    ctx.accounts.proposal.drained = true;

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

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    /// The Circle's policy (its `treasury_allowlist` flag). Seed-bound +
    /// created on first use, so it can't be omitted to dodge an enabled allowlist.
    #[account(
        init_if_needed,
        payer = caller,
        space = CircleConfig::SPACE,
        seeds = [b"config", circle.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// The recipient's allowlist entry — only required when the allowlist is on.
    #[account(seeds = [b"treasallow", circle.key().as_ref(), recipient.key().as_ref()], bump)]
    pub allow: Option<Account<'info, TreasuryAllow>>,

    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: must equal the proposal's pinned recipient.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// Whoever triggers the (still-permissionless) withdrawal; pays config rent
    /// on first use. The transaction fee-payer anyway.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
