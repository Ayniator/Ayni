use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::{Circle, CircleConfig, TreasuryAllow};

/// Move an SPL / Token-2022 balance out of a Circle's treasury token account,
/// authorized by an executed 4-of-7 `WithdrawTreasuryToken` proposal (group
/// conscience over funds, Tradition 7) — the token counterpart of
/// `withdraw_treasury` (which moves SOL). The proposal pins `mint`, `amount`, and
/// `recipient`; the treasury PDA signs a `transfer_checked`. Permissionless to
/// trigger once authorized.
///
/// Before this instruction existed, tokens donated via `donate_token` sat in an
/// account owned by the `["treasury", circle]` PDA with NO signing path — the
/// Council could not move them, so every token donation was permanently locked
/// (audit finding). This closes that.
///
/// If the Circle has turned on `CircleConfig.treasury_allowlist`, the recipient
/// wallet must additionally hold a `TreasuryAllow` entry with `allowed = true`,
/// exactly as `withdraw_treasury` enforces for SOL.
pub fn withdraw_treasury_token(ctx: Context<WithdrawTreasuryToken>) -> Result<()> {
    require!(ctx.accounts.proposal.executed, AyniError::ThresholdNotMet);
    // One-shot: an executed WithdrawTreasuryToken authorizes exactly ONE transfer
    // of the pinned amount — the same replay guard as the SOL path.
    require!(!ctx.accounts.proposal.drained, AyniError::AlreadyExecuted);

    let (mint, amount, recipient) = match &ctx.accounts.proposal.action {
        ProposalAction::WithdrawTreasuryToken { mint, amount, recipient } => (*mint, *amount, *recipient),
        _ => return err!(AyniError::WrongProposalAction),
    };
    require!(amount > 0, AyniError::WrongProposalAction);
    require!(ctx.accounts.mint.key() == mint, AyniError::WalletMismatch);
    require!(ctx.accounts.recipient.key() == recipient, AyniError::WalletMismatch);

    // Spend allowlist (mission control): when enabled, the recipient wallet must
    // be on the allowlist. `config` is seed-bound + init_if_needed, so it can't be
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

    // Mark consumed before the CPI (no re-entrancy / replay window).
    ctx.accounts.proposal.drained = true;

    let decimals = ctx.accounts.mint.decimals;
    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.treasury;
    let seeds: &[&[u8]] = &[b"treasury", circle_key.as_ref(), &[bump]];
    let signer = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.treasury_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.treasury.to_account_info(),
        },
        signer,
    );
    transfer_checked(cpi, amount, decimals)
}

#[derive(Accounts)]
pub struct WithdrawTreasuryToken<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    /// The Circle's policy (its `treasury_allowlist` flag). Seed-bound + created
    /// on first use, so it can't be omitted to dodge an enabled allowlist.
    #[account(
        init_if_needed,
        payer = caller,
        space = CircleConfig::SPACE,
        seeds = [b"config", circle.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// The recipient wallet's allowlist entry — only required when the allowlist
    /// is on.
    #[account(seeds = [b"treasallow", circle.key().as_ref(), recipient.key().as_ref()], bump)]
    pub allow: Option<Account<'info, TreasuryAllow>>,

    /// Must equal the proposal's pinned mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The treasury PDA — signs the transfer.
    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// The treasury's token account for `mint`, owned by the treasury PDA.
    #[account(
        mut,
        token::mint = mint,
        token::authority = treasury,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: must equal the proposal's pinned recipient wallet (the token
    /// account's authority is checked against this below).
    pub recipient: UncheckedAccount<'info>,

    /// The recipient's token account for `mint`.
    #[account(
        mut,
        token::mint = mint,
        token::authority = recipient,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Whoever triggers the (still-permissionless) withdrawal; pays config rent on
    /// first use.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
