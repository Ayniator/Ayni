use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::merkle;
use crate::state::{AdmissionAttestation, Circle, EpochLeaf, Membership, MemberTree, ProvisionalMember, RecentRoots};

/// Attestation B of the two-sponsor pair (Epic 1, amended v0.2): a trusted
/// servant — any holder of one of the 7 Council seats — co-attests the
/// newcomer, as a service function, not a worthiness screen. This completes
/// admission: the commitment enters the MemberTree (the votable set),
/// `member_count` increments, and the provisional marker closes (rent refunded
/// to the servant). The one-way glass opens in both directions at once.
///
/// Distinct-persons rule, enforced here: the servant's signing key must not be
/// a key of the parrain's membership. This is a KEY-LEVEL check, not a person-
/// level one — one human controlling two keypairs (a member wallet used for the
/// parrain attestation and a *different* wallet holding a seat) can still satisfy
/// it. There is no on-chain person primitive to compare against, so the durable
/// one-human bound is `require_personhood` (Sybil gate), with this check catching
/// the common key-reuse case. The confirming party must in any case hold one of
/// the 7 seats, a small trusted set.
pub fn confirm_admission(ctx: Context<ConfirmAdmission>, epoch: u64) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let servant = ctx.accounts.servant.key();

    circle.council.require_any_seat(&servant)?;

    // Two different people. NAMED attestation: program-enforced — the seat
    // wallet must not control the parrain's membership. ANONYMOUS attestation
    // (Epic 2): there is no parrain identity to compare, by design; the rule
    // downgrades to circle-visible (the confirming seat is public and the other
    // six watch), documented in attest_admission_zk.rs.
    if !ctx.accounts.attestation.is_anonymous() {
        let pm = ctx
            .accounts
            .parrain_membership
            .as_ref()
            .ok_or(error!(AyniError::ParrainCannotConfirm))?;
        require!(
            pm.commitment == ctx.accounts.attestation.parrain,
            AyniError::ParrainCannotConfirm
        );
        require!(!pm.is_member_key(&servant), AyniError::ParrainCannotConfirm);
    }

    // Membership must still be live at the moment it becomes full.
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.membership.expires_at > now,
        AyniError::MembershipExpired
    );

    // The newcomer joins the votable set — this, and only this, is what turns
    // a provisional member into a full one.
    let commitment = ctx.accounts.membership.commitment;
    // `recent_roots` is REQUIRED (not optional): a Council seat must not be able
    // to omit it to skip the anti-double-insert marker below, and its epoch is
    // what pins `leaf_epoch` correctly. The `epoch` arg seeds that marker, so it
    // must equal the ring buffer's true current epoch.
    require!(
        epoch == ctx.accounts.recent_roots.epoch,
        AyniError::NotInGoodStanding
    );

    let mt: &mut MemberTree = &mut ctx.accounts.member_tree;
    let leaf_index = mt.next_index;
    merkle::insert_leaf(mt.depth, &mut mt.next_index, &mut mt.root, &mut mt.filled_subtrees, commitment)?;
    ctx.accounts.recent_roots.push(mt.root);

    // F54b: claim this commitment's slot in the current epoch. reinsert_member
    // creates the SAME ["epochleaf", circle, epoch, commitment] PDA with `init`;
    // that init collides here, so a member confirmed during a live epoch (already
    // present in the rebuilt tree) cannot be inserted a SECOND time via the
    // rebuild side door. At epoch 0 the marker is inert (reinsert_member requires
    // epoch > 0), but minting it unconditionally keeps the invariant uniform.
    let circle_key = circle.key();
    let leaf = &mut ctx.accounts.epoch_leaf;
    leaf.circle = circle_key;
    leaf.epoch = epoch;
    leaf.commitment = commitment;
    leaf.leaf_index = leaf_index;
    leaf.bump = ctx.bumps.epoch_leaf;

    // F54: pin the exact insertion position (and its epoch) on the surviving
    // attestation account, so clients can reconstruct the tree's insertion
    // order even when confirmations interleave with direct issuance.
    // 1-BASED (0 = "not yet confirmed"), so a genuine index 0 at epoch 0 is
    // distinguishable from an unconfirmed attestation's zeroed fields.
    let att = &mut ctx.accounts.attestation;
    att.leaf_index = leaf_index.saturating_add(1);
    att.leaf_epoch = epoch;

    circle.member_count = circle.member_count.saturating_add(1);
    // `provisional` closes via the account constraint; its absence is what the
    // frontend (and any program) reads as "full member".
    Ok(())
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct ConfirmAdmission<'info> {
    #[account(mut)]
    pub circle: Box<Account<'info, Circle>>,

    /// The newcomer's (provisional) membership.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = membership.bump,
    )]
    pub membership: Box<Account<'info, Membership>>,

    /// The provisional marker — closed here, one-shot: a second confirmation
    /// has no marker left to close and fails at the constraint.
    #[account(
        mut,
        close = servant,
        has_one = circle,
        seeds = [b"provisional", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = provisional.bump,
        constraint = provisional.commitment == membership.commitment,
    )]
    pub provisional: Box<Account<'info, ProvisionalMember>>,

    /// The parrain's attestation for this newcomer, and through it the
    /// parrain's membership — both needed for the distinct-persons rule.
    /// Mut: `confirm_admission` pins the leaf index/epoch on it (F54).
    #[account(
        mut,
        seeds = [b"attest", circle.key().as_ref(), membership.commitment.as_ref()],
        bump = attestation.bump,
        has_one = circle,
    )]
    pub attestation: Box<Account<'info, AdmissionAttestation>>,

    /// Required for a NAMED attestation (checked in the handler against
    /// `attestation.parrain`); pass null for an anonymous one.
    #[account(has_one = circle)]
    pub parrain_membership: Option<Box<Account<'info, Membership>>>,

    #[account(
        mut,
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    /// F54 ring buffer — REQUIRED. The circle must have cranked `note_root` at
    /// least once (which creates it) before a two-sponsor admission can be
    /// confirmed. Making it mandatory stops a seat from omitting it to skip the
    /// anti-double-insert marker or to force a stale `leaf_epoch`.
    #[account(
        mut,
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Box<Account<'info, RecentRoots>>,

    /// F54b anti-double-insert marker — its `init` collides with
    /// reinsert_member's identical `init`, so a member confirmed during a live
    /// epoch cannot be reinserted a second time. `epoch` (an instruction arg,
    /// checked to equal `recent_roots.epoch`) seeds it.
    #[account(
        init,
        payer = servant,
        space = EpochLeaf::SPACE,
        seeds = [b"epochleaf", circle.key().as_ref(), &epoch.to_le_bytes(), membership.commitment.as_ref()],
        bump
    )]
    pub epoch_leaf: Box<Account<'info, EpochLeaf>>,

    /// Any Council seat (signs; receives the marker's rent).
    #[account(mut)]
    pub servant: Signer<'info>,

    pub system_program: Program<'info, System>,
}
