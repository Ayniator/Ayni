use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{MaciMessage, MaciRound};

/// Publish an encrypted MACI command (a vote or a key-change) to an open round.
/// Permissionless and append-only: anyone may post, and a voter may post many —
/// the coordinator decides validity and applies last-valid-per-voter at tally
/// time, which is exactly what defeats coercion (a coerced voter can quietly
/// override with a later message or a key-change). The ciphertext is sealed to
/// the round's coordinator and padded to a constant length, so it leaks nothing.
/// PDA: ["macimsg", round, index].
pub fn publish_maci_message(
    ctx: Context<PublishMaciMessage>,
    eph_pubkey: [u8; 32],
    ciphertext: Vec<u8>,
) -> Result<()> {
    require!(!ctx.accounts.round.processed, AyniError::VotingClosed);
    require!(ciphertext.len() == MaciMessage::CT_LEN, AyniError::ProfileFieldTooLong);

    let idx = ctx.accounts.round.message_count;
    let m = &mut ctx.accounts.message;
    m.round = ctx.accounts.round.key();
    m.index = idx;
    m.eph_pubkey = eph_pubkey;
    m.ciphertext = ciphertext;
    m.bump = ctx.bumps.message;

    ctx.accounts.round.message_count = idx.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct PublishMaciMessage<'info> {
    #[account(mut)]
    pub round: Account<'info, MaciRound>,

    #[account(
        init,
        payer = payer,
        space = MaciMessage::SPACE,
        seeds = [b"macimsg", round.key().as_ref(), &round.message_count.to_le_bytes()],
        bump
    )]
    pub message: Account<'info, MaciMessage>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
