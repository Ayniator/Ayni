use anchor_lang::prelude::*;

use crate::council::SEAT_SECRETARY;
use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, Membership, MemberTree, OpenMembership, PersonhoodCredential, TwoSponsorAdmission};

pub fn issue_membership(
    ctx: Context<IssueMembership>,
    commitment: [u8; 32],
    owner: Pubkey,
    recovery_keys: [Pubkey; Membership::MAX_GUARDIANS],
    require_cosign: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &mut ctx.accounts.circle;

    // Admission policy. By default the Scribe-Secretary seat admits members
    // (records the rolls) — group conscience delegates routine issuance to that
    // seat, revocable by Council rotation. A Circle MAY instead be permissionless:
    // when an `OpenMembership` marker for this Circle is present with `open == true`
    // (toggled by any seat via `set_open_membership`), anyone may self-admit and
    // the Scribe-Secretary check is skipped. The marker's `has_one = circle`
    // constraint binds it to this Circle, so it cannot be forged.
    // Epic 1 (two-sponsor admission): when the Circle has opted in, this
    // legacy path is closed — admission goes attest_admission →
    // issue_provisional_membership → confirm_admission. The policy account is
    // REQUIRED and seed-bound (init_if_needed, default off), NOT optional: an
    // optional restriction could be dodged by omitting the account — the same
    // trap withdraw_treasury's allowlist config already defends against.
    require!(!ctx.accounts.two_sponsor.required, AyniError::TwoSponsorRequired);

    let is_open = ctx
        .accounts
        .open_membership
        .as_ref()
        .map(|m| m.open)
        .unwrap_or(false);
    if !is_open {
        circle
            .council
            .require_seat(&ctx.accounts.secretary.key(), SEAT_SECRETARY)?;
    }

    // Sybil gate: one human → one membership. Consume a (one-per-human)
    // PersonhoodCredential proven via `prove_personhood`.
    if circle.require_personhood {
        let cred = ctx
            .accounts
            .personhood
            .as_mut()
            .ok_or(error!(AyniError::PersonhoodRequired))?;
        require!(cred.circle == circle.key(), AyniError::PersonhoodRequired);
        require!(!cred.used, AyniError::PersonhoodRequired);
        cred.used = true;
    }

    let membership = &mut ctx.accounts.membership;
    membership.circle = circle.key();
    membership.commitment = commitment;
    membership.issued_at = clock.unix_timestamp;
    membership.expires_at = clock.unix_timestamp + circle.membership_period;
    membership.level = 0;
    // `owner` may be Pubkey::default() for a fully anonymous member; if set, it
    // is the wallet a 4-of-7 migration can later rebind during key recovery.
    membership.owner = owner;
    // Up to two guardian keys + co-sign policy may be set at issuance or later
    // via `set_recovery`. With a guardian set, even a fully anonymous member
    // (owner = default) can self-migrate and co-sign.
    membership.recovery_keys = recovery_keys;
    membership.require_cosign = require_cosign;
    membership.bump = ctx.bumps.membership;

    circle.member_count = circle.member_count.saturating_add(1);

    // Add the member to the votable set (the commitment is the leaf, == the
    // member-vote circuit's `Poseidon(secret)`).
    let mt: &mut MemberTree = &mut ctx.accounts.member_tree;
    merkle::insert_leaf(mt.depth, &mut mt.next_index, &mut mt.root, &mut mt.filled_subtrees, commitment)?;

    // TODO(ayni): mint a Token-2022 NonTransferable (soulbound) membership token
    // bound to `commitment` via an anchor_spl::token_2022 CPI, for selective
    // public disclosure. Anonymity is preserved because the account is keyed by
    // the ZK commitment, not by a wallet.
    Ok(())
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct IssueMembership<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = secretary,
        space = Membership::SPACE,
        seeds = [b"membership", circle.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub membership: Account<'info, Membership>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Account<'info, MemberTree>,

    /// Required only when `circle.require_personhood`: a one-per-human
    /// `PersonhoodCredential` (from `prove_personhood`), consumed here.
    #[account(mut)]
    pub personhood: Option<Account<'info, PersonhoodCredential>>,

    /// Optional admission-policy marker. Pass it (the ["openjoin", circle] PDA)
    /// to self-admit in a permissionless Circle; omit it for Scribe-Secretary
    /// admission. `has_one = circle` binds it to this Circle.
    #[account(
        seeds = [b"openjoin", circle.key().as_ref()],
        bump = open_membership.bump,
        has_one = circle,
    )]
    pub open_membership: Option<Account<'info, OpenMembership>>,

    /// Signs + pays. Must be the Scribe-Secretary seat for a gated Circle; in a
    /// permissionless Circle (open marker present) it may be any wallet.
    #[account(mut)]
    pub secretary: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Epic 1 policy (["twosponsor", circle]) — required and created on first
    /// use with `required = false`, so it can never be omitted to dodge an
    /// enabled two-sponsor rule (the withdraw_treasury/config pattern).
    /// Appended last so existing clients' account ordering is unchanged.
    #[account(
        init_if_needed,
        payer = secretary,
        space = TwoSponsorAdmission::SPACE,
        seeds = [b"twosponsor", circle.key().as_ref()],
        bump
    )]
    pub two_sponsor: Account<'info, TwoSponsorAdmission>,
}
