use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Membership;

/// Owner self-migration: the member rebinds their OWN membership `owner` to a
/// new wallet — no Council vote, no time-lock, because the current owner
/// personally authorizes it (no collusion possible). The guardian `recovery_keys`
/// are left intact.
///
/// SECURITY (mirrors `set_recovery`): when an `owner` is set, ONLY the owner may
/// call this. A lone guardian must NOT be able to instantly seize `owner` here —
/// otherwise one stolen backup key hijacks an active membership and then rewrites
/// the guardian set via `set_recovery` (which already gates on owner). Guardian-
/// mediated recovery of a genuinely lost owner goes through the contestable,
/// time-locked Council path `recover_membership` (with the member's cosignature
/// when `require_cosign`), not through this instant path. A fully-anonymous
/// membership (owner == default) has no stronger key, so any member key may seed
/// its owner.
pub fn member_migrate(ctx: Context<MemberMigrate>, new_owner: Pubkey) -> Result<()> {
    let membership = &mut ctx.accounts.membership;
    let who = ctx.accounts.member_authority.key();
    if membership.owner != Pubkey::default() {
        require!(who == membership.owner, AyniError::Unauthorized);
    } else {
        require!(membership.is_member_key(&who), AyniError::Unauthorized);
    }
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
