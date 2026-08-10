use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{
    AdmissionAttestation, Circle, Membership, PersonhoodCredential, ProvisionalMember,
    TwoSponsorAdmission,
};

/// Provisional admission (Epic 1 + Epic 9): with the parrain's attestation in
/// place, the newcomer's membership is created — but their commitment is NOT
/// inserted into the MemberTree, and `member_count` does not move. The page can
/// go live and the faucet can pay first gas (`activate_faucet` reads the
/// membership account, not the tree), but every members-only proof — votes,
/// elections, presence — fails by construction until a trusted servant
/// co-attests via `confirm_admission`. The one-way glass is structural: there
/// is no flag to forget, the commitment simply is not in the votable set.
///
/// Permissionless to execute (the newcomer's own wallet typically pays): the
/// authorization IS the attestation account, not the caller's identity. The
/// Sybil gate (`require_personhood`) still applies unchanged.
pub fn issue_provisional_membership(
    ctx: Context<IssueProvisionalMembership>,
    commitment: [u8; 32],
    owner: Pubkey,
    recovery_keys: [Pubkey; Membership::MAX_GUARDIANS],
    require_cosign: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let circle = &ctx.accounts.circle;

    require!(ctx.accounts.policy.required, AyniError::TwoSponsorNotEnabled);

    // Sybil gate: one human → one membership, exactly as in `issue_membership`.
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
    membership.owner = owner;
    membership.recovery_keys = recovery_keys;
    membership.require_cosign = require_cosign;
    membership.bump = ctx.bumps.membership;

    let p = &mut ctx.accounts.provisional;
    p.circle = circle.key();
    p.commitment = commitment;
    p.issued_at = clock.unix_timestamp;
    p.bump = ctx.bumps.provisional;

    // Deliberately NOT here: member_tree insertion, member_count increment.
    // Both happen in `confirm_admission`, and nowhere else.
    Ok(())
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct IssueProvisionalMembership<'info> {
    pub circle: Account<'info, Circle>,

    /// The Circle must have opted into two-sponsor admission.
    #[account(
        seeds = [b"twosponsor", circle.key().as_ref()],
        bump = policy.bump,
        has_one = circle,
    )]
    pub policy: Account<'info, TwoSponsorAdmission>,

    /// The parrain's attestation for exactly this newcomer — the authorization.
    #[account(
        seeds = [b"attest", circle.key().as_ref(), commitment.as_ref()],
        bump = attestation.bump,
        has_one = circle,
        constraint = attestation.newcomer == commitment,
    )]
    pub attestation: Account<'info, AdmissionAttestation>,

    #[account(
        init,
        payer = payer,
        space = Membership::SPACE,
        seeds = [b"membership", circle.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub membership: Account<'info, Membership>,

    /// The provisional marker — its existence IS the status; closed on confirm.
    #[account(
        init,
        payer = payer,
        space = ProvisionalMember::SPACE,
        seeds = [b"provisional", circle.key().as_ref(), commitment.as_ref()],
        bump
    )]
    pub provisional: Account<'info, ProvisionalMember>,

    /// Required only when `circle.require_personhood` — consumed here.
    #[account(mut)]
    pub personhood: Option<Account<'info, PersonhoodCredential>>,

    /// Whoever pays the rent — typically the newcomer's fresh wallet (first
    /// gas may come from the parrain or the faucet right after).
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
