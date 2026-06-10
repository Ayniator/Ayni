use anchor_lang::prelude::*;

use crate::council::SEAT_SECRETARY;
use crate::state::Circle;

/// Configure the Circle's sybil gate: turn proof-of-personhood on/off and set the
/// unique-human Merkle root (a World ID group root, or a Circle vouching set).
/// Set by the **Secretary** seat (membership policy is the Secretary's domain).
pub fn set_personhood(
    ctx: Context<SetPersonhood>,
    require_personhood: bool,
    personhood_root: [u8; 32],
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    circle
        .council
        .require_seat(&ctx.accounts.secretary.key(), SEAT_SECRETARY)?;
    circle.require_personhood = require_personhood;
    circle.personhood_root = personhood_root;
    Ok(())
}

#[derive(Accounts)]
pub struct SetPersonhood<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    /// Must be the Council's Secretary seat.
    pub secretary: Signer<'info>,
}
