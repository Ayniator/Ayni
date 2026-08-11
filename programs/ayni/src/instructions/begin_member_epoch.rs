use anchor_lang::prelude::*;

use crate::merkle;
use crate::state::{Circle, MemberTree, RecentRoots};

/// F54b — begin a new member epoch: empty the MemberTree and let only LIVE
/// memberships re-enter (via permissionless `reinsert_member`). This is what
/// turns the append-only votable set into a good-standing set — expired and
/// revoked commitments simply never come back, with no per-leaf deletion (the
/// incremental tree cannot delete) and no new circuit.
///
/// Service function, any-seat gated (like `set_meetings`): expiry cleanup is
/// routine housekeeping, and the reset is recoverable by construction — every
/// live member (or anyone on their behalf) re-inserts, and `member_count`
/// grows back with them.
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
    let circle = &mut ctx.accounts.circle;
    circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

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
        payer = seat,
        space = RecentRoots::SPACE,
        seeds = [b"roots", circle.key().as_ref()],
        bump
    )]
    pub recent_roots: Box<Account<'info, RecentRoots>>,

    /// Any Council seat (signs; pays the ring-buffer rent if first use).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
