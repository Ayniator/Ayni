use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::state::{
    MaciRound, MaciState, MACI_STAGE_CLOSED, MACI_STAGE_OPEN, MACI_STAGE_PROCESSED,
};

/// Seed of the on-chain message chain: `H("AHA-maci-chain" || round)`. Mirrored
/// by `maciChainSeed` in `frontend/lib/maci-command.ts`.
pub fn maci_chain_seed(round: &Pubkey) -> [u8; 32] {
    hashv(&[b"AHA-maci-chain", round.as_ref()]).to_bytes()
}

/// Freeze the round at its deadline: no more sign-ups, no more sealed commands,
/// and the message count is snapshotted so the set the tally covers is fixed
/// before anybody starts folding it.
///
/// Permissionless on purpose — the coordinator must not be able to hold the
/// queue open (to keep collecting overrides after learning the standing) or shut
/// it early (to censor a late override). Anyone may close it the moment the
/// proposal's deadline passes, and nobody may close it before.
///
/// The freeze is implemented by setting `MaciRound.processed`, which is the flag
/// `publish_maci_message` already refuses on. That instruction is byte-for-byte
/// unchanged, which matters: it is on the relayer allowlist by discriminator,
/// account count and data length.
pub fn close_maci_round(ctx: Context<CloseMaciRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let state = &mut ctx.accounts.state;
    require!(state.stage == MACI_STAGE_OPEN, AyniError::MaciWrongStage);
    require!(now >= state.msg_deadline, AyniError::VotingNotEnded);

    let round = &mut ctx.accounts.round;
    round.processed = true;

    state.frozen_message_count = round.message_count;
    state.processed_count = 0;
    state.chain_digest = maci_chain_seed(&round.key());
    // An empty queue is already fully processed — `process_maci_messages`
    // refuses an empty batch, so nothing would ever move it on.
    state.stage = if state.frozen_message_count == 0 {
        MACI_STAGE_PROCESSED
    } else {
        MACI_STAGE_CLOSED
    };
    Ok(())
}

#[derive(Accounts)]
pub struct CloseMaciRound<'info> {
    #[account(mut)]
    pub round: Account<'info, MaciRound>,

    #[account(
        mut,
        seeds = [b"macistate", round.key().as_ref()],
        bump = state.bump,
        has_one = round
    )]
    pub state: Account<'info, MaciState>,

    /// Anyone may close the round once the deadline has passed.
    pub caller: Signer<'info>,
}
