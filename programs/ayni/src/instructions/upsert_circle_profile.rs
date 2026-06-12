use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, CircleProfile};

/// Create or update a Circle's public directory profile — the data behind
/// "Find a Circle Near You" and the shared-document links. Any Council seat may
/// set it (group conscience delegates routine directory upkeep to the servants;
/// revocable by rotation). Coordinates are microdegrees (degrees × 1e6). Pass
/// every field each time (the client prefills from the current values); empty
/// CID strings mean "not published yet".
pub fn upsert_circle_profile(
    ctx: Context<UpsertCircleProfile>,
    lat_microdeg: i32,
    lon_microdeg: i32,
    name: String,
    city: String,
    address: String,
    twelve_steps_cid: String,
    preamble_cid: String,
    daily_reflections_cid: String,
) -> Result<()> {
    require!(
        (-90_000_000..=90_000_000).contains(&lat_microdeg)
            && (-180_000_000..=180_000_000).contains(&lon_microdeg),
        AyniError::InvalidCoordinate
    );
    require!(
        CircleProfile::validate(&name, &city, &address, &twelve_steps_cid, &preamble_cid, &daily_reflections_cid),
        AyniError::ProfileFieldTooLong
    );

    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.profile;
    let profile = &mut ctx.accounts.profile;
    profile.circle = circle_key;
    profile.lat_microdeg = lat_microdeg;
    profile.lon_microdeg = lon_microdeg;
    profile.name = name;
    profile.city = city;
    profile.address = address;
    profile.twelve_steps_cid = twelve_steps_cid;
    profile.preamble_cid = preamble_cid;
    profile.daily_reflections_cid = daily_reflections_cid;
    profile.bump = bump;
    Ok(())
}

#[derive(Accounts)]
pub struct UpsertCircleProfile<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = CircleProfile::SPACE,
        seeds = [b"profile", circle.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, CircleProfile>,

    /// Any Council seat (signs + pays).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
