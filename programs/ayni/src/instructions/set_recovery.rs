use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Membership;

/// Member configures their own recovery: set/rotate the guardian `recovery_key`
/// and toggle the `require_cosign` policy. Must be signed by a key the member
/// already controls (`owner` or the current `recovery_key`). For a brand-new
/// anonymous membership with no keys set, the guardian is seeded at issuance via
/// `issue_membership` instead.
pub fn set_recovery(
    ctx: Context<SetRecovery>,
    recovery_key: Pubkey,
    require_cosign: bool,
) -> Result<()> {
    let membership = &mut ctx.accounts.membership;
    require!(
        membership.is_member_key(&ctx.accounts.member_authority.key()),
        AyniError::Unauthorized
    );
    membership.recovery_key = recovery_key;
    membership.require_cosign = require_cosign;
    Ok(())
}

#[derive(Accounts)]
pub struct SetRecovery<'info> {
    #[account(mut)]
    pub membership: Account<'info, Membership>,

    /// The member's current `owner` or `recovery_key`.
    pub member_authority: Signer<'info>,
}
