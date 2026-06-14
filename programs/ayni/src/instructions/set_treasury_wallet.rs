use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token::state::Multisig as SplMultisig;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::{Circle, TreasuryConfig};

/// Token-2022 program id. Its `Multisig` account layout is byte-identical to the
/// classic SPL Token `Multisig`, so we unpack both with the same parser; we only
/// need to accept either owning program.
const TOKEN_2022_ID: Pubkey = anchor_lang::solana_program::pubkey!(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/// The Circle treasury must be stewarded by a **multisig**, never a single key
/// (Tradition 7 — the fellowship's money is held in common, not by one person).
/// We require an on-chain SPL Token `Multisig` (m-of-n) with a real threshold:
/// owned by the SPL Token (or Token-2022) program, initialized, and m ≥ 2, n ≥ m.
/// See docs/multisig.md. The account is passed in and checked here at apply time
/// (the proposal only carried the pubkey).
fn require_multisig(acc: &AccountInfo) -> Result<()> {
    require!(
        acc.owner == &anchor_spl::token::ID || acc.owner == &TOKEN_2022_ID,
        AyniError::TreasuryNotMultisig
    );
    let data = acc.try_borrow_data()?;
    let ms = SplMultisig::unpack(&data).map_err(|_| error!(AyniError::TreasuryNotMultisig))?;
    require!(ms.is_initialized, AyniError::TreasuryNotMultisig);
    // m-of-n with a genuine threshold: at least 2 required signers, and the
    // configured signer set must be able to satisfy it (n ≥ m).
    require!(ms.m >= 2 && ms.n >= ms.m, AyniError::TreasuryNotMultisig);
    Ok(())
}

/// Apply an executed 4-of-7 `SetTreasuryWallet` proposal: write the new treasury
/// steward wallet into the Circle's `TreasuryConfig`. Mirrors `withdraw_treasury`
/// — the contestable, time-locked proposal authorizes; this carries it out.
/// Permissionless to trigger once authorized; one-shot per proposal. The new
/// wallet MUST be a multisig (verified here).
pub fn set_treasury_wallet(ctx: Context<SetTreasuryWallet>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.executed, AyniError::ThresholdNotMet);
    require!(!proposal.drained, AyniError::AlreadyExecuted);

    let new_wallet = match &proposal.action {
        ProposalAction::SetTreasuryWallet { new_wallet } => *new_wallet,
        _ => return err!(AyniError::WrongProposalAction),
    };
    require!(new_wallet != Pubkey::default(), AyniError::WalletMismatch);

    // The passed account must be exactly the wallet the Council voted for, and it
    // must be a real multisig. (Validating at apply time keeps `propose` cheap and
    // lets the check see the actual account state.)
    require_keys_eq!(ctx.accounts.multisig.key(), new_wallet, AyniError::WalletMismatch);
    require_multisig(&ctx.accounts.multisig)?;

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

    /// CHECK: the proposed treasury steward wallet. Validated in the handler to be
    /// the exact pubkey the Council voted for AND an initialized SPL Token / Token-2022
    /// multisig (m ≥ 2). Not deserialized as a typed account so either token program's
    /// multisig is accepted.
    pub multisig: UncheckedAccount<'info>,

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
