use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Membership;

/// Self-recovery: a member who still controls a key (`owner` or `recovery_key`)
/// migrates their own membership `owner` to a new wallet — no Council vote, no
/// time-lock, because the member personally authorizes it (no collusion
/// possible). The guardian `recovery_key` is left intact.
pub fn member_migrate(ctx: Context<MemberMigrate>, new_owner: Pubkey) -> Result<()> {
    let membership = &mut ctx.accounts.membership;
    require!(
        membership.is_member_key(&ctx.accounts.member_authority.key()),
        AyniError::Unauthorized
    );
    membership.owner = new_owner;
    Ok(())
}

#[derive(Accounts)]
pub struct MemberMigrate<'info> {
    #[account(mut)]
    pub membership: Account<'info, Membership>,

    /// The member's current `owner` or `recovery_key`.
    pub member_authority: Signer<'info>,
}
