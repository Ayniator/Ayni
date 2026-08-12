use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Membership, OwnerTag};

/// Shield a membership's ownership: stop `Membership.owner` from being the
/// member's public wallet, and give the member a private way to find the
/// membership again (F61 — the roster leak).
///
/// THE PROBLEM. `owner` sits at a fixed offset in every `Membership`, so a
/// single `getProgramAccounts` memcmp against a wallet listed every Circle that
/// wallet belongs to. Anyone could do it, from anywhere, with no key and no
/// permission — the membership graph published by accident. It stayed that way
/// because `owner` did two unrelated jobs at once: it authorised the member's
/// signatures, AND it was the index the member's own client used to find
/// "my memberships".
///
/// THE FIX. Split the two jobs.
/// * FINDING moves to `OwnerTag`, a PDA whose ADDRESS is a hash the member
///   derives from a secret only they hold (see `state::OwnerTag`). There is no
///   field to scan, so there is nothing to enumerate.
/// * SIGNING stays on `owner`, but the member rebinds it to a `shielded_owner`
///   key derived from their master secret — a key that is theirs, that they can
///   always re-derive (the master secret is the credential of record, and
///   recovery reconstructs it bit-identically), and that a stranger cannot
///   connect to the wallet they know the person by. Passing `Pubkey::default()`
///   goes further: no key at all on the account, guardians only.
///
/// Both happen in ONE instruction on purpose. Done as two transactions there is
/// a window in which the tag exists and the public wallet is still bound —
/// which would hand an observer exactly the correlation this removes.
///
/// WHAT THIS DOES NOT DO, stated plainly: a wallet that later signs FOR the
/// shielded membership appears in that transaction next to it, so transaction
/// history can still link the two. Only fee payment by a relayer (or by the
/// shielded key itself) closes that. This instruction closes the passive,
/// keyless, whole-roster scan — not the transaction graph.
///
/// AUTHORISATION mirrors `member_migrate` exactly: when an `owner` is set, only
/// the owner may shield (a lone stolen guardian must not be able to seize the
/// membership by re-owning it); a fully anonymous membership may be seeded by
/// any member key.
pub fn shield_membership(
    ctx: Context<ShieldMembership>,
    tag: [u8; 32],
    shielded_owner: Pubkey,
) -> Result<()> {
    require!(tag != [0u8; 32], AyniError::InvalidOwnerTag);

    let membership = &mut ctx.accounts.membership;
    let who = ctx.accounts.member.key();
    if membership.owner != Pubkey::default() {
        require!(who == membership.owner, AyniError::Unauthorized);
    } else {
        require!(membership.is_member_key(&who), AyniError::Unauthorized);
    }

    // Shielding to the key you are signing with would leave the wallet bound and
    // the leak wide open, while looking like it had been fixed.
    require!(shielded_owner != who, AyniError::OwnerNotShielded);

    // Never brick a membership: dropping `owner` to default is allowed only when
    // a guardian remains, otherwise no key on earth could act for it again.
    let has_guardian = membership
        .recovery_keys
        .iter()
        .any(|k| *k != Pubkey::default());
    require!(
        shielded_owner != Pubkey::default() || has_guardian,
        AyniError::MembershipWouldBeUnusable
    );

    membership.owner = shielded_owner;

    let tag_acct = &mut ctx.accounts.owner_tag;
    tag_acct.membership = membership.key();
    tag_acct.bump = ctx.bumps.owner_tag;
    Ok(())
}

#[derive(Accounts)]
#[instruction(tag: [u8; 32])]
pub struct ShieldMembership<'info> {
    #[account(mut)]
    pub membership: Box<Account<'info, Membership>>,

    /// The private index the member will find this membership by. `init`, never
    /// `init_if_needed`: a tag is written once, and rotation mints a new one at
    /// the next derivation index rather than rewriting this.
    #[account(
        init,
        payer = payer,
        space = OwnerTag::SPACE,
        seeds = [OwnerTag::SEED, tag.as_ref()],
        bump
    )]
    pub owner_tag: Box<Account<'info, OwnerTag>>,

    /// The membership's current `owner` (or, for an anonymous membership, any
    /// key it controls). AUTHORISES ONLY — not `mut`, pays nothing.
    ///
    /// On a FIRST shield this is the member's ordinary wallet, which could have
    /// paid. On a RE-shield (rotating to a new tag at the next index) it is the
    /// previous derived key, which holds nothing — and must never need to, for
    /// the reason spelled out in `upsert_member_profile`: funding a derived
    /// "anonymous" key from a known wallet links them harder than co-signing
    /// does. Same split, same reason, both instructions.
    pub member: Signer<'info>,

    /// Rent payer — any funded wallet, or a relayer.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
