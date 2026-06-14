use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{ChildCloseVote, Circle, CircleProfile};

/// Apply a passed delete-Circle vote: close the child Circle account (rent →
/// `recipient`) and, if its directory profile is supplied, close that too so it
/// leaves the map. Permissionless to trigger once authorized; one-shot.
pub fn execute_child_close(ctx: Context<ExecuteChildClose>) -> Result<()> {
    let threshold = ctx.accounts.foundation.council.threshold;
    let now = Clock::get()?.unix_timestamp;
    {
        let v = &mut ctx.accounts.vote;
        require!(!v.executed, AyniError::AlreadyExecuted);
        require!(now < v.expires_at, AyniError::VotingClosed);
        require!(v.approval_count() >= threshold, AyniError::ThresholdNotMet);
        v.executed = true;
    }

    // Optionally delist: manually close the child's CircleProfile if provided.
    let child_key = ctx.accounts.child.key();
    if let Some(profile) = ctx.accounts.profile.as_ref() {
        require!(profile.circle == child_key, AyniError::Unauthorized);
        let pinfo = profile.to_account_info();
        let rinfo = ctx.accounts.recipient.to_account_info();
        let lamports = pinfo.lamports();
        **rinfo.try_borrow_mut_lamports()? = rinfo.lamports().checked_add(lamports).unwrap();
        **pinfo.try_borrow_mut_lamports()? = 0;
        pinfo.assign(&anchor_lang::system_program::ID);
        pinfo.realloc(0, false)?;
    }
    // The child Circle account itself is closed by the `close = recipient` constraint.
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteChildClose<'info> {
    pub foundation: Account<'info, Circle>,

    #[account(mut, has_one = foundation, has_one = child)]
    pub vote: Account<'info, ChildCloseVote>,

    #[account(mut, close = recipient)]
    pub child: Account<'info, Circle>,

    /// Optional: the child's directory profile, closed so it leaves the map.
    #[account(mut)]
    pub profile: Option<Account<'info, CircleProfile>>,

    /// CHECK: receives the reclaimed rent.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub executor: Signer<'info>,
}
