use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Karma, KarmaAward, KarmaParams, Membership, WingPeer};

/// A member designates (or changes) their WingPeer — a more-experienced member
/// who mentors them. The caller must control the mentee membership (its owner or
/// a guardian key); the wing must be a real membership of the same Circle. A
/// member sets their own wing — never imposed. PDA: ["wingpeer", circle, mentee].
pub fn establish_wing_peer(ctx: Context<EstablishWingPeer>) -> Result<()> {
    require!(
        ctx.accounts
            .mentee_membership
            .is_member_key(&ctx.accounts.signer.key()),
        AyniError::Unauthorized
    );
    let mentee = ctx.accounts.mentee_membership.commitment;
    let wing = ctx.accounts.wing_membership.commitment;
    require!(mentee != wing, AyniError::Unauthorized); // can't wing yourself

    let now = Clock::get()?.unix_timestamp;
    let w = &mut ctx.accounts.wing_peer;
    w.circle = ctx.accounts.circle.key();
    w.mentee = mentee;
    w.wing = wing;
    w.established_at = now;
    w.active = true;
    w.bump = ctx.bumps.wing_peer;

    // --- F98: karma, credited ONCE per pair, ever ---------------------------
    //
    // Accepting a Link is the moment the request names, and this is that moment:
    // the mentee signs here, which is the whole of "accept".
    //
    // The award record is what stops this being a faucet. This instruction is
    // `init_if_needed` and `end_wing_peer` only flips a flag, so a pair may
    // link, release and re-link freely; without the guard they could mint each
    // other an unbounded total in a loop. Re-establishing stays allowed — it is
    // simply not paid for twice.
    let award = &mut ctx.accounts.karma_award;
    if !award.credited {
        // A Circle that has never voted runs on the documented defaults, so
        // karma works from day one without a governance step. `bump == 0` is
        // the tell that this account was created by THIS instruction moments
        // ago and never written: a real bump is never zero for these seeds in
        // practice, and `set_karma_params` always writes one.
        let params = &mut ctx.accounts.karma_params;
        if params.bump == 0 {
            params.gain_sponsee = KarmaParams::DEFAULT_GAIN_SPONSEE;
            params.sponsor_ratio_bps = KarmaParams::DEFAULT_SPONSOR_RATIO_BPS;
            params.min_sponsors = KarmaParams::DEFAULT_MIN_SPONSORS;
            params.bump = ctx.bumps.karma_params;
        }
        let (gain, ratio) = (params.gain_sponsee, params.sponsor_ratio_bps);
        let sponsor_gain = KarmaParams::sponsor_gain(gain, ratio);

        // Saturating, so a total can never wrap to a small number — which for a
        // ranking would be worse than it merely being large.
        let mk = &mut ctx.accounts.mentee_karma;
        mk.points = mk.points.saturating_add(gain);
        mk.bump = ctx.bumps.mentee_karma;

        let wk = &mut ctx.accounts.wing_karma;
        wk.points = wk.points.saturating_add(sponsor_gain);
        wk.bump = ctx.bumps.wing_karma;

        award.credited = true;
        award.bump = ctx.bumps.karma_award;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct EstablishWingPeer<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), mentee_membership.commitment.as_ref()],
        bump = mentee_membership.bump,
    )]
    pub mentee_membership: Account<'info, Membership>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), wing_membership.commitment.as_ref()],
        bump = wing_membership.bump,
    )]
    pub wing_membership: Account<'info, Membership>,

    #[account(
        init_if_needed,
        payer = payer,
        space = WingPeer::SPACE,
        seeds = [b"wingpeer", circle.key().as_ref(), mentee_membership.commitment.as_ref()],
        bump
    )]
    pub wing_peer: Account<'info, WingPeer>,

    /// F98 — the Circle's karma policy, seed-bound so a caller cannot substitute
    /// another Circle's (or their own) numbers.
    ///
    /// `init_if_needed` rather than optional: an optional PDA whose `bump`
    /// constraint reads the account itself cannot be "absent" and "checked" at
    /// once, and the ambiguity showed up immediately as an
    /// AccountOwnedByWrongProgram on a Circle that had never voted. So the
    /// account always exists, and the FIRST Link materialises the documented
    /// defaults into it. A later 4-of-7 `SetKarmaParams` overwrites them. The
    /// upshot is better than the optional version: a Circle's karma policy is
    /// always readable on chain rather than being an implicit constant.
    #[account(
        init_if_needed,
        payer = payer,
        space = KarmaParams::SPACE,
        seeds = [b"karmaparams", circle.key().as_ref()],
        bump
    )]
    pub karma_params: Account<'info, KarmaParams>,

    /// F98 — the once-per-pair award record. Keyed by BOTH commitments, so a
    /// released-and-restored Link is not paid for twice.
    #[account(
        init_if_needed,
        payer = payer,
        space = KarmaAward::SPACE,
        seeds = [
            b"karmaaward",
            circle.key().as_ref(),
            mentee_membership.commitment.as_ref(),
            wing_membership.commitment.as_ref()
        ],
        bump
    )]
    pub karma_award: Account<'info, KarmaAward>,

    #[account(
        init_if_needed,
        payer = payer,
        space = Karma::SPACE,
        seeds = [b"karma", circle.key().as_ref(), mentee_membership.commitment.as_ref()],
        bump
    )]
    pub mentee_karma: Account<'info, Karma>,

    #[account(
        init_if_needed,
        payer = payer,
        space = Karma::SPACE,
        seeds = [b"karma", circle.key().as_ref(), wing_membership.commitment.as_ref()],
        bump
    )]
    pub wing_karma: Account<'info, Karma>,

    /// A key the mentee controls (owner or guardian).
    pub signer: Signer<'info>,

    /// Rent payer — SEPARATE from the authority above, and that separation is
    /// the whole of F61's usability story. A shielded membership's authority is
    /// the key derived in `shield_membership`, which has never held a lamport
    /// and must never need to: funding a freshly-derived "anonymous" pubkey from
    /// a wallet the member is already known by is a single-hop funding transfer,
    /// one of the most reliable clustering heuristics in chain analysis, and a
    /// far STRONGER link than the co-signature this instruction already implies.
    /// The derived key signs; somebody else's lamports pay — an ordinary wallet,
    /// or the F55 relayer, which takes this slot with no program change.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
