use anchor_lang::prelude::*;

use crate::state::{Circle, TwoSponsorAdmission};

/// Toggle the Circle's two-sponsor admission policy (Trust Platform Epic 1,
/// amended v0.2). When required, every admission takes the asymmetric pair —
/// the parrain (any member in good standing) and a trusted servant (any of the
/// 7 seats), two different people — via `attest_admission` →
/// `issue_provisional_membership` → `confirm_admission`. Any Council seat may
/// toggle it; a sibling marker PDA, so the `Circle` layout is untouched and
/// existing Circles need no migration. PDA: ["twosponsor", circle].
pub fn set_two_sponsor_admission(ctx: Context<SetTwoSponsorAdmission>, required: bool) -> Result<()> {
    ctx.accounts
        .circle
        .council
        .require_any_seat(&ctx.accounts.seat.key())?;
    let policy = &mut ctx.accounts.policy;
    policy.circle = ctx.accounts.circle.key();
    policy.required = required;
    policy.bump = ctx.bumps.policy;
    Ok(())
}

#[derive(Accounts)]
pub struct SetTwoSponsorAdmission<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        init_if_needed,
        payer = seat,
        space = TwoSponsorAdmission::SPACE,
        seeds = [b"twosponsor", circle.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, TwoSponsorAdmission>,

    /// Any Council seat (signs + pays the marker's rent on first use).
    #[account(mut)]
    pub seat: Signer<'info>,

    pub system_program: Program<'info, System>,
}
