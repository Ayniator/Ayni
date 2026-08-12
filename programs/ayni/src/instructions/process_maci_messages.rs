use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::Discriminator;

use crate::errors::AyniError;
use crate::state::{
    MaciMessage, MaciRound, MaciState, MACI_MESSAGE_DATA_LEN, MACI_MSG_OFF_BUMP, MACI_MSG_OFF_CT,
    MACI_MSG_OFF_CTLEN, MACI_MSG_OFF_EPH, MACI_MSG_OFF_INDEX, MACI_MSG_OFF_ROUND,
    MACI_PROCESS_MAX_BATCH, MACI_STAGE_CLOSED, MACI_STAGE_PROCESSED,
};

/// Fold the next batch of sealed commands into the round's message chain.
///
/// This is the part of MACI processing that a chain **can** do without being
/// able to read the messages, and it is the part that matters most for
/// soundness. The program walks the `MaciMessage` PDAs in strict ascending index
/// order starting at `state.processed_count`, checks each one really is this
/// round's message at that index, and folds it into
///
/// ```text
///   chain_digest ← H(chain_digest ‖ index ‖ eph_pubkey ‖ ciphertext)
/// ```
///
/// What that buys, enforced by the program and not by anyone's honesty:
///
/// * **No replay.** A message can only be folded when its index equals
///   `processed_count`, and `processed_count` only ever advances. Feeding the
///   same account twice, or re-running a finished batch, fails.
/// * **No reordering.** The batch must be contiguous and ascending; the digest
///   is order-sensitive, so any other order yields a different, visible value.
/// * **No censoring and no stuffing.** The round is frozen first
///   (`close_maci_round`), and `commit_maci_tally` refuses unless
///   `processed_count == frozen_message_count` — every published message, and
///   only published messages, is inside the digest the tally commits to.
///
/// What it does NOT do: read the commands. They are sealed to the coordinator,
/// so the *semantics* (whose key, which vote, which key-change wins) are applied
/// off chain — see `commit_maci_tally` and docs/maci.md for exactly how far that
/// is trusted.
///
/// Permissionless crank: the coordinator has no special role here, and anyone
/// can drive the round to a processed state.
///
/// The message accounts arrive in `remaining_accounts` and are read as raw
/// bytes — never deserialized into a stack local — because a batch of them would
/// otherwise blow the 4 KiB SBF stack frame.
pub fn process_maci_messages(ctx: Context<ProcessMaciMessages>, count: u32) -> Result<()> {
    let round_key = ctx.accounts.round.key();
    let state = &mut ctx.accounts.state;
    require!(state.stage == MACI_STAGE_CLOSED, AyniError::MaciWrongStage);

    let n = ctx.remaining_accounts.len();
    require!(n as u64 == count as u64, AyniError::MaciMessageMismatch);
    require!(
        n > 0 && n <= MACI_PROCESS_MAX_BATCH,
        AyniError::MaciBatchTooLarge
    );
    require!(
        state.processed_count.saturating_add(n as u64) <= state.frozen_message_count,
        AyniError::MaciBatchTooLarge
    );

    let program_id = crate::ID;
    let round_bytes = round_key.to_bytes();
    let mut digest = state.chain_digest;
    let mut index = state.processed_count;

    for info in ctx.remaining_accounts.iter() {
        require_keys_eq!(*info.owner, program_id, AyniError::MaciMessageMismatch);
        let data = info.try_borrow_data()?;
        require!(
            data.len() == MACI_MESSAGE_DATA_LEN,
            AyniError::MaciMessageMismatch
        );
        require!(
            data[..8] == *MaciMessage::DISCRIMINATOR,
            AyniError::MaciMessageMismatch
        );
        require!(
            data[MACI_MSG_OFF_ROUND..MACI_MSG_OFF_ROUND + 32] == round_bytes,
            AyniError::MaciMessageMismatch
        );

        let mut idx_le = [0u8; 8];
        idx_le.copy_from_slice(&data[MACI_MSG_OFF_INDEX..MACI_MSG_OFF_INDEX + 8]);
        require!(
            u64::from_le_bytes(idx_le) == index,
            AyniError::MaciMessageMismatch
        );

        let mut len_le = [0u8; 4];
        len_le.copy_from_slice(&data[MACI_MSG_OFF_CTLEN..MACI_MSG_OFF_CTLEN + 4]);
        require!(
            u32::from_le_bytes(len_le) as usize == MaciMessage::CT_LEN,
            AyniError::MaciMessageMismatch
        );

        // Belt and braces: the account really is the canonical ["macimsg", round,
        // index] PDA, so a program-owned look-alike cannot be substituted.
        let expected = Pubkey::create_program_address(
            &[
                b"macimsg",
                round_bytes.as_ref(),
                idx_le.as_ref(),
                &[data[MACI_MSG_OFF_BUMP]],
            ],
            &program_id,
        )
        .map_err(|_| error!(AyniError::MaciMessageMismatch))?;
        require_keys_eq!(*info.key, expected, AyniError::MaciMessageMismatch);

        digest = hashv(&[
            &digest,
            &idx_le,
            &data[MACI_MSG_OFF_EPH..MACI_MSG_OFF_EPH + 32],
            &data[MACI_MSG_OFF_CT..MACI_MSG_OFF_CT + MaciMessage::CT_LEN],
        ])
        .to_bytes();
        index = index.saturating_add(1);
    }

    state.chain_digest = digest;
    state.processed_count = index;
    if state.processed_count == state.frozen_message_count {
        state.stage = MACI_STAGE_PROCESSED;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ProcessMaciMessages<'info> {
    pub round: Account<'info, MaciRound>,

    #[account(
        mut,
        seeds = [b"macistate", round.key().as_ref()],
        bump = state.bump,
        has_one = round
    )]
    pub state: Account<'info, MaciState>,

    /// Permissionless crank.
    pub caller: Signer<'info>,
    // remaining_accounts: the next `count` MaciMessage PDAs, ascending by index.
}
