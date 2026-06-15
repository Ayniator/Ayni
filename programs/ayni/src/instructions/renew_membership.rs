use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::{Circle, CircleConfig, Membership};

/// Renew (extend) a membership. Tradition 7 (self-support): if the Circle's
/// `CircleConfig.renew_donation_lamports` is non-zero, the renewal is gated on a
/// donation of exactly that amount into the Circle treasury — the act of renewal
/// IS the contribution. `config` is created on first use with a 0 default, so
/// Circles that never set a fee renew for free.
pub fn renew_membership(ctx: Context<RenewMembership>) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &ctx.accounts.circle;
    let membership = &mut ctx.accounts.membership;

    // Extend from the later of now or the current expiry, so renewing early
    // never loses time and renewing late never back-dates the new term.
    let base = membership.expires_at.max(clock.unix_timestamp);
    membership.expires_at = base + circle.membership_period;

    let due = ctx.accounts.config.renew_donation_lamports;
    if due > 0 {
        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        );
        system_program::transfer(cpi, due)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct RenewMembership<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Account<'info, Membership>,

    /// The Circle's policy. Created on first use (default = free renewal); its
    /// `renew_donation_lamports` is the self-support fee. Required (not optional)
    /// so the fee can't be bypassed by omitting it.
    #[account(
        init_if_needed,
        payer = payer,
        space = CircleConfig::SPACE,
        seeds = [b"config", circle.key().as_ref()],
        bump
    )]
    pub config: Account<'info, CircleConfig>,

    /// The Circle treasury PDA — receives the renewal donation.
    #[account(mut, seeds = [b"treasury", circle.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// Anyone may pay to renew a membership (a member can renew anonymously,
    /// or another member can gift a renewal).
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
