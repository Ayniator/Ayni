use anchor_lang::prelude::*;

use crate::state::{Circle, ServantRole};

pub fn appoint_servant(
    ctx: Context<AppointServant>,
    role: ServantRole,
    servant: Pubkey,
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    match role {
        ServantRole::Treasurer => circle.treasurer = servant,
        ServantRole::Secretary => circle.secretary = servant,
        ServantRole::RhythmKeeper => circle.rhythm_keeper = servant,
    }
    // Servants rotate: re-appointing simply overwrites the previous holder.
    Ok(())
}

#[derive(Accounts)]
pub struct AppointServant<'info> {
    /// `authority` is normally the Circle's governance PDA, so appointments
    /// flow from group conscience (a Realms vote), not a single person.
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,
    pub authority: Signer<'info>,
}
