use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, FederationChild};

/// F56 — a foundation Council seat vouches that `circle` is a genuine member of
/// its federation, so its member root may be anchored (`publish_member_root`)
/// and its members may verify to sibling hosts (`verify_fellow_member`). This
/// is the consent that `circle.parent == foundation` alone cannot provide:
/// creating a circle is permissionless and `parent` is self-claimed, so the
/// foundation must actively approve a child before the federation trusts it.
///
/// The parentage constraint stays as a guard (a foundation only ever approves
/// a circle that at least names it as parent), but the SIGNATURE of a foundation
/// seat is the real gate. Revocable by closing this account (rent → the seat).
pub fn approve_federation_child(ctx: Context<ApproveFederationChild>) -> Result<()> {
    ctx.accounts
        .foundation
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let entry = &mut ctx.accounts.federation_child;
    entry.foundation = ctx.accounts.foundation.key();
    entry.circle = ctx.accounts.circle.key();
    entry.approved_at = Clock::get()?.unix_timestamp;
    entry.bump = ctx.bumps.federation_child;
    Ok(())
}

#[derive(Accounts)]
pub struct ApproveFederationChild<'info> {
    pub foundation: Account<'info, Circle>,

    /// The child to admit — must at least name this foundation as parent.
    #[account(
        constraint = circle.key() == foundation.key()
            || circle.parent == foundation.key() @ AyniError::Unauthorized
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = seat,
        space = FederationChild::SPACE,
        seeds = [b"fedchild", foundation.key().as_ref(), circle.key().as_ref()],
        bump
    )]
    pub federation_child: Account<'info, FederationChild>,

    /// A foundation Council seat — the consent that makes federation real.
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
