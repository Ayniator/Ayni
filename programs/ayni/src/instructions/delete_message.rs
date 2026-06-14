use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Message;

/// Delete a message (reclaim its rent). The sender or recipient may delete it
/// anytime; once expired, anyone may clean it up.
pub fn delete_message(ctx: Context<DeleteMessage>) -> Result<()> {
    let m = &ctx.accounts.message;
    let who = ctx.accounts.signer.key();
    let now = Clock::get()?.unix_timestamp;
    let expired = m.expires_at != 0 && now >= m.expires_at;
    require!(who == m.sender || who == m.recipient || expired, AyniError::Unauthorized);
    Ok(())
}

#[derive(Accounts)]
pub struct DeleteMessage<'info> {
    #[account(mut, close = rent_to)]
    pub message: Account<'info, Message>,

    /// CHECK: receives the reclaimed rent.
    #[account(mut)]
    pub rent_to: UncheckedAccount<'info>,

    pub signer: Signer<'info>,
}
