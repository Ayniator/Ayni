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

    // Not executed / not cancelled / threshold met / contest window elapsed —
    // the pure guard lives on `Proposal` so it can be property-tested (F42).
    let now = Clock::get()?.unix_timestamp;
    proposal.require_executable(circle.council.threshold, now)?;

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
            // One holder per seat: if old_wallet actually sits on the Council, the
            // rebind must not land on a wallet that already holds a DIFFERENT seat
            // (that would silently collapse two seats onto one key, weakening the
            // 4-of-7 threshold to fewer distinct holders). RotateSeat /
            // install_elected_seat / initialize_circle all enforce this; MigrateWallet
            // was the one seat-mutating path that did not. When old_wallet holds no
            // seat (a pure membership migration), the loop is a no-op and the check
            // is skipped so it never blocks a legitimate member wallet swap.
            if circle.council.seat_of(old_wallet).is_some() {
                require!(
                    circle.council.seat_of(new_wallet).is_none(),
                    AyniError::DuplicateSeat
                );
            }
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
        ProposalAction::SetTreasuryWallet { .. } => {
            // Authorization only — the wallet is written in `set_treasury_wallet`,
            // gated on this executed proposal (which carries the new wallet).
        }
        ProposalAction::WithdrawTreasuryToken { .. } => {
            // Authorization only — the tokens move in `withdraw_treasury_token`,
            // gated on this executed proposal (so the treasury PDA can sign) with
            // the same one-shot `drained` guard as WithdrawTreasury.
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
