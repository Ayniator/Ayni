use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Karma, KarmaGift, KarmaParams, Membership};

/// F100 — thank a fellow member by giving them some of your karma.
///
/// The giver's balance drops and the receiver's rises. After the Circle's
/// return period the giver may reclaim their own amount (`reclaim_karma`) and
/// the receiver keeps theirs, so the thanks costs the giver nothing in the end
/// — "only a gesture", as asked.
///
/// ONCE PER ORDERED PAIR, EVER. Because the receiver keeps the karma, a gift
/// mints it from nothing; without a bound, two members would thank each other
/// every return period forever and both climb. `karma_gift` is created with
/// `init` — not `init_if_needed` — so a second gift in the same direction fails
/// at account creation. A may thank B once and B may thank A once; what a
/// member can accumulate this way is bounded by how many distinct people chose
/// to thank them, which is the only thing that makes the number mean anything.
///
/// NO OVERDRAFT. A gift moves karma the giver actually holds. Giving what you
/// do not have would make the balance a display rather than a quantity, and
/// would let a member with nothing hand out recognition indefinitely.
pub fn give_karma(ctx: Context<GiveKarma>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts
            .giver_membership
            .is_member_key(&ctx.accounts.signer.key()),
        AyniError::Unauthorized
    );
    let giver = ctx.accounts.giver_membership.commitment;
    let receiver = ctx.accounts.receiver_membership.commitment;
    // Thanking yourself is not a gesture, and with the receiver keeping the
    // karma it would be a pure mint.
    require!(giver != receiver, AyniError::CannotGiveToSelf);

    require!(amount > 0, AyniError::InvalidGiftAmount);

    // The cap is per gift and is set by group conscience; a Circle that has
    // never voted runs on the documented defaults. If this instruction is the
    // first to touch the policy account, materialise ALL of it — a partially
    // written policy leaves the rest at zero, and a zero cap forbids every gift.
    let params = &mut ctx.accounts.karma_params;
    if params.bump == 0 {
        params.gain_sponsee = KarmaParams::DEFAULT_GAIN_SPONSEE;
        params.sponsor_ratio_bps = KarmaParams::DEFAULT_SPONSOR_RATIO_BPS;
        params.min_sponsors = KarmaParams::DEFAULT_MIN_SPONSORS;
        params.max_gift = KarmaParams::DEFAULT_MAX_GIFT;
        params.gift_return_secs = KarmaParams::DEFAULT_GIFT_RETURN_SECS;
        params.bump = ctx.bumps.karma_params;
    }
    require!(amount <= params.max_gift, AyniError::GiftTooLarge);

    // Must actually hold it.
    let from = &mut ctx.accounts.giver_karma;
    // checked_sub, not `-`, and the require! stays. Belt and braces on purpose:
    // this crate builds with `overflow-checks = true`, so a bare `-` would panic
    // on underflow — which is SAFE (no wrap, no silent debit) but surfaces to the
    // member as "attempt to subtract with overflow" instead of "you do not hold
    // that much karma". It also made my own overdraft test pass for the wrong
    // reason: with the require! deleted the test still went red, on the panic, so
    // it could not distinguish a working guard from a missing one. A Sentinel
    // round caught that. Now the guard is what refuses, and the checked_sub is
    // the thing that cannot be wrong even if someone later removes the require!.
    require!(from.points >= amount, AyniError::InsufficientKarma);
    // `expect` rather than a second error path: the require! above has already
    // proven this cannot underflow, so a distinct error here would be dead code
    // that a test could never reach — and while it existed, deleting the
    // require! was undetectable, because both paths returned the same error.
    // This is the arithmetic backstop `overflow-checks` gives us anyway, written
    // explicitly so the intent is not a build-profile side effect.
    from.points = from
        .points
        .checked_sub(amount)
        .expect("balance checked immediately above");
    // No bump write: the giver's account must already exist (you cannot give
    // what you never earned), so its bump is a `bump = giver_karma.bump`
    // constraint rather than a freshly derived one.

    let to = &mut ctx.accounts.receiver_karma;
    to.points = to.points.saturating_add(amount);
    to.bump = ctx.bumps.receiver_karma;

    let g = &mut ctx.accounts.karma_gift;
    g.amount = amount;
    g.given_at = Clock::get()?.unix_timestamp;
    g.returned = false;
    g.bump = ctx.bumps.karma_gift;
    Ok(())
}

#[derive(Accounts)]
pub struct GiveKarma<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), giver_membership.commitment.as_ref()],
        bump = giver_membership.bump,
    )]
    pub giver_membership: Account<'info, Membership>,

    /// The receiver must be a membership OF THE SAME CIRCLE — `has_one = circle`
    /// plus the seed binding. Karma is a Circle-local quantity; letting it cross
    /// would make one Circle's group conscience spend another's.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), receiver_membership.commitment.as_ref()],
        bump = receiver_membership.bump,
    )]
    pub receiver_membership: Account<'info, Membership>,

    /// The Circle's policy. `init_if_needed` for the same reason as
    /// `establish_wing_peer`: an optional PDA whose bump constraint reads the
    /// account cannot be both absent and checked.
    #[account(
        init_if_needed,
        payer = payer,
        space = KarmaParams::SPACE,
        seeds = [b"karmaparams", circle.key().as_ref()],
        bump
    )]
    pub karma_params: Account<'info, KarmaParams>,

    /// `init`, deliberately: creation fails if this pair has already used their
    /// gift in this direction, which is the whole anti-mint guard.
    #[account(
        init,
        payer = payer,
        space = KarmaGift::SPACE,
        seeds = [
            b"karmagift",
            circle.key().as_ref(),
            giver_membership.commitment.as_ref(),
            receiver_membership.commitment.as_ref()
        ],
        bump
    )]
    pub karma_gift: Account<'info, KarmaGift>,

    /// The giver must already have a karma account — you cannot give what you
    /// have never earned, so this is NOT init_if_needed.
    #[account(
        mut,
        seeds = [b"karma", circle.key().as_ref(), giver_membership.commitment.as_ref()],
        bump = giver_karma.bump
    )]
    pub giver_karma: Account<'info, Karma>,

    /// The receiver may never have earned any, so this one is created on demand.
    #[account(
        init_if_needed,
        payer = payer,
        space = Karma::SPACE,
        seeds = [b"karma", circle.key().as_ref(), receiver_membership.commitment.as_ref()],
        bump
    )]
    pub receiver_karma: Account<'info, Karma>,

    /// A key the GIVER controls (owner or guardian).
    pub signer: Signer<'info>,

    /// Rent payer, separate from the authority — same F61 reasoning as
    /// `establish_wing_peer`: a shielded membership's authority has never held a
    /// lamport and must not need to.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
