use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Membership;

/// Member configures their own recovery: set/rotate the (up to two) guardian
/// `recovery_keys` and toggle the `require_cosign` policy. Must be signed by a
/// key the member already controls (`owner` or a current guardian). For a
/// brand-new anonymous membership with no keys set, guardians are seeded at
/// issuance via `issue_membership` instead.
pub fn set_recovery(
    ctx: Context<SetRecovery>,
    recovery_keys: [Pubkey; Membership::MAX_GUARDIANS],
    require_cosign: bool,
) -> Result<()> {
    let membership = &mut ctx.accounts.membership;
    let who = ctx.accounts.member_authority.key();

    // Rewriting guardians and toggling `require_cosign` is the highest-privilege
    // membership action: a guardian able to do it could overwrite the OTHER
    // guardians and flip `require_cosign` on to block the Council's recovery
    // fallback — so a single stolen *backup* key could permanently hijack the
    // membership. Therefore when an `owner` is set, ONLY the owner may call this.
    // A fully-anonymous membership (owner == default) has no stronger key, so any
    // guardian may seed/rotate its recovery config.
    if membership.owner != Pubkey::default() {
        require!(who == membership.owner, AyniError::Unauthorized);
    } else {
        require!(membership.is_member_key(&who), AyniError::Unauthorized);
    }

    membership.recovery_keys = recovery_keys;
    membership.require_cosign = require_cosign;
    Ok(())
}

#[derive(Accounts)]
pub struct SetRecovery<'info> {
    #[account(mut)]
    pub membership: Account<'info, Membership>,

    /// The member's current `owner` or a guardian `recovery_key`.
    pub member_authority: Signer<'info>,
}
