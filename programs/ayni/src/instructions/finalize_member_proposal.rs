use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::MemberProposal;

/// Close voting and record the outcome after the deadline. Group conscience:
/// passes if turnout meets a one-third quorum and yes outweighs no. Execution of
/// the decision (applying a material/doc change) is carried out off-chain or by a
/// follow-up governance action; this records the conscience.
pub fn finalize_member_proposal(ctx: Context<FinalizeMemberProposal>) -> Result<()> {
    let p = &mut ctx.accounts.proposal;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= p.deadline, AyniError::VotingNotEnded);
    require!(!p.finalized, AyniError::AlreadyFinalized);

    let turnout = p.yes.saturating_add(p.no);
    // quorum = ceil(eligible_count / 3), at least 1.
    let quorum = ((p.eligible_count + 2) / 3).max(1);
    p.passed = turnout >= quorum && p.yes > p.no;
    p.finalized = true;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeMemberProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, MemberProposal>,
    /// Anyone may finalize once the deadline has passed.
    pub finalizer: Signer<'info>,
}
