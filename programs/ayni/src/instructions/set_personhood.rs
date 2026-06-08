use anchor_lang::prelude::*;

use crate::state::Circle;

/// Configure the Circle's sybil gate: turn proof-of-personhood on/off and set the
/// unique-human Merkle root (a World ID group root, or a Circle vouching set).
/// Authority-gated (the same governance address that bootstraps the Circle).
pub fn set_personhood(
    ctx: Context<SetPersonhood>,
    require_personhood: bool,
    personhood_root: [u8; 32],
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    circle.require_personhood = require_personhood;
    circle.personhood_root = personhood_root;
    Ok(())
}

#[derive(Accounts)]
pub struct SetPersonhood<'info> {
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,
    pub authority: Signer<'info>,
}
