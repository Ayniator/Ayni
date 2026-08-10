use anchor_lang::prelude::*;

use crate::council::SEAT_TREASURER;
use crate::errors::AyniError;
use crate::state::{Circle, FaucetJar, FAUCET_MAX_GRANT_LAMPORTS};

/// The Treasurer seat tunes the faucet's per-grant amount — within the absolute
/// cap the program itself enforces (`FAUCET_MAX_GRANT_LAMPORTS`), never above it
/// (Epic 0: the treasurer adjusts within the on-chain maximum, the UI enforces
/// nothing). Only the Treasurer; a trusted servant, not a governor — refills
/// still require a member vote.
///
/// The change is stamped with the current time and grants pause for
/// `FAUCET_AMOUNT_COOLDOWN`, so a new amount always applies to the whole circle
/// rather than to whoever happens to activate next.
pub fn set_faucet_amount(ctx: Context<SetFaucetAmount>, lamports: u64) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_seat(&ctx.accounts.treasurer.key(), SEAT_TREASURER)?;
    require!(
        lamports > 0 && lamports <= FAUCET_MAX_GRANT_LAMPORTS,
        AyniError::FaucetCapExceeded
    );
    let jar = &mut ctx.accounts.jar;
    // A no-op rewrite must not silently re-arm the cooldown (nor let a Treasurer
    // stall the faucet by resubmitting the same number).
    if jar.grant_lamports != lamports {
        jar.grant_lamports = lamports;
        jar.amount_changed_at = Clock::get()?.unix_timestamp;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct SetFaucetAmount<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle, seeds = [b"faucet", circle.key().as_ref()], bump = jar.bump)]
    pub jar: Account<'info, FaucetJar>,

    /// The Treasurer seat (seat 0).
    pub treasurer: Signer<'info>,
}
