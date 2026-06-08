use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{Circle, Membership, MemberTree, PersonhoodCredential};

pub fn issue_membership(
    ctx: Context<IssueMembership>,
    commitment: [u8; 32],
    owner: Pubkey,
    recovery_keys: [Pubkey; Membership::MAX_GUARDIANS],
    require_cosign: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &mut ctx.accounts.circle;

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
    #[account(mut, has_one = authority)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
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

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
