use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{
    Circle, MemberProposal, MemberTree, RecentRoots, EPOCH_SETTLE_PERIOD, MAX_VOTING_PERIOD,
    MIN_ELECTORATE,
};

/// Open a group-conscience proposal for the whole membership to vote on (an idea
/// or a material/documentation change). A Council seat records it (the agenda
/// item raised at a meeting), snapshotting the eligible voter set so the roll
/// can't shift mid-vote. The text lives off-chain; `description_hash` commits to it.
pub fn create_member_proposal(
    ctx: Context<CreateMemberProposal>,
    nonce: u64,
    description_hash: [u8; 32],
    voting_period: i64,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require!(
        circle.council.seat_of(&ctx.accounts.proposer.key()).is_some(),
        AyniError::NotCouncilSeat
    );

    let now = Clock::get()?.unix_timestamp;

    // (1) `voting_period` was not validated at all — it went straight into
    // `deadline`, so a zero or negative value created a proposal already past
    // its own deadline, and an enormous one parked a ballot open for years
    // against a frozen electorate snapshot. The floor here is deliberately only
    // "> 0"; what stops a ballot being decided by one person is MIN_TURNOUT at
    // finalize, not a minimum duration (see state.rs for why).
    require!(
        voting_period > 0 && voting_period <= MAX_VOTING_PERIOD,
        AyniError::InvalidVotingPeriod
    );

    let mt = &ctx.accounts.member_tree;

    // (2) Not against a freshly emptied votable set. `begin_member_epoch` wipes
    // the tree on purpose; until the live memberships have re-entered, quorum is
    // computed against whoever the rebuild's caller let back in. Epoch 0 means no
    // rebuild has ever happened, so there is nothing to settle.
    let rr_ai = ctx.accounts.recent_roots.to_account_info();
    if !rr_ai.data_is_empty() {
        require_keys_eq!(*rr_ai.owner, crate::ID, AyniError::Unauthorized);
        let rr = RecentRoots::try_deserialize(&mut &rr_ai.try_borrow_data()?[..])?;
        require!(
            rr.epoch == 0 || now >= rr.epoch_started_at.saturating_add(EPOCH_SETTLE_PERIOD),
            AyniError::EpochNotSettled
        );
    }

    // (3) An electorate too small to be a group conscience needs a second party
    // from OUTSIDE this Circle's Council — a seat of the parent Circle. This is
    // not a block on small circles: it is the escape that lets them govern while
    // denying a captured seat a private electorate. `Circle.parent` is a PDA seed
    // (state.rs), so it is fixed for the Circle's life and a captured seat cannot
    // point it at a parent it controls.
    if mt.next_index < MIN_ELECTORATE {
        let parent = ctx
            .accounts
            .parent_circle
            .as_ref()
            .ok_or(error!(AyniError::ElectorateTooSmall))?;
        let parent_seat = ctx
            .accounts
            .parent_seat
            .as_ref()
            .ok_or(error!(AyniError::ElectorateTooSmall))?;
        require_keys_eq!(parent.key(), circle.parent, AyniError::ElectorateTooSmall);
        // A Circle is never its own parent, so this cannot be self-satisfied.
        require!(parent.key() != circle.key(), AyniError::ElectorateTooSmall);
        parent.council.require_any_seat(&parent_seat.key())?;
    }
    let p = &mut ctx.accounts.proposal;
    p.circle = circle.key();
    p.nonce = nonce;
    p.description_hash = description_hash;
    p.member_root = mt.root; // snapshot of the eligible voter set
    p.eligible_count = mt.next_index;
    p.yes = 0;
    p.no = 0;
    p.deadline = Clock::get()?.unix_timestamp + voting_period;
    p.finalized = false;
    p.passed = false;
    p.bump = ctx.bumps.proposal;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateMemberProposal<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle, seeds = [b"members", circle.key().as_ref()], bump = member_tree.bump)]
    pub member_tree: Account<'info, MemberTree>,

    #[account(
        init,
        payer = proposer,
        space = MemberProposal::SPACE,
        seeds = [b"mproposal", circle.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, MemberProposal>,

    /// The epoch ring buffer, read to check the votable set has settled since the
    /// last rebuild.
    ///
    /// Deliberately an `UncheckedAccount` with a seeds constraint rather than an
    /// `Account` or an `Option<Account>`. `Account` would break every Circle that
    /// has never rebuilt (they have no such account, and `epoch == 0` is exactly
    /// the settled case). `Option` would be worse: it lets the CALLER elect
    /// absence, so the attacker whose rebuild we are guarding against could just
    /// omit the account and skip the check. Seed-bound-and-always-present means
    /// the address is program-derived, the caller cannot substitute a friendlier
    /// ring buffer, and "empty" is the only way to be absent.
    ///
    /// CHECK: address is fixed by the seeds; contents are validated below by
    /// `try_deserialize` (which checks the discriminator) after an owner check.
    #[account(seeds = [b"roots", circle.key().as_ref()], bump)]
    pub recent_roots: UncheckedAccount<'info>,

    /// The parent Circle — required ONLY when this Circle's votable set is below
    /// `MIN_ELECTORATE`. Checked against `circle.parent` (a PDA seed, so fixed
    /// for life), never trusted from the caller.
    pub parent_circle: Option<Account<'info, Circle>>,

    /// A seat of the parent Circle, co-signing a small Circle's ballot. Supplies
    /// the second party that a captured seat of THIS Circle cannot manufacture.
    pub parent_seat: Option<Signer<'info>>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
