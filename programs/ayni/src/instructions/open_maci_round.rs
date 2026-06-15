use anchor_lang::prelude::*;

use crate::state::{Circle, MaciRound, MemberProposal};

/// Open a MACI round over a member proposal: register the coordinator's
/// encryption key so voters can publish sealed (receipt-free) commands. Any
/// Council seat opens it. PDA: ["maci", proposal].
pub fn open_maci_round(ctx: Context<OpenMaciRound>, coordinator: [u8; 32]) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let r = &mut ctx.accounts.round;
    r.circle = ctx.accounts.circle.key();
    r.proposal = ctx.accounts.proposal.key();
    r.coordinator = coordinator;
    r.message_count = 0;
    r.processed = false;
    r.tally_hash = [0u8; 32];
    r.bump = ctx.bumps.round;
    Ok(())
}

#[derive(Accounts)]
pub struct OpenMaciRound<'info> {
    pub circle: Account<'info, Circle>,

    #[account(has_one = circle)]
    pub proposal: Account<'info, MemberProposal>,

    #[account(
        init,
        payer = seat,
        space = MaciRound::SPACE,
        seeds = [b"maci", proposal.key().as_ref()],
        bump
    )]
    pub round: Account<'info, MaciRound>,

    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
