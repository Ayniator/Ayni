use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::state::{MaciRound, MaciState, MACI_STAGE_COMMITTED, MACI_STAGE_PROCESSED};

/// The binding hash over every public input to a MACI outcome:
///
/// ```text
///   H("AHA-maci-tally" ‖ round ‖ chain_digest ‖ signup_digest ‖ signup_count
///                     ‖ yes ‖ no ‖ plaintext_digest)
/// ```
///
/// Mirrored by `maciTallyHash` in `frontend/lib/maci-command.ts` so an auditor
/// recomputes it with the same bytes. Written into both `MaciState.tally_hash`
/// and `MaciRound.tally_hash` (the field that has sat unused since the
/// submission layer shipped).
#[allow(clippy::too_many_arguments)]
#[allow(unused_variables, unreachable_code)]
pub fn maci_tally_hash(
    round: &Pubkey,
    chain_digest: &[u8; 32],
    signup_digest: &[u8; 32],
    signup_count: u64,
    yes: u64,
    no: u64,
    plaintext_digest: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        b"AHA-maci-tally",
        round.as_ref(),
        chain_digest.as_ref(),
        signup_digest.as_ref(),
        &signup_count.to_le_bytes(),
        &yes.to_le_bytes(),
        &no.to_le_bytes(),
        plaintext_digest.as_ref(),
    ])
    .to_bytes()
}

/// The coordinator publishes the result of applying the MACI state machine to
/// the (now frozen, fully folded) queue.
///
/// **Be precise about what this is.** The chain cannot check the arithmetic: the
/// commands are sealed to the coordinator, and proving correct decryption +
/// correct state transitions in zero knowledge needs `process_messages` and
/// `tally` circuits that do not exist and cannot be added without a trusted
/// setup (F44). So this instruction does not verify the tally. It **pins** it:
///
/// * The queue is complete and ordered — `processed_count ==
///   frozen_message_count` against a digest the program itself folded, so the
///   coordinator is tallying every published message and nothing else.
/// * The electorate is fixed — `signup_digest` and `signup_count` come from ZK
///   sign-ups the coordinator never touched, and `yes + no` may not exceed the
///   number of registered voices. Ballots cannot be invented from nothing.
/// * The claim is non-repudiable — `plaintext_digest` commits to the exact
///   sequence of decrypted commands the coordinator says it applied, published
///   *before* anyone can argue about it. A coordinator that later opens the
///   queue (per-message X25519 shared secrets are a self-verifying decryption
///   witness, thanks to the Poly1305 tag) cannot open it to a different story;
///   one that refuses to open it has publicly refused. Either way a wrong tally
///   is provable, and provable by anyone, not just by the members it cheated.
/// * The author is named — only the wallet that opened the round can sign it.
///
/// What remains trusted: a coordinator willing to be caught can still commit a
/// false tally, and members cannot verify their own vote was counted without
/// destroying the receipt-freeness the whole scheme exists for. That is the
/// honest trust delta, and docs/maci.md states it in those words.
///
/// **Because the tally is unverified, its result decides nothing on chain.**
/// `finalize_maci_round` records the outcome in `MaciState` and never touches
/// `MemberProposal.passed`, so no coordinator's claim can reach
/// `install_elected_seat` or `refill_faucet` (Sentinel
/// NRR-2026-08-12-f60-f61-maci, CRITICAL — the escalation path is severed at the
/// consumer, which is stronger than disabling this instruction: it also stops a
/// future re-enable from silently reopening it). Wiring a MACI result to an
/// automatic consequence is gated on F44's ZK-verified tally.
///
/// # DISABLED ON CHAIN (Sentinel NRR-2026-08-12-f60-f61-maci, CRITICAL)
///
/// Two independent things now stand between an unverified tally and a
/// consequence, and **both must hold**:
///
/// 1. *This guard.* The handler refuses outright with `MaciTallyUnverified`, so
///    no tally can be committed at all until a ZK-verified tally ships (F44).
///    The body below is kept intact so re-enabling is a deletion, not a rewrite,
///    and accounts/layouts/IDL are untouched so it is not a migration either.
/// 2. *The severed consumer.* `finalize_maci_round` records the outcome only in
///    `MaciState` and never writes `MemberProposal.passed`, so even with this
///    guard removed, a coordinator's claim cannot reach `install_elected_seat`
///    or `refill_faucet`.
///
/// Do NOT remove either one to make a test or a demo pass. `tests/maci.ts`
/// asserts both, and will fail if the guard disappears.
#[allow(unused_variables, unreachable_code)]
pub fn commit_maci_tally(
    ctx: Context<CommitMaciTally>,
    yes: u64,
    no: u64,
    plaintext_digest: [u8; 32],
) -> Result<()> {
    return Err(AyniError::MaciTallyUnverified.into());
    let round_key = ctx.accounts.round.key();
    let state = &mut ctx.accounts.state;

    require!(
        state.stage == MACI_STAGE_PROCESSED,
        AyniError::MaciWrongStage
    );
    require!(
        state.processed_count == state.frozen_message_count,
        AyniError::MaciQueueIncomplete
    );
    require_keys_eq!(
        ctx.accounts.coordinator.key(),
        state.coordinator_authority,
        AyniError::Unauthorized
    );
    require!(
        yes.saturating_add(no) <= state.signup_count,
        AyniError::MaciTallyExceedsSignups
    );

    let hash = maci_tally_hash(
        &round_key,
        &state.chain_digest,
        &state.signup_digest,
        state.signup_count,
        yes,
        no,
        &plaintext_digest,
    );

    state.tally_yes = yes;
    state.tally_no = no;
    state.plaintext_digest = plaintext_digest;
    state.tally_hash = hash;
    state.committed_at = Clock::get()?.unix_timestamp;
    state.stage = MACI_STAGE_COMMITTED;

    ctx.accounts.round.tally_hash = hash;
    Ok(())
}

#[derive(Accounts)]
pub struct CommitMaciTally<'info> {
    #[account(mut)]
    pub round: Account<'info, MaciRound>,

    #[account(
        mut,
        seeds = [b"macistate", round.key().as_ref()],
        bump = state.bump,
        has_one = round
    )]
    pub state: Account<'info, MaciState>,

    /// Must be the wallet that opened the round (`MaciState.coordinator_authority`).
    pub coordinator: Signer<'info>,
}
