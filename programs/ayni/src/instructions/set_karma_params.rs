use anchor_lang::prelude::*;

use crate::council::{Proposal, ProposalAction};
use crate::errors::AyniError;
use crate::state::{Circle, KarmaParams};

/// F98 — apply an executed 4-of-7 `SetKarmaParams` proposal.
///
/// Mirrors `set_treasury_wallet` exactly: the contestable, time-locked proposal
/// authorises, and this instruction carries it out. Permissionless to trigger
/// once authorised — anyone may push a decision the Council has already made.
///
/// WHY THIS IS GOVERNED AT ALL. The numbers decide how fast one member's total
/// grows relative to another's, which is the whole substance of a ranking. A
/// constant in the source would put that in a developer's hands; a 4-of-7 vote
/// with a contest window puts it in the group's, which is the closest this
/// design comes to Tradition 2 now that the no-ranking rule is waived.
///
/// `min_sponsors` is written here too, and is ADVISORY: nothing in this program
/// refuses an action because a member is below it. Do not make it a gate without
/// a separate decision — the request was explicit that a member with too few
/// sponsors, or none, keeps full use of the platform.
pub fn set_karma_params(ctx: Context<SetKarmaParams>) -> Result<()> {
    require!(ctx.accounts.proposal.executed, AyniError::ThresholdNotMet);
    // One-shot, like every other proposal-drawn action: without this an executed
    // proposal could be replayed. Harmless for an idempotent write today, but
    // the guard is what stops it becoming harmful when someone adds a side
    // effect here later.
    require!(!ctx.accounts.proposal.drained, AyniError::AlreadyExecuted);

    let (gain_sponsee, sponsor_ratio_bps, min_sponsors, max_gift, gift_return_secs) =
        match &ctx.accounts.proposal.action {
            ProposalAction::SetKarmaParams {
                gain_sponsee,
                sponsor_ratio_bps,
                min_sponsors,
                max_gift,
                gift_return_secs,
            } => (
                *gain_sponsee,
                *sponsor_ratio_bps,
                *min_sponsors,
                *max_gift,
                *gift_return_secs,
            ),
            _ => return err!(AyniError::WrongProposalAction),
        };

    // A ratio above 100% would credit the sponsor more than the sponsee — not
    // obviously wrong, but certainly not what "the sponsor gets 10% of the
    // sponsee's gain" describes, so it must be voted for deliberately rather
    // than reached by a typo in a basis-point figure.
    require!(sponsor_ratio_bps <= 10_000, AyniError::InvalidKarmaRatio);

    // A negative return period would make every gift reclaimable the instant it
    // was made, quietly turning the gesture into a free mint. Zero is allowed as
    // an explicit "no waiting period" for a Circle that votes for it.
    require!(gift_return_secs >= 0, AyniError::InvalidGiftAmount);

    ctx.accounts.proposal.drained = true;

    let p = &mut ctx.accounts.params;
    p.gain_sponsee = gain_sponsee;
    p.sponsor_ratio_bps = sponsor_ratio_bps;
    p.min_sponsors = min_sponsors;
    p.max_gift = max_gift;
    p.gift_return_secs = gift_return_secs;
    p.bump = ctx.bumps.params;
    Ok(())
}

#[derive(Accounts)]
pub struct SetKarmaParams<'info> {
    pub circle: Account<'info, Circle>,

    #[account(mut, has_one = circle)]
    pub proposal: Account<'info, Proposal>,

    /// Created on first use, so a Circle need not vote before karma works — it
    /// runs on `KarmaParams::DEFAULT_*` until the Council decides otherwise.
    #[account(
        init_if_needed,
        payer = caller,
        space = KarmaParams::SPACE,
        seeds = [b"karmaparams", circle.key().as_ref()],
        bump
    )]
    pub params: Account<'info, KarmaParams>,

    /// Whoever triggers the (permissionless) application; pays rent on first use.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
