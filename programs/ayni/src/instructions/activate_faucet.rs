use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, FaucetJar, Membership, Nullifier, WingPeer, FAUCET_AMOUNT_COOLDOWN};

/// The parrain activates the Circle's faucet for the neophyte they sponsor —
/// exactly once, ever (Trust Platform Epic 0).
///
/// The parrain attestation is the existing WingPeer bond: the neophyte
/// designated their sponsor via `establish_wing_peer`, and only a signer holding
/// that wing membership can trigger the grant — no other member, no seat, no one.
/// Uniqueness is enforced by the program, not by policy: `init` on the nullifier
/// PDA IS the refusal, so a second application is rejected by the program even
/// when submitted directly, bypassing the app.
///
/// Scope of that uniqueness, stated exactly: **one grant per membership
/// commitment**, which is one grant per member per Circle — matching Epic 0's
/// "each circle operates a faucet". It is deliberately NOT fellowship-wide.
/// Fellowship-wide dedup would require the same commitment in every Circle, and
/// commitments are per-membership precisely so a member's Circles cannot be
/// linked (Tradition 12). A human who wants one grant across all of AHA must be
/// deduplicated by personhood (`PersonhoodCredential`, F5), not by a linkable
/// commitment — turn `require_personhood` on for that.
///
/// The grant always pays exactly `jar.grant_lamports` to the neophyte's own
/// wallet (`Membership.owner`). Uniformity is what keeps the amount from
/// fingerprinting a recipient, so it is enforced rather than assumed: once a jar
/// has paid at least once, a retune pauses grants for `FAUCET_AMOUNT_COOLDOWN`,
/// so an amount can never be aimed at one person. The jar's blast radius is
/// itself: a compromised faucet loses one jar, never the treasury.
///
/// Documented pilot limitation (Epic 0 → Epic 2): the transaction publicly links
/// the parrain's wallet to the neophyte's — as does the WingPeer record it rests
/// on. The fully anonymous form (ZK vouch-proof + relayer) lands with Epic 2.
pub fn activate_faucet(ctx: Context<ActivateFaucet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Parrain: signs with a key of the wing membership, in good standing.
    require!(
        ctx.accounts
            .parrain_membership
            .is_member_key(&ctx.accounts.parrain.key()),
        AyniError::Unauthorized
    );
    require!(
        ctx.accounts.parrain_membership.expires_at > now,
        AyniError::MembershipExpired
    );

    // The attestation: the signer's membership IS the neophyte's designated wing.
    require!(
        ctx.accounts.wing_peer.active
            && ctx.accounts.wing_peer.wing == ctx.accounts.parrain_membership.commitment,
        AyniError::NotParrain
    );

    // Neophyte: live membership with a wallet of their own to receive first gas.
    require!(
        ctx.accounts.neophyte_membership.expires_at > now,
        AyniError::MembershipExpired
    );
    let owner = ctx.accounts.neophyte_membership.owner;
    require!(owner != Pubkey::default(), AyniError::NeophyteWalletUnset);
    require!(
        ctx.accounts.recipient.key() == owner,
        AyniError::WalletMismatch
    );

    // Uniformity guard: once a jar has started paying, a retuned amount waits
    // out FAUCET_AMOUNT_COOLDOWN, so the Treasurer cannot set a distinctive
    // value for one neophyte's activation and restore it afterwards. A jar that
    // has never granted is simply being configured — nobody to single out yet,
    // and a circle should not have to wait a day to welcome its first member.
    if ctx.accounts.jar.granted > 0 {
        require!(
            now.saturating_sub(ctx.accounts.jar.amount_changed_at) >= FAUCET_AMOUNT_COOLDOWN,
            AyniError::FaucetAmountCooling
        );
    }

    // Pay exactly the uniform grant, preserving the jar account's rent floor.
    let amount = ctx.accounts.jar.grant_lamports;
    let jar_info = ctx.accounts.jar.to_account_info();
    let floor = Rent::get()?.minimum_balance(FaucetJar::SPACE);
    let available = jar_info.lamports().saturating_sub(floor);
    require!(available >= amount, AyniError::FaucetInsufficient);

    **jar_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;

    ctx.accounts.jar.granted = ctx.accounts.jar.granted.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateFaucet<'info> {
    pub circle: Account<'info, Circle>,

    /// The sponsor's membership (the wing side of the WingPeer bond).
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), parrain_membership.commitment.as_ref()],
        bump = parrain_membership.bump,
    )]
    pub parrain_membership: Account<'info, Membership>,

    /// The newcomer's membership; the grant goes to its `owner` wallet.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump = neophyte_membership.bump,
    )]
    pub neophyte_membership: Account<'info, Membership>,

    /// The neophyte's designated sponsor bond — seed-bound to the neophyte, so
    /// it can't be swapped for someone else's.
    #[account(
        has_one = circle,
        seeds = [b"wingpeer", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump = wing_peer.bump,
    )]
    pub wing_peer: Account<'info, WingPeer>,

    /// One grant per membership commitment — `init` collision IS the refusal.
    /// Circle-scoped: see the scope note above; cross-Circle dedup belongs to
    /// personhood, not to a commitment that must stay unlinkable.
    #[account(
        init,
        payer = parrain,
        space = Nullifier::SPACE,
        seeds = [b"faucetnull", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump
    )]
    pub grant_nullifier: Account<'info, Nullifier>,

    #[account(mut, has_one = circle, seeds = [b"faucet", circle.key().as_ref()], bump = jar.bump)]
    pub jar: Account<'info, FaucetJar>,

    /// CHECK: must equal the neophyte membership's `owner`.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// The parrain (signs + pays the nullifier's rent — part of the welcome).
    #[account(mut)]
    pub parrain: Signer<'info>,

    pub system_program: Program<'info, System>,
}
