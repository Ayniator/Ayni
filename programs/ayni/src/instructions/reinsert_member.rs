use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, EpochLeaf, Membership, MemberTree, RecentRoots};

/// F54b — re-insert one LIVE membership into the current epoch's MemberTree.
/// Permissionless: the membership account itself is the authorization (it must
/// exist, be unexpired, and not be provisional), so any member — or a crank, or
/// a relayer on an anonymous member's behalf — can run it. The
/// ["epochleaf", circle, epoch, commitment] `init` collision is the
/// double-insertion guard, and the resulting `EpochLeaf.leaf_index` is what
/// lets clients reconstruct the new tree's insertion order exactly.
pub fn reinsert_member(ctx: Context<ReinsertMember>, epoch: u64) -> Result<()> {
    let rr = &mut ctx.accounts.recent_roots;
    require!(epoch == rr.epoch && epoch > 0, AyniError::NotInGoodStanding);

    // Live members only — this filter is the whole point of the rebuild.
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.membership.expires_at > now,
        AyniError::MembershipExpired
    );

    // Not provisional: the ProvisionalMember PDA for this commitment must not
    // exist (a closed/never-created PDA is system-owned with no data). The
    // address itself is constraint-checked below, so an attacker cannot pass an
    // unrelated empty account.
    require!(
        ctx.accounts.provisional.data_is_empty(),
        AyniError::NotInGoodStanding
    );

    let commitment = ctx.accounts.membership.commitment;
    let mt: &mut MemberTree = &mut ctx.accounts.member_tree;
    let leaf_index = mt.next_index;
    merkle::insert_leaf(mt.depth, &mut mt.next_index, &mut mt.root, &mut mt.filled_subtrees, commitment)?;
    rr.push(mt.root);

    let circle = &mut ctx.accounts.circle;
    circle.member_count = circle.member_count.saturating_add(1);

    let leaf = &mut ctx.accounts.epoch_leaf;
    leaf.circle = circle.key();
    leaf.epoch = epoch;
    leaf.commitment = commitment;
    leaf.leaf_index = leaf_index;
    leaf.bump = ctx.bumps.epoch_leaf;
    Ok(())
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct ReinsertMember<'info> {
    #[account(mut)]
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Box<Account<'info, Membership>>,

    /// CHECK: address is forced to the ProvisionalMember PDA for this
    /// commitment; the handler only requires it to be EMPTY (never created, or
    /// closed by `confirm_admission`) — a provisional member must not re-enter
    /// the votable set through the rebuild side door.
    #[account(
        seeds = [b"provisional", circle.key().as_ref(), membership.commitment.as_ref()],
        bump
    )]
    pub provisional: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Box<Account<'info, RecentRoots>>,

    #[account(
        init,
        payer = caller,
        space = EpochLeaf::SPACE,
        seeds = [b"epochleaf", circle.key().as_ref(), &epoch.to_le_bytes(), membership.commitment.as_ref()],
        bump
    )]
    pub epoch_leaf: Box<Account<'info, EpochLeaf>>,

    /// Anyone (pays the leaf-marker rent).
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
