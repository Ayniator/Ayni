use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::VisibilityKeyDrop;

/// Drop a sealed element key where exactly one viewer can find it (F60 Phase-2).
///
/// This is the key distribution the visibility policy always needed and never
/// had. The member seals `[bio_key ‖ avatar_key]` (zeroing whichever element
/// this viewer is not in the audience for) to the X25519 shared secret between
/// their profile key and the viewer's, and writes it at an address BOTH of them
/// can compute and NOBODY else can:
///
///   drop = PDA["vdrop", SHA256(domain ‖ ECDH(owner, viewer) ‖ owner_commitment ‖ epoch)]
///
/// THE ACCOUNT NAMES NEITHER PARTY, AND THAT IS DELIBERATE. It has no granter,
/// no recipient, no membership, no authority. Read every drop that exists and
/// you have a pile of indistinguishable 104-byte blobs: you cannot say who
/// granted, who received, or how many people any one member trusted. An
/// `authority` field would be a memcmp handle on the granter, and the audience
/// counts derived from it would be precisely the interest graph Epic 5 forbids.
///
/// NO MEMBERSHIP IS PASSED AND NO MEMBER SIGNATURE IS REQUIRED — also
/// deliberate. Requiring one would put the granter's membership account into
/// every grant transaction, publishing "this membership granted access N times"
/// in the transaction log. It is safe to leave open because a drop is only ever
/// LOOKED UP at an address derived from a Diffie-Hellman secret: a stranger
/// cannot compute an address anyone will read, and a forged drop at an address
/// they can compute would have to contain a key they do not know. The worst a
/// spammer achieves is paying rent to write noise nobody fetches.
///
/// WRITE-ONCE, NO REVOKE. `init` fails if the address is taken. Access is
/// withdrawn by bumping `MemberProfile.epoch`, which changes both the element
/// keys and every drop address, stranding the whole previous epoch silently.
pub fn grant_visibility_key(
    ctx: Context<GrantVisibilityKey>,
    drop_id: [u8; 32],
    sealed: [u8; VisibilityKeyDrop::SEALED],
    epoch: u16,
) -> Result<()> {
    require!(drop_id != [0u8; 32], AyniError::InvalidKeyDrop);

    let d = &mut ctx.accounts.key_drop;
    d.sealed = sealed;
    d.epoch = epoch;
    d.bump = ctx.bumps.key_drop;
    Ok(())
}

#[derive(Accounts)]
#[instruction(drop_id: [u8; 32])]
pub struct GrantVisibilityKey<'info> {
    #[account(
        init,
        payer = payer,
        space = VisibilityKeyDrop::SPACE,
        seeds = [VisibilityKeyDrop::SEED, drop_id.as_ref()],
        bump
    )]
    pub key_drop: Box<Account<'info, VisibilityKeyDrop>>,

    /// Rent only. Not recorded anywhere in the account — see the note above.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
