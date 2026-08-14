use anchor_lang::prelude::*;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, MemberTree, RecentRoots};

/// F54b — begin a new member epoch: empty the MemberTree and let only LIVE
/// memberships re-enter (via permissionless `reinsert_member`). This is what
/// turns the append-only votable set into a good-standing set — expired and
/// revoked commitments simply never come back, with no per-leaf deletion (the
/// incremental tree cannot delete) and no new circuit.
///
/// **4-of-7 gated (changed 2026-08-14; was any-seat).** The old comment here
/// called this a service function "like `set_meetings`" because "the reset is
/// recoverable by construction". That reasoning holds for members and fails for
/// governance: while the tree is empty, whoever called this decides who may
/// vote. One seat could call it, let the permissionless `reinsert_member` crank
/// re-enter only their own commitment, open a member proposal against that
/// electorate of one, vote yes once, and pass it — `quorum_threshold(1, ..)` is
/// `.max(1)` = 1. That reached `refill_faucet` and every other member-vote-gated
/// action. Emptying the electorate is the most powerful act in the program, so
/// it now costs the same 4-of-7 plus contest window as a treasury withdrawal.
///
/// Permissionless to trigger once the Council has approved and executed the
/// proposal, exactly like `withdraw_treasury`; `drained` makes it one-shot, so
/// one authorization cannot be replayed to re-empty the tree at will.
///
/// Operational rules (documented, not enforceable on-chain):
/// * Finalize open member proposals FIRST. Ballots verify against a proposal's
///   snapshotted root, but voters must reconstruct the OLD tree's insertion
///   order client-side, and a revoked member's commitment disappears with its
///   closed account — after a rebuild, old snapshots may become
///   unreconstructable.
/// * Run the reinsert crank promptly: until re-insertion completes,
///   `member_count` (and therefore new proposals' quorum base) undercounts.
pub fn begin_member_epoch(ctx: Context<BeginMemberEpoch>) -> Result<()> {
    // 4-of-7, contest window elapsed, and not already spent. `execute_proposal`
    // has already checked `require_executable`; `executed` is the record of it.
    require!(ctx.accounts.proposal.executed, AyniError::ThresholdNotMet);
    require!(!ctx.accounts.proposal.drained, AyniError::AlreadyExecuted);
    require!(
        matches!(ctx.accounts.proposal.action, ProposalAction::BeginMemberEpoch),
        AyniError::WrongProposalAction
    );
    // Mark consumed before touching state — one authorization, one rebuild.
    ctx.accounts.proposal.drained = true;

    let circle = &mut ctx.accounts.circle;

    // Empty the tree.
    let mt: &mut MemberTree = &mut ctx.accounts.member_tree;
    merkle::init_tree(mt.depth, &mut mt.next_index, &mut mt.root, &mut mt.filled_subtrees)?;
    circle.member_count = 0;

    // Advance the epoch; the ring buffer restarts at the empty root so stale
    // pre-rebuild roots can no longer authorize anything.
    let circle_key = circle.key();
    let bump = ctx.bumps.recent_roots;
    let rr = &mut ctx.accounts.recent_roots;
    if rr.circle == Pubkey::default() {
        rr.circle = circle_key;
        rr.bump = bump;
    }
    rr.epoch = rr.epoch.saturating_add(1);
    rr.epoch_started_at = Clock::get()?.unix_timestamp;
    rr.index = 0;
    rr.roots = [[0u8; 32]; RecentRoots::N];
    rr.push(mt.root);
    Ok(())
}

#[derive(Accounts)]
pub struct BeginMemberEpoch<'info> {
    #[account(mut)]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = RecentRoots::SPACE,
        seeds = [b"roots", circle.key().as_ref()],
        bump
    )]
    pub recent_roots: Box<Account<'info, RecentRoots>>,

    /// The executed 4-of-7 `BeginMemberEpoch` authorization. Marked `drained`
    /// here so it authorizes exactly one rebuild.
    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    /// Whoever triggers the (permissionless) rebuild; pays the ring-buffer rent
    /// on first use. Carries NO authority — the Council's approvals do.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
