use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::instructions::maci_signup_commit::maci_signup_commitment;
use crate::merkle;
use crate::state::{
    MaciRound, MaciSignup, MaciSignupCommit, MaciState, MemberProposal, Nullifier, MACI_STAGE_OPEN,
};

/// Canonical external nullifier for a MACI sign-up:
/// `H("AHA-maci-signup-nul" || round)`, masked into BN254.
///
/// **Why it is domain-separated from the plain ballot.** `cast_vote` uses the
/// proposal's `nonce` as the circuit's `proposalId` with `choice ∈ {0,1}`. If a
/// sign-up reused that, a sign-up proof (`choice = 1`) would be byte-identical
/// to a *yes* ballot proof for the same member — anyone who saw the sign-up
/// transaction could replay the proof into `cast_vote` and turn the member's
/// sealed, coercion-resistant ballot into a public YES. Hashing under a distinct
/// tag makes a sign-up proof useless anywhere else, and makes the emitted
/// nullifier independent of the ballot nullifier so the two cannot be
/// correlated.
///
/// The consequence is that the sign-up nullifier does NOT occupy the plain
/// ballot's nullifier PDA, so it cannot stop a member from doing both. What
/// stops that is `open_maci_round` closing the plain path outright.
///
/// The mask is the same rule as `merkle::field_from_pubkey`: clearing the top 3
/// bits puts the value below BN254's p. The browser prover must mask identically
/// (`frontend/lib/maci.ts`, `maciSignupExternalNullifier`).
pub fn maci_signup_external_nullifier(round: &Pubkey) -> [u8; 32] {
    let mut b = hashv(&[b"AHA-maci-signup-nul", round.as_ref()]).to_bytes();
    b[0] &= 0x1f; // BN254 p > 2^253 ⇒ always in field
    b
}

/// Step 2 of MACI sign-up: reveal, prove membership, register the voting key.
///
/// The proof is `member_vote.circom` reused exactly as `prove_personhood`,
/// `attest_admission_zk` and `activate_faucet_zk` already reuse it — no new
/// circuit, no new trusted setup (F44 stays out of scope):
///
/// ```text
///   root        = the proposal's snapshotted member root
///   proposalId  = maci_signup_external_nullifier(round)
///   choice      = 1 ("I claim my voice in this round")
///   nullifier   = Poseidon(secret, proposalId)          [circuit output]
/// ```
///
/// The nullifier PDA (`init`) is what makes it one member, one MACI key: a
/// second sign-up from the same membership fails on account creation. The member
/// is never named — the proof says "some member of this set", the fee is
/// relayed, and the registered key is an ordinary ed25519 key with no link to
/// the membership.
///
/// The `commit` account is the front-running guard; see `MaciSignupCommit`.
pub fn maci_signup(
    ctx: Context<MaciSignupIx>,
    maci_pubkey: [u8; 32],
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts.state.stage == MACI_STAGE_OPEN,
        AyniError::MaciWrongStage
    );
    require!(
        clock.unix_timestamp < ctx.accounts.state.msg_deadline,
        AyniError::VotingClosed
    );

    // The commitment must name exactly this (nullifier, key) pair, and must have
    // landed in an EARLIER slot — an attacker who first learns the nullifier
    // from this very transaction can never own an older commitment for a key of
    // their own.
    let round_key = ctx.accounts.round.key();
    require!(
        ctx.accounts.commit.commitment
            == maci_signup_commitment(&round_key, &nullifier, &maci_pubkey),
        AyniError::MaciSignupMismatch
    );
    require!(
        ctx.accounts.commit.slot < clock.slot,
        AyniError::MaciCommitTooRecent
    );

    // Public-signal order (outputs first): [nullifier, root, proposalId, choice].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        ctx.accounts.proposal.member_root,
        maci_signup_external_nullifier(&round_key),
        merkle::field_from_u8(1),
    ];

    verify_anchored_proof(
        ProofKind::MemberVote,
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        AyniError::VoteProofInvalid,
    )?;

    let state = &mut ctx.accounts.state;
    let index = state.signup_count;

    let s = &mut ctx.accounts.signup;
    s.round = round_key;
    s.pubkey = maci_pubkey;
    s.index = index;
    s.weight = 1;
    s.bump = ctx.bumps.signup;

    state.signup_count = index.saturating_add(1);
    // Running commitment to the eligible key set, in registration order. It goes
    // into `tally_hash`, so an auditor can prove they reconstructed the same
    // electorate the coordinator claims to have counted.
    state.signup_digest = hashv(&[
        &state.signup_digest,
        &index.to_le_bytes(),
        maci_pubkey.as_ref(),
    ])
    .to_bytes();
    Ok(())
}

#[derive(Accounts)]
#[instruction(maci_pubkey: [u8; 32], nullifier: [u8; 32])]
pub struct MaciSignupIx<'info> {
    #[account(has_one = proposal)]
    pub round: Account<'info, MaciRound>,

    #[account(mut, seeds = [b"macistate", round.key().as_ref()], bump = state.bump)]
    pub state: Account<'info, MaciState>,

    pub proposal: Account<'info, MemberProposal>,

    #[account(
        seeds = [b"macicommit", round.key().as_ref(), commit.commitment.as_ref()],
        bump = commit.bump,
        constraint = commit.round == round.key() @ AyniError::MaciSignupMismatch
    )]
    pub commit: Account<'info, MaciSignupCommit>,

    /// One MACI key per membership per round: `init` is the refusal.
    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"macinull", round.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub signup_nullifier: Account<'info, Nullifier>,

    #[account(
        init,
        payer = payer,
        space = MaciSignup::SPACE,
        seeds = [b"macisignup", round.key().as_ref(), maci_pubkey.as_ref()],
        bump
    )]
    pub signup: Account<'info, MaciSignup>,

    /// A relayer pays so the sign-up is not stamped with the member's wallet.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
