use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, CircleProfile};

/// Update only a Circle's **location** — coordinates (microdegrees), city, and
/// street address — on its existing directory profile. The Circle's `name` and
/// its IPFS document CIDs are left untouched, so a Circle that relocates doesn't
/// have to re-send everything (unlike the full `upsert_circle_profile`).
///
/// By design this is an **overwrite, not an append**: no history of past
/// locations is kept on-chain. Any Council seat may move the Circle.
pub fn update_circle_location(
    ctx: Context<UpdateCircleLocation>,
    lat_microdeg: i32,
    lon_microdeg: i32,
    city: String,
    address: String,
) -> Result<()> {
    require!(
        (-90_000_000..=90_000_000).contains(&lat_microdeg)
            && (-180_000_000..=180_000_000).contains(&lon_microdeg),
        AyniError::InvalidCoordinate
    );
    require!(
        city.len() <= CircleProfile::MAX_CITY && address.len() <= CircleProfile::MAX_ADDRESS,
        AyniError::ProfileFieldTooLong
    );

    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let profile = &mut ctx.accounts.profile;
    profile.lat_microdeg = lat_microdeg;
    profile.lon_microdeg = lon_microdeg;
    profile.city = city;
    profile.address = address;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateCircleLocation<'info> {
    pub circle: Account<'info, Circle>,

    /// The Circle's directory profile — must already exist (created via
    /// `upsert_circle_profile`). `has_one = circle` ties it to this Circle.
    #[account(
        mut,
        has_one = circle,
        seeds = [b"profile", circle.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, CircleProfile>,

    /// Any Council seat may relocate the Circle.
    pub seat: Signer<'info>,
}
