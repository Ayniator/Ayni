use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Membership, WingPeer};

/// End a WingPeer relationship — either party may end it (the mentee or the
/// wing). The signer passes the membership they control; it must be one of the
/// two in the pairing. Sets `active = false` (the record is kept).
pub fn end_wing_peer(ctx: Context<EndWingPeer>) -> Result<()> {
    require!(
        ctx.accounts
            .membership
            .is_member_key(&ctx.accounts.signer.key()),
        AyniError::Unauthorized
    );
    let c = ctx.accounts.membership.commitment;
    require!(
        c == ctx.accounts.wing_peer.mentee || c == ctx.accounts.wing_peer.wing,
        AyniError::Unauthorized
    );
    ctx.accounts.wing_peer.active = false;
    Ok(())
}

#[derive(Accounts)]
pub struct EndWingPeer<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub wing_peer: Account<'info, WingPeer>,

    /// The membership the signer controls — must be the mentee or the wing.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Account<'info, Membership>,

    pub signer: Signer<'info>,
}
