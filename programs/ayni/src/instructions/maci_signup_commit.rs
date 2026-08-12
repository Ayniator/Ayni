use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::state::{MaciRound, MaciSignupCommit, MaciState, MACI_STAGE_OPEN};

/// Binding hash for a MACI sign-up: `H("AHA-maci-signup" || round || nullifier
/// || maci_pubkey)`.
///
/// Plain SHA-256, not a field element — this value never enters a circuit. Its
/// only job is to nail a (nullifier, key) pair together one slot before the
/// nullifier becomes public, so the reveal cannot be front-run onto a different
/// key. The mirror implementation is `maciSignupCommitment` in
/// `frontend/lib/maci-command.ts`.
pub fn maci_signup_commitment(
    round: &Pubkey,
    nullifier: &[u8; 32],
    maci_pubkey: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        b"AHA-maci-signup",
        round.as_ref(),
        nullifier.as_ref(),
        maci_pubkey.as_ref(),
    ])
    .to_bytes()
}

/// Step 1 of MACI sign-up: publish the commitment (see `MaciSignupCommit`).
///
/// Permissionless and content-free — the account holds a hash of values an
/// observer cannot invert or link to a member, plus the slot it landed in. It is
/// deliberately NOT closed on reveal: closing it would make the reveal
/// transaction refund rent to whoever paid it, which is a link between the
/// commit and the reveal that the design has no reason to publish.
pub fn maci_signup_commit(ctx: Context<MaciSignupCommitIx>, commitment: [u8; 32]) -> Result<()> {
    let state = &ctx.accounts.state;
    require!(state.stage == MACI_STAGE_OPEN, AyniError::MaciWrongStage);
    require!(
        Clock::get()?.unix_timestamp < state.msg_deadline,
        AyniError::VotingClosed
    );

    let c = &mut ctx.accounts.commit;
    c.round = ctx.accounts.round.key();
    c.commitment = commitment;
    c.slot = Clock::get()?.slot;
    c.bump = ctx.bumps.commit;
    Ok(())
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct MaciSignupCommitIx<'info> {
    pub round: Account<'info, MaciRound>,

    #[account(seeds = [b"macistate", round.key().as_ref()], bump = state.bump)]
    pub state: Account<'info, MaciState>,

    #[account(
        init,
        payer = payer,
        space = MaciSignupCommit::SPACE,
        seeds = [b"macicommit", round.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub commit: Account<'info, MaciSignupCommit>,

    /// A relayer pays, so the sign-up is not stamped with the member's wallet.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
