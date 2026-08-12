use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::instructions::finalize_member_proposal::member_vote_outcome;
use crate::state::{
    CircleConfig, MaciRound, MaciState, MemberProposal, MACI_STAGE_COMMITTED, MACI_STAGE_FINALIZED,
};

/// Write the MACI outcome onto the member proposal, once the dispute window has
/// elapsed.
///
/// The policy math is **the same function** the plain ballot path uses —
/// `member_vote_outcome` from `finalize_member_proposal`, against the same
/// `CircleConfig` quorum and pass thresholds and the same `eligible_count`
/// snapshot. A Circle does not get a laxer conscience for voting in sealed mode:
/// turnout still has to clear the quorum over the whole eligible set, and the
/// yes-share still has to clear the pass threshold.
///
/// Only the MACI counters are used. The proposal's own `yes`/`no` are structurally
/// zero — `open_maci_round` refuses a proposal that already carries ballots and
/// closes the plain path behind it — so there is nothing to add and no way for
/// the two tallies to be double-counted or played against each other.
///
/// Permissionless: once the window has passed, anyone may land the outcome. The
/// coordinator cannot sit on an unfavourable result.
pub fn finalize_maci_round(ctx: Context<FinalizeMaciRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let state = &mut ctx.accounts.state;

    require!(
        state.stage == MACI_STAGE_COMMITTED,
        AyniError::MaciWrongStage
    );
    require!(
        now >= state.committed_at.saturating_add(state.challenge_secs),
        AyniError::MaciChallengeWindow
    );
    require!(now >= state.msg_deadline, AyniError::VotingNotEnded);

    let cfg = &ctx.accounts.config;
    let passed = member_vote_outcome(
        state.tally_yes,
        state.tally_no,
        ctx.accounts.proposal.eligible_count,
        cfg.vote_quorum_num as u64,
        cfg.vote_quorum_den as u64,
        cfg.vote_pass_num as u128,
        cfg.vote_pass_den as u128,
    );

    state.passed = passed;
    state.stage = MACI_STAGE_FINALIZED;

    let p = &mut ctx.accounts.proposal;
    p.passed = passed;
    p.finalized = true; // already true since open_maci_round; kept explicit.
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeMaciRound<'info> {
    #[account(has_one = proposal)]
    pub round: Account<'info, MaciRound>,

    #[account(
        mut,
        seeds = [b"macistate", round.key().as_ref()],
        bump = state.bump,
        has_one = round,
        has_one = proposal
    )]
    pub state: Account<'info, MaciState>,

    #[account(mut)]
    pub proposal: Account<'info, MemberProposal>,

    /// The Circle's policy, bound to the proposal's Circle by seeds and created
    /// on first use with safe defaults — exactly as `finalize_member_proposal`
    /// does it, so a MACI round cannot be finalized against a swapped-in or
    /// omitted config.
    #[account(
        init_if_needed,
        payer = finalizer,
        space = CircleConfig::SPACE,
        seeds = [b"config", proposal.circle.as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// Anyone may finalize once the dispute window has elapsed.
    #[account(mut)]
    pub finalizer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
