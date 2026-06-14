use anchor_lang::prelude::*;

use crate::council::COUNCIL_SEATS;
use crate::errors::AyniError;
use crate::state::{ChildSeatVote, Circle};

/// Apply a child-rotation vote that reached the foundation's 4-of-7 threshold
/// before expiry: write the new seat set into the child Circle's Council.
/// Permissionless to trigger once authorized; one-shot.
pub fn execute_child_rotation(ctx: Context<ExecuteChildRotation>) -> Result<()> {
    let threshold = ctx.accounts.foundation.council.threshold;
    let foundation_key = ctx.accounts.foundation.key();
    let foundation_parent = ctx.accounts.foundation.parent;
    let now = Clock::get()?.unix_timestamp;

    // Read what we need from the vote, then release the borrow.
    let (new_seats, ok) = {
        let v = &mut ctx.accounts.vote;
        require!(!v.executed, AyniError::AlreadyExecuted);
        require!(now < v.expires_at, AyniError::VotingClosed);
        require!(v.approval_count() >= threshold, AyniError::ThresholdNotMet);
        v.executed = true; // consume before mutating the child (no replay)
        (v.new_seats, true)
    };
    let _ = ok;

    // Defensive: seats still all filled + distinct.
    for i in 0..COUNCIL_SEATS {
        require!(new_seats[i] != Pubkey::default(), AyniError::InvalidSeatIndex);
        for j in (i + 1)..COUNCIL_SEATS {
            require!(new_seats[i] != new_seats[j], AyniError::DuplicateSeat);
        }
    }

    let child = &mut ctx.accounts.child;
    require!(child.key() != foundation_key, AyniError::Unauthorized);
    require!(
        child.parent == foundation_key || child.parent == foundation_parent,
        AyniError::Unauthorized
    );
    child.council.seats = new_seats;
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteChildRotation<'info> {
    pub foundation: Account<'info, Circle>,

    #[account(mut, has_one = foundation, has_one = child)]
    pub vote: Account<'info, ChildSeatVote>,

    #[account(mut)]
    pub child: Account<'info, Circle>,

    pub executor: Signer<'info>,
}
