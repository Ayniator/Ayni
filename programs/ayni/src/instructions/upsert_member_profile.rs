use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, MemberProfile, Membership};

/// Write the member's ENCRYPTED profile object — the served bio, and the pointer
/// to the served avatar ciphertext (F60 Phase-2).
///
/// The program never sees a bio. It stores a fixed-length blob it cannot read
/// and has no opinion about. That is the entire point: before this, per-element
/// visibility was a rendering decision in the viewer's own browser
/// (`mayView`), which a patched client could ignore because the plaintext was
/// there to be had. Now the bytes on chain are ciphertext under a per-element
/// key, and a viewer outside the audience is not "shown a lock" — they are
/// handed noise they cannot distinguish from an empty profile.
///
/// FIXED LENGTH IS THE INVARIANT. `bio_ct` is `MemberProfile::BIO_CT` bytes,
/// always. A member with nothing to say is expected to store random bytes. If
/// this ever became variable-length, or optional, the length would become the
/// disclosure — "this one is hiding something" — and hidden would stop being
/// indistinguishable from absent.
///
/// Bumping `epoch` re-keys everything and expires every outstanding key drop at
/// once. That is how access is withdrawn, and it names nobody: there is no
/// "revoked B" record, only a number that went up.
pub fn upsert_member_profile(
    ctx: Context<UpsertMemberProfile>,
    enc_pub: [u8; 32],
    epoch: u16,
    bio_ct: [u8; MemberProfile::BIO_CT],
    avatar_ref: [u8; MemberProfile::AVATAR_REF],
) -> Result<()> {
    require!(
        ctx.accounts
            .member_membership
            .is_member_key(&ctx.accounts.member.key()),
        AyniError::Unauthorized
    );
    require!(enc_pub != [0u8; 32], AyniError::InvalidProfileKey);

    let p = &mut ctx.accounts.profile;
    // An epoch may only go forward: rolling it back would resurrect key drops
    // the member had already stranded.
    require!(epoch >= p.epoch, AyniError::EpochWentBackwards);

    p.circle = ctx.accounts.circle.key();
    p.member = ctx.accounts.member_membership.commitment;
    p.enc_pub = enc_pub;
    p.epoch = epoch;
    p.bio_ct = bio_ct;
    p.avatar_ref = avatar_ref;
    p.bump = ctx.bumps.profile;
    Ok(())
}

#[derive(Accounts)]
pub struct UpsertMemberProfile<'info> {
    pub circle: Box<Account<'info, Circle>>,

    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump = member_membership.bump,
    )]
    pub member_membership: Box<Account<'info, Membership>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = MemberProfile::SPACE,
        seeds = [MemberProfile::SEED, circle.key().as_ref(), member_membership.commitment.as_ref()],
        bump
    )]
    pub profile: Box<Account<'info, MemberProfile>>,

    /// A key the member controls (owner or guardian). AUTHORISES ONLY — it is
    /// deliberately not `mut` and pays nothing.
    ///
    /// This separation is the whole point. When a membership is shielded, this
    /// is the derived key from `shield_membership`, which has never held a
    /// lamport and must never need to. Making it the rent payer would force the
    /// member to send SOL to a freshly-derived "anonymous" pubkey from a wallet
    /// someone already knows them by — a single-hop funding transfer, which is
    /// one of the most reliable clustering heuristics in chain analysis, and a
    /// far stronger link than the co-signature this instruction already
    /// implies. The derived key signs; somebody else's lamports pay.
    pub member: Signer<'info>,

    /// Rent payer — any funded wallet. Normally the member's ordinary wallet;
    /// a relayer can take this slot with no change to the program.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
