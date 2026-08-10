use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::system_program;

use crate::errors::AyniError;
use crate::state::{Circle, FaucetJar, MemberProposal, Nullifier, FAUCET_MAX_REFILL_GRANTS};

/// Canonical refill commitment: H("AHA-faucet-refill" || circle || amount_le).
/// The member proposal must carry this as its `description_hash`, so the members
/// provably voted to move exactly this amount from the treasury into the jar.
pub fn faucet_refill_hash(circle: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[b"AHA-faucet-refill", circle.as_ref(), &amount.to_le_bytes()]).to_bytes()
}

/// Refill the faucet jar from the Circle treasury, authorized by a passed
/// anonymous member vote (Epic 0: "refilled only by circle vote" — the whole
/// membership's group conscience, one member one ballot, not a servant's
/// signature). Permissionless to execute once the vote has passed; the one-shot
/// marker PDA makes a passed proposal spendable exactly once, so a refill can
/// never be replayed to drain the treasury into the jar.
pub fn refill_faucet(ctx: Context<RefillFaucet>, amount: u64) -> Result<()> {
    let p = &ctx.accounts.proposal;
    require!(p.finalized && p.passed, AyniError::ThresholdNotMet);
    require!(amount > 0, AyniError::WrongProposalAction);

    // Ceiling, enforced on-chain. A member vote commits to the amount only
    // through an opaque `description_hash`: voters read prose off-chain, so a
    // proposal captioned "top up the faucet" could commit to the whole treasury
    // and pass on trust. The jar is a treasury outflow that skips the 4-of-7 +
    // time-lock + allowlist that `withdraw_treasury` requires, so one ballot
    // must never be able to move more than the jar could plausibly hand out.
    let ceiling = ctx
        .accounts
        .jar
        .grant_lamports
        .saturating_mul(FAUCET_MAX_REFILL_GRANTS);
    require!(amount <= ceiling, AyniError::FaucetRefillTooLarge);

    require!(
        p.description_hash == faucet_refill_hash(&ctx.accounts.circle.key(), amount),
        AyniError::WrongProposalAction
    );

    let circle_key = ctx.accounts.circle.key();
    let bump = ctx.bumps.treasury;
    let seeds: &[&[u8]] = &[b"treasury", circle_key.as_ref(), &[bump]];
    let signer = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.jar.to_account_info(),
        },
        signer,
    );
    system_program::transfer(cpi, amount)
}

#[derive(Accounts)]
pub struct RefillFaucet<'info> {
    pub circle: Account<'info, Circle>,

    /// The passed member vote committing to exactly (circle, amount).
    #[account(has_one = circle)]
    pub proposal: Account<'info, MemberProposal>,

    /// One-shot marker: a passed refill vote moves funds exactly once.
    #[account(
        init,
        payer = caller,
        space = Nullifier::SPACE,
        seeds = [b"faucetfill", proposal.key().as_ref()],
        bump
    )]
    pub fill_marker: Account<'info, Nullifier>,

    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, has_one = circle, seeds = [b"faucet", circle.key().as_ref()], bump = jar.bump)]
    pub jar: Account<'info, FaucetJar>,

    /// Whoever triggers the (permissionless) refill; pays the marker's rent.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
