use anchor_lang::prelude::*;

use crate::council::{ProposalAction, Proposal};
use crate::errors::AyniError;
use crate::state::{Circle, Membership};

/// Rebind a membership's `owner` from the migrated-away wallet to the new one,
/// authorized by an executed 4-of-7 `MigrateWallet` proposal. Call once per
/// membership belonging to the lost wallet — together with `execute_proposal`
/// (which rebinds Council seats), this completes "migrate all artifacts".
pub fn recover_membership(ctx: Context<RecoverMembership>) -> Result<()> {
    let proposal = &ctx.accounts.proposal;
    require!(proposal.executed, AyniError::ThresholdNotMet);

    let (old_wallet, new_wallet) = match &proposal.action {
        ProposalAction::MigrateWallet { old_wallet, new_wallet } => (*old_wallet, *new_wallet),
        _ => return err!(AyniError::WrongProposalAction),
    };

    let membership = &mut ctx.accounts.membership;
    require!(membership.owner == old_wallet, AyniError::WalletMismatch);
    membership.owner = new_wallet;
    Ok(())
}

#[derive(Accounts)]
pub struct RecoverMembership<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut, has_one = circle)]
    pub membership: Account<'info, Membership>,

    pub payer: Signer<'info>,
}
