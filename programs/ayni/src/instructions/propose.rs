use anchor_lang::prelude::*;

use crate::council::{ProposalAction, Proposal, COUNCIL_SEATS};
use crate::errors::AyniError;
use crate::state::Circle;

/// A Council seat opens a proposal (seat rotation or wallet migration). The
/// proposer's own approval is recorded immediately.
pub fn propose(ctx: Context<Propose>, nonce: u64, action: ProposalAction) -> Result<()> {
    let circle = &ctx.accounts.circle;
    let seat = ctx.accounts.proposer.key();
    let index = circle
        .council
        .seat_of(&seat)
        .ok_or(error!(AyniError::NotCouncilSeat))?;

    match &action {
        ProposalAction::RotateSeat { seat_index, .. } => {
            require!((*seat_index as usize) < COUNCIL_SEATS, AyniError::InvalidSeatIndex);
        }
        ProposalAction::MigrateWallet { old_wallet, new_wallet } => {
            // Never migrate the zero wallet: `recover_membership` rebinds every
            // membership whose `owner == old_wallet`, so `old_wallet = default()`
            // would seize ALL fully-anonymous memberships at once. Both ends must
            // be real, distinct wallets.
            require!(*old_wallet != Pubkey::default(), AyniError::WalletMismatch);
            require!(*new_wallet != Pubkey::default(), AyniError::WalletMismatch);
            require!(old_wallet != new_wallet, AyniError::WalletMismatch);
        }
        ProposalAction::WithdrawTreasury { amount, recipient } => {
            require!(*amount > 0, AyniError::WrongProposalAction);
            require!(*recipient != Pubkey::default(), AyniError::WalletMismatch);
        }
        ProposalAction::SetTreasuryWallet { new_wallet } => {
            require!(*new_wallet != Pubkey::default(), AyniError::WalletMismatch);
        }
        ProposalAction::SetKarmaParams { sponsor_ratio_bps, .. } => {
            // Reject an impossible ratio at PROPOSE time, not only at apply
            // time: a Council should not spend a contest window approving a
            // figure the program will refuse. `set_karma_params` re-checks it
            // anyway — a proposal is data, and data is not trusted twice.
            require!(*sponsor_ratio_bps <= 10_000, AyniError::InvalidKarmaRatio);
        }
        ProposalAction::BeginMemberEpoch => {
            // No parameters to validate — the action names the Circle it is
            // proposed against (`Proposal.circle`), and `begin_member_epoch`
            // re-checks that binding via `has_one = circle`.
        }
        ProposalAction::WithdrawTreasuryToken { mint, amount, recipient } => {
            require!(*amount > 0, AyniError::WrongProposalAction);
            require!(*mint != Pubkey::default(), AyniError::WalletMismatch);
            require!(*recipient != Pubkey::default(), AyniError::WalletMismatch);
        }
    }

    let now = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;
    proposal.circle = circle.key();
    proposal.nonce = nonce;
    proposal.action = action;
    proposal.approvals = 0;
    proposal.executed = false;
    proposal.cancelled = false;
    proposal.drained = false;
    proposal.created_at = now;
    proposal.eligible_at = 0;
    proposal.bump = ctx.bumps.proposal;
    proposal.add_approval(index)?;
    proposal.arm_if_ready(circle.council.threshold, circle.council.recovery_timelock, now);
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Propose<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = proposer,
        space = Proposal::SPACE,
        seeds = [b"proposal", circle.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
