use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, CircleRootAnchor, FederationChild, MemberTree, RecentRoots};

/// F56 — publish a Circle's current member root under its foundation, so any
/// Circle in the same federation can verify a visiting member's proof.
/// Permissionless crank ONCE THE CHILD IS APPROVED: it copies verified on-chain
/// state (the Circle's own MemberTree root), so anyone may refresh it — but the
/// child must first be vouched by a foundation Council seat
/// (`approve_federation_child` → the `FederationChild` PDA required below).
/// Self-claimed `parent` is NOT enough: it is permissionless and would let an
/// attacker anchor a rogue circle's root and forge fellow-member passes
/// (ultracode CRITICAL, 2026-08-11b). The parentage constraint remains as a
/// guard alongside the approval.
pub fn publish_member_root(ctx: Context<PublishMemberRoot>) -> Result<()> {
    let entry = &mut ctx.accounts.anchor_entry;
    entry.foundation = ctx.accounts.foundation.key();
    entry.circle = ctx.accounts.circle.key();
    entry.root = ctx.accounts.member_tree.root;
    entry.epoch = ctx
        .accounts
        .recent_roots
        .as_ref()
        .map(|rr| rr.epoch)
        .unwrap_or(0);
    entry.updated_at = Clock::get()?.unix_timestamp;
    entry.bump = ctx.bumps.anchor_entry;
    Ok(())
}

#[derive(Accounts)]
pub struct PublishMemberRoot<'info> {
    pub foundation: Box<Account<'info, Circle>>,

    /// The Circle being anchored — must genuinely belong to this federation.
    #[account(
        constraint = circle.key() == foundation.key()
            || circle.parent == foundation.key() @ AyniError::Unauthorized
    )]
    pub circle: Box<Account<'info, Circle>>,

    /// The foundation's approval of this child (F56) — created only by a
    /// foundation Council seat. Its existence at this exact PDA is the consent
    /// gate: a rogue self-claimed child has no approval, so it cannot be
    /// anchored. `has_one` re-binds both keys defensively.
    #[account(
        has_one = foundation,
        has_one = circle,
        seeds = [b"fedchild", foundation.key().as_ref(), circle.key().as_ref()],
        bump = federation_child.bump
    )]
    pub federation_child: Box<Account<'info, FederationChild>>,

    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    /// Present when the Circle has a ring buffer (carries the epoch).
    #[account(
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Option<Box<Account<'info, RecentRoots>>>,

    #[account(
        init_if_needed,
        payer = caller,
        space = CircleRootAnchor::SPACE,
        seeds = [b"anchor", foundation.key().as_ref(), circle.key().as_ref()],
        bump
    )]
    pub anchor_entry: Box<Account<'info, CircleRootAnchor>>,

    /// Anyone (pays the entry's rent on first publish).
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
