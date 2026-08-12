use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::instructions::finalize_member_proposal::member_vote_outcome;
use crate::state::{
    CircleConfig, MaciRound, MaciState, MemberProposal, MACI_STAGE_COMMITTED, MACI_STAGE_FINALIZED,
};

/// Record the MACI outcome, once the dispute window has elapsed.
///
/// The policy math is **the same function** the plain ballot path uses —
/// `member_vote_outcome` from `finalize_member_proposal`, against the same
/// `CircleConfig` quorum and pass thresholds and the same `eligible_count`
/// snapshot. A Circle does not get a laxer conscience for voting in sealed mode:
/// turnout still has to clear the quorum over the whole eligible set, and the
/// yes-share still has to clear the pass threshold.
///
/// # The outcome lands in `MaciState`, and deliberately NOT on the proposal
///
/// An earlier draft of this instruction wrote `passed` onto the
/// `MemberProposal`. That was a genuine privilege-escalation hole and Sentinel
/// was right to stop it (NRR-2026-08-12-f60-f61-maci, CRITICAL):
/// `install_elected_seat` and `refill_faucet` consume `MemberProposal.passed`
/// UNCONDITIONALLY, and a MACI tally is **not verified by the chain**
/// (`commit_maci_tally` explains why — the process/tally circuits need a trusted
/// setup, F44). Opening a round costs one seat signature, so wiring an
/// unverified tally into those consumers would have let a single coordinator's
/// claim install a Council seat or move treasury→jar, bypassing the 4-of-7 that
/// every other consequential action requires.
///
/// The fix is to cut that wire, not the feature. What a round produces is a
/// **recorded, publicly recomputable group conscience** — `tally_yes`,
/// `tally_no`, `passed`, and a `tally_hash` binding every input — which humans,
/// UIs and indexers read, and which anyone can recompute and dispute
/// (docs/maci.md §4). It decides nothing on chain by itself. `open_maci_round`
/// leaves the proposal at `finalized = true, passed = false`, so every existing
/// consumer stays fail-closed for the whole life of the round.
///
/// Connecting a MACI result to an automatic on-chain consequence is gated on
/// F44's ZK-verified tally, and must not be done by relaxing this instruction.
///
/// Permissionless: once the window has passed, anyone may record the outcome.
/// The coordinator cannot sit on a result it dislikes.
///
/// # DISABLED ON CHAIN (Sentinel NRR-2026-08-12-f60-f61-maci, CRITICAL)
///
/// Belt and braces, and both are deliberate: the write to
/// `MemberProposal.passed` is gone (see above — that is the structural fix,
/// which also protects a future re-enable), AND this handler refuses outright
/// until a ZK-verified tally ships (F44). Accounts, layouts and the IDL are
/// unchanged, so re-enabling is a deletion rather than a migration.
///
/// Do NOT remove either one to make a test or a demo pass. `tests/maci.ts`
/// asserts both, and will fail if the guard disappears.
#[allow(unused_variables, unreachable_code)]
pub fn finalize_maci_round(ctx: Context<FinalizeMaciRound>) -> Result<()> {
    return Err(AyniError::MaciTallyUnverified.into());
    let now = Clock::get()?.unix_timestamp;
    let eligible_count = ctx.accounts.proposal.eligible_count;
    let cfg = &ctx.accounts.config;
    let q_num = cfg.vote_quorum_num as u64;
    let q_den = cfg.vote_quorum_den as u64;
    let p_num = cfg.vote_pass_num as u128;
    let p_den = cfg.vote_pass_den as u128;

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

    state.passed = member_vote_outcome(
        state.tally_yes,
        state.tally_no,
        eligible_count,
        q_num,
        q_den,
        p_num,
        p_den,
    );
    state.stage = MACI_STAGE_FINALIZED;
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

    /// Read-only: the eligible-set snapshot the quorum is measured against.
    /// This instruction never writes to it — see the doc-comment above.
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
