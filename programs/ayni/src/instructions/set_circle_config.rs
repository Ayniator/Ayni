use anchor_lang::prelude::*;

use crate::state::{Circle, CircleConfig};

/// Set a Circle's tunable policy (donation-on-renew, member-vote quorum/pass
/// thresholds, treasury allowlist toggle). Any Council seat may set it — routine
/// self-governance, revocable by rotation. A separate PDA, so the `Circle` layout
/// is untouched; created on first use. PDA: ["config", circle].
pub fn set_circle_config(
    ctx: Context<SetCircleConfig>,
    renew_donation_lamports: u64,
    vote_quorum_num: u16,
    vote_quorum_den: u16,
    vote_pass_num: u16,
    vote_pass_den: u16,
    treasury_allowlist: bool,
) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;

    let c = &mut ctx.accounts.config;
    c.circle = ctx.accounts.circle.key();
    c.renew_donation_lamports = renew_donation_lamports;
    c.vote_quorum_num = vote_quorum_num;
    c.vote_quorum_den = vote_quorum_den;
    c.vote_pass_num = vote_pass_num;
    c.vote_pass_den = vote_pass_den;
    c.treasury_allowlist = treasury_allowlist;
    c.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct SetCircleConfig<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = CircleConfig::SPACE,
        seeds = [b"config", circle.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// Any Council seat (signs + pays the config rent on first set).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
