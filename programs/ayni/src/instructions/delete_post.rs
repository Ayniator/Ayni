use anchor_lang::prelude::*;

use crate::state::{Circle, Post};

/// Delete a post. Moderation by group conscience: ANY of the 7 Council seats may
/// remove ANY post at any time (the rent is refunded to the acting seat). The
/// `Post` account is closed.
pub fn delete_post(ctx: Context<DeletePost>) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;
    Ok(())
}

#[derive(Accounts)]
pub struct DeletePost<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle, close = seat)]
    pub post: Account<'info, Post>,

    #[account(mut)]
    pub seat: Signer<'info>,
}
