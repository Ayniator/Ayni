use anchor_lang::prelude::*;

use crate::council::{ProposalAction, Proposal};
use crate::errors::AyniError;
use crate::state::{Circle, Membership};

/// Rebind a membership's `owner` from the migrated-away wallet to the new one,
/// authorized by an executed 4-of-7 `MigrateWallet` proposal. Call once per
/// membership belonging to the lost wallet — together with `execute_proposal`
/// (which rebinds Council seats), this completes "migrate all artifacts".
///
/// If the membership has `require_cosign`, the Council cannot do this alone: a
/// signature from the member's `owner` or `recovery_key` is also required, so no
/// Council majority can seize an opted-in member's standing.
pub fn recover_membership(ctx: Context<RecoverMembership>) -> Result<()> {
    let proposal = &ctx.accounts.proposal;
    require!(proposal.executed, AyniError::ThresholdNotMet);

    let (old_wallet, new_wallet) = match &proposal.action {
        ProposalAction::MigrateWallet { old_wallet, new_wallet } => (*old_wallet, *new_wallet),
        _ => return err!(AyniError::WrongProposalAction),
    };

    let membership = &mut ctx.accounts.membership;
    require!(membership.owner == old_wallet, AyniError::WalletMismatch);

    if membership.require_cosign {
        let signer = ctx
            .accounts
            .member_authority
            .as_ref()
            .ok_or(error!(AyniError::MemberCosignRequired))?;
        require!(
            membership.is_member_key(&signer.key()),
            AyniError::MemberCosignRequired
        );
    }

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

    /// Required only when `membership.require_cosign`: the member's `owner` or
    /// `recovery_key`. Omitted (None) for council-only recovery.
    pub member_authority: Option<Signer<'info>>,

    pub payer: Signer<'info>,
}
