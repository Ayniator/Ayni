use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{CircleConfig, MemberProposal};

/// Close voting and record the outcome after the deadline. Group conscience:
/// passes if turnout meets the quorum and the yes-share clears the pass
/// threshold. Both are per-Circle tunables in `CircleConfig` — quorum defaults to
/// one-third of the eligible set, pass defaults to a simple majority (yes > no).
/// Execution of the decision is carried out off-chain or by a follow-up
/// governance action; this records the conscience.
pub fn finalize_member_proposal(ctx: Context<FinalizeMemberProposal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let q_num = ctx.accounts.config.vote_quorum_num as u64;
    let q_den = ctx.accounts.config.vote_quorum_den as u64;
    let p_num = ctx.accounts.config.vote_pass_num as u128;
    let p_den = ctx.accounts.config.vote_pass_den as u128;

    let p = &mut ctx.accounts.proposal;
    require!(now >= p.deadline, AyniError::VotingNotEnded);
    require!(!p.finalized, AyniError::AlreadyFinalized);

    let turnout = p.yes.saturating_add(p.no);
    // Quorum: configured num/den of the eligible set, else ceil(eligible/3). ≥1.
    let quorum = if q_den > 0 {
        (p.eligible_count.saturating_mul(q_num) / q_den).max(1)
    } else {
        ((p.eligible_count + 2) / 3).max(1)
    };
    // Pass: yes/turnout ≥ configured num/den (cross-multiplied), else yes > no.
    let majority = if p_den > 0 {
        (p.yes as u128) * p_den >= p_num * (turnout as u128)
    } else {
        p.yes > p.no
    };
    p.passed = turnout >= quorum && turnout > 0 && majority;
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
