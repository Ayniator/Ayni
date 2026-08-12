use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{
    Circle, MaciRound, MaciState, MemberProposal, MACI_MAX_CHALLENGE_SECS, MACI_STAGE_OPEN,
};

/// Open a MACI round over a member proposal: register the coordinator's
/// encryption key so voters can publish sealed (receipt-free) commands, and
/// create the round's lifecycle account. Any Council seat opens it.
/// PDAs: ["maci", proposal] and ["macistate", round].
///
/// **Opening a round takes the proposal off the plain ballot path.** The member
/// proposal is marked `finalized` immediately, which makes `cast_vote` and
/// `finalize_member_proposal` refuse it: from here the group conscience for this
/// proposal is recorded by `finalize_maci_round` and nothing else. Without that,
/// the same member could both sign up for MACI and cast a plain ballot (the two
/// use different external nullifiers, so neither PDA blocks the other), and a
/// premature `finalize_member_proposal` could record an outcome from the plain
/// counters while the sealed queue was still being tallied. The proposal must
/// therefore carry **no** ballots yet — a round cannot be opened to discard
/// votes already cast.
///
/// Note the intermediate state this creates: between `open_maci_round` and
/// `finalize_maci_round` the proposal reads `finalized = true, passed = false`.
/// Consumers of a MACI proposal (e.g. `install_elected_seat`) correctly refuse
/// to act until the MACI outcome is written, which is the fail-closed direction.
///
/// `challenge_secs` is the dispute window between the coordinator committing a
/// tally and the outcome landing on the proposal (see docs/maci.md). 24 h is the
/// recommended value; 0 is permitted but forfeits the window, and a Circle that
/// chooses it is trusting its coordinator with no time to be contradicted.
pub fn open_maci_round(
    ctx: Context<OpenMaciRound>,
    coordinator: [u8; 32],
    challenge_secs: i64,
) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    require!(
        (0..=MACI_MAX_CHALLENGE_SECS).contains(&challenge_secs),
        AyniError::InvalidTimelock
    );

    let proposal = &mut ctx.accounts.proposal;
    require!(!proposal.finalized, AyniError::AlreadyFinalized);
    require!(
        proposal.yes == 0 && proposal.no == 0,
        AyniError::MaciProposalAlreadyVoted
    );
    require!(
        Clock::get()?.unix_timestamp < proposal.deadline,
        AyniError::VotingClosed
    );

    let r = &mut ctx.accounts.round;
    r.circle = ctx.accounts.circle.key();
    r.proposal = proposal.key();
    r.coordinator = coordinator;
    r.message_count = 0;
    r.processed = false;
    r.tally_hash = [0u8; 32];
    r.bump = ctx.bumps.round;

    let s = &mut ctx.accounts.state;
    s.round = r.key();
    s.proposal = proposal.key();
    s.circle = ctx.accounts.circle.key();
    s.coordinator_authority = ctx.accounts.seat.key();
    s.msg_deadline = proposal.deadline;
    s.challenge_secs = challenge_secs;
    s.signup_count = 0;
    s.frozen_message_count = 0;
    s.processed_count = 0;
    s.chain_digest = [0u8; 32];
    s.signup_digest = [0u8; 32];
    s.tally_yes = 0;
    s.tally_no = 0;
    s.plaintext_digest = [0u8; 32];
    s.tally_hash = [0u8; 32];
    s.committed_at = 0;
    s.stage = MACI_STAGE_OPEN;
    s.passed = false;
    s.bump = ctx.bumps.state;

    // Close the plain ballot path for good (see the doc-comment above).
    proposal.finalized = true;
    proposal.passed = false;
    Ok(())
}

#[derive(Accounts)]
pub struct OpenMaciRound<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, MemberProposal>,

    #[account(
        init,
        payer = seat,
        space = MaciRound::SPACE,
        seeds = [b"maci", proposal.key().as_ref()],
        bump
    )]
    pub round: Account<'info, MaciRound>,

    #[account(
        init,
        payer = seat,
        space = MaciState::SPACE,
        seeds = [b"macistate", round.key().as_ref()],
        bump
    )]
    pub state: Account<'info, MaciState>,

    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
