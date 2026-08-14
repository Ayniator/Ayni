use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{CircleConfig, MemberProposal, MIN_TURNOUT};

/// Close voting and record the outcome after the deadline. Group conscience:
/// passes if turnout meets the quorum and the yes-share clears the pass
/// threshold. Both are per-Circle tunables in `CircleConfig` — quorum defaults to
/// one-third of the eligible set, pass defaults to a simple majority (yes > no).
/// Execution of the decision is carried out off-chain or by a follow-up
/// governance action; this records the conscience.
/// Quorum: configured num/den of the eligible set, else ceil(eligible/3). ≥ 1.
/// Pure — property-tested in `crate::proptests` (F42).
pub(crate) fn quorum_threshold(eligible_count: u64, q_num: u64, q_den: u64) -> u64 {
    if q_den > 0 {
        (eligible_count.saturating_mul(q_num) / q_den).max(1)
    } else {
        ((eligible_count + 2) / 3).max(1)
    }
}

/// Pass: yes/turnout ≥ configured num/den (cross-multiplied), else yes > no.
/// Pure — property-tested in `crate::proptests` (F42).
pub(crate) fn vote_passes(yes: u64, no: u64, p_num: u128, p_den: u128) -> bool {
    let turnout = yes.saturating_add(no);
    if p_den > 0 {
        (yes as u128) * p_den >= p_num * (turnout as u128)
    } else {
        yes > no
    }
}

/// Group-conscience outcome: quorum met, at least `MIN_TURNOUT` members actually
/// voted, and the pass threshold cleared.
///
/// The `turnout >= MIN_TURNOUT` term is the 2026-08-14 ballot-integrity fix. It
/// used to be `turnout > 0`, which combined with `quorum_threshold`'s `.max(1)`
/// meant a one-member electorate passed proposals on a single `yes`. That was
/// reachable on purpose: `begin_member_epoch` emptied the tree, the
/// permissionless `reinsert_member` crank re-entered one commitment, and the
/// resulting ballot carried the whole Circle. Two is not a quorum — quorum is
/// still the configured share of the eligible set — it is the statement that one
/// person alone is never a group conscience.
pub(crate) fn member_vote_outcome(
    yes: u64,
    no: u64,
    eligible_count: u64,
    q_num: u64,
    q_den: u64,
    p_num: u128,
    p_den: u128,
) -> bool {
    let turnout = yes.saturating_add(no);
    let quorum = quorum_threshold(eligible_count, q_num, q_den);
    turnout >= quorum && turnout >= MIN_TURNOUT && vote_passes(yes, no, p_num, p_den)
}

pub fn finalize_member_proposal(ctx: Context<FinalizeMemberProposal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let q_num = ctx.accounts.config.vote_quorum_num as u64;
    let q_den = ctx.accounts.config.vote_quorum_den as u64;
    let p_num = ctx.accounts.config.vote_pass_num as u128;
    let p_den = ctx.accounts.config.vote_pass_den as u128;

    let p = &mut ctx.accounts.proposal;
    require!(now >= p.deadline, AyniError::VotingNotEnded);
    require!(!p.finalized, AyniError::AlreadyFinalized);

    p.passed = member_vote_outcome(p.yes, p.no, p.eligible_count, q_num, q_den, p_num, p_den);
    p.finalized = true;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeMemberProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, MemberProposal>,

    /// The Circle's policy (quorum/pass thresholds). Bound to the proposal's
    /// Circle by seeds, created on first use with safe defaults — so it can't be
    /// swapped for a more permissive config or omitted to dodge a tighter one.
    #[account(
        init_if_needed,
        payer = finalizer,
        space = CircleConfig::SPACE,
        seeds = [b"config", proposal.circle.as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// Anyone may finalize once the deadline has passed.
    #[account(mut)]
    pub finalizer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
