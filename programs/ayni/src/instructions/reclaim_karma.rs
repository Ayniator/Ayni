use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Karma, KarmaGift, KarmaParams, Membership};

/// F100 — the giver takes back the karma they gave, once the return period has
/// elapsed. The receiver keeps theirs; this is what makes the gift a gesture
/// rather than a sacrifice.
///
/// PERMISSIONLESS, like every other "apply an already-authorised outcome"
/// instruction here. Nothing is decided at this point — the giver committed to
/// it when they gave, and the clock has done the rest — so requiring their
/// signature would only mean a member who stopped using the app never gets
/// their karma back. Anyone may push it through; the karma can only go to the
/// giver, because the destination is a seed-bound PDA, not an argument.
///
/// ONE-SHOT. `returned` is set before nothing else can happen, and the record is
/// KEPT rather than closed: it is the proof that this pair has already used
/// their one gift in this direction. Closing it to reclaim rent would restore
/// the ability to mint, which is the exact hole the `init` on `give_karma`
/// exists to close.
pub fn reclaim_karma(ctx: Context<ReclaimKarma>) -> Result<()> {
    let gift = &mut ctx.accounts.karma_gift;
    require!(!gift.returned, AyniError::GiftAlreadyReturned);

    // The period is read from the Circle's policy AT RECLAIM TIME, not pinned
    // at gift time. A Circle that shortens it should release karma already out;
    // one that lengthens it should hold that karma longer. Pinning would mean a
    // vote only ever applied to gifts made after it, which is not what "votable"
    // was asked to mean.
    // The params account necessarily exists here: a gift cannot have been made
    // without give_karma materialising it. The bump check is belt-and-braces for
    // a future path that creates it some other way.
    let period = if ctx.accounts.karma_params.bump == 0 {
        KarmaParams::DEFAULT_GIFT_RETURN_SECS
    } else {
        ctx.accounts.karma_params.gift_return_secs
    };

    let now = Clock::get()?.unix_timestamp;
    let due = gift.given_at.saturating_add(period);
    require!(now >= due, AyniError::GiftNotYetReturnable);

    gift.returned = true;

    let back = &mut ctx.accounts.giver_karma;
    back.points = back.points.saturating_add(gift.amount);
    Ok(())
}

#[derive(Accounts)]
pub struct ReclaimKarma<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), giver_membership.commitment.as_ref()],
        bump = giver_membership.bump,
    )]
    pub giver_membership: Account<'info, Membership>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), receiver_membership.commitment.as_ref()],
        bump = receiver_membership.bump,
    )]
    pub receiver_membership: Account<'info, Membership>,

    /// Seed-bound to the Circle, so the return period cannot be swapped for
    /// another Circle's shorter one.
    #[account(seeds = [b"karmaparams", circle.key().as_ref()], bump = karma_params.bump)]
    pub karma_params: Account<'info, KarmaParams>,

    #[account(
        mut,
        seeds = [
            b"karmagift",
            circle.key().as_ref(),
            giver_membership.commitment.as_ref(),
            receiver_membership.commitment.as_ref()
        ],
        bump = karma_gift.bump
    )]
    pub karma_gift: Account<'info, KarmaGift>,

    /// The destination is derived from the GIVER's commitment, so a caller
    /// cannot redirect a reclaim to themselves.
    #[account(
        mut,
        seeds = [b"karma", circle.key().as_ref(), giver_membership.commitment.as_ref()],
        bump = giver_karma.bump
    )]
    pub giver_karma: Account<'info, Karma>,

    /// Anyone may trigger it. No account is created here, so this is a fee-payer
    /// only — the relayer takes this slot with no program change.
    pub caller: Signer<'info>,
}
