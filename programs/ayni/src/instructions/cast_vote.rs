use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{MemberProposal, Nullifier};
use crate::verifying_key_vote::VERIFYING_KEY_VOTE;

/// Cast one anonymous ballot. A ZK proof shows the voter's identity commitment
/// is in the proposal's snapshotted member set and emits a per-proposal
/// nullifier; the nullifier PDA (created with `init`) enforces one vote per
/// member. The voter stays hidden; only the tally moves.
pub fn cast_vote(
    ctx: Context<CastVote>,
    choice: bool,
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let now = Clock::get()?.unix_timestamp;
    require!(!proposal.finalized, AyniError::VotingClosed);
    require!(now < proposal.deadline, AyniError::VotingClosed);

    // Public-signal order (outputs first): [nullifier, root, proposalId, choice].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        proposal.member_root,
        merkle::field_from_u64(proposal.nonce),
        merkle::field_from_u8(if choice { 1 } else { 0 }),
    ];

    let mut verifier =
        Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYING_KEY_VOTE)
            .map_err(|_| error!(AyniError::VoteProofInvalid))?;
    verifier.verify().map_err(|_| error!(AyniError::VoteProofInvalid))?;

    // `vote_nullifier` is created with `init`, so a second ballot from the same
    // member (same nullifier) fails here.

    if choice {
        proposal.yes = proposal.yes.saturating_add(1);
    } else {
        proposal.no = proposal.no.saturating_add(1);
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(choice: bool, nullifier: [u8; 32])]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, MemberProposal>,

    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"vote_nullifier", proposal.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub vote_nullifier: Account<'info, Nullifier>,

    /// A relayer pays so the voter's wallet is never linked to the ballot.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
