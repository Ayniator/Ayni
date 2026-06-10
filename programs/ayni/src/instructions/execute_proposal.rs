use anchor_lang::prelude::*;

use crate::council::{ProposalAction, Proposal, COUNCIL_SEATS};
use crate::errors::AyniError;
use crate::state::Circle;

/// Execute a proposal that has reached the 4-of-7 threshold. Permissionless:
/// once enough seats have approved, anyone may trigger the already-authorized
/// action. `RotateSeat` and the Council-seat part of `MigrateWallet` complete
/// here; membership/level artifacts are rebound afterwards via
/// `recover_membership`, gated by this executed proposal.
pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let proposal = &mut ctx.accounts.proposal;

    require!(!proposal.executed, AyniError::AlreadyExecuted);
    require!(!proposal.cancelled, AyniError::ProposalCancelled);
    require!(
        proposal.approval_count() >= circle.council.threshold,
        AyniError::ThresholdNotMet
    );
    // Armed (eligible_at != 0) once threshold was reached; MigrateWallet must
    // also wait out the contest window before `now` reaches eligible_at.
    let now = Clock::get()?.unix_timestamp;
    require!(
        proposal.eligible_at != 0 && now >= proposal.eligible_at,
        AyniError::TimelockNotElapsed
    );

    match &proposal.action {
        ProposalAction::RotateSeat { seat_index, new_holder } => {
            let i = *seat_index as usize;
            require!(i < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
            // One holder per seat: reject if `new_holder` already sits elsewhere.
            require!(
                !circle.council.occupied_elsewhere(new_holder, i),
                AyniError::DuplicateSeat
            );
            circle.council.seats[i] = *new_holder;
        }
        ProposalAction::MigrateWallet { old_wallet, new_wallet } => {
            // Rebind every Council seat held by old_wallet (bounded loop of 7).
            for s in circle.council.seats.iter_mut() {
                if s == old_wallet {
                    *s = *new_wallet;
                }
            }
        }
        ProposalAction::WithdrawTreasury { .. } => {
            // Authorization only — the lamports move in `withdraw_treasury`,
            // gated on this executed proposal (so the treasury PDA can sign).
        }
    }

    proposal.executed = true;
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    /// Anyone may trigger execution once the threshold is met.
    pub executor: Signer<'info>,
}
