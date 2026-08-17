use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::state::{Circle, Presence};

/// Canonical external nullifier for erasing a presence record.
///
/// `docs/presence.md` §2 fixes this preimage; it is reproduced here rather than
/// derived from `presence_external_nullifier` because the two must NOT be able
/// to drift into each other. A shared helper with a tag parameter would make
/// "pass the wrong tag" a one-character mistake, and the consequence of that
/// mistake is that an attestation proof would be replayable as an erasure proof
/// (and the reverse), letting a witness delete a record they were only ever
/// entitled to co-sign.
///
/// `last_month` — the value being erased — is in the preimage, so a proof
/// authorising the erasure of March cannot be held and replayed against the
/// April record that replaces it.
///
/// Masked `b[0] &= 0x1f` so the value is always below BN254's p, exactly as
/// everywhere else. The browser prover must mask identically.
pub fn clear_external_nullifier(
    circle: &Pubkey,
    subject_commitment: &[u8; 32],
    last_month: u32,
) -> [u8; 32] {
    let mut b = hashv(&[
        b"AHA-presence-clear",
        circle.as_ref(),
        subject_commitment.as_ref(),
        &last_month.to_le_bytes(),
    ])
    .to_bytes();
    b[0] &= 0x1f;
    b
}

/// F59 — the subject erases their own presence record.
///
/// WHY THIS EXISTS. `docs/presence.md` §1 accepts a real residual: the ledger
/// records that writes happened, and no on-chain design can retract that. What
/// this instruction can do is make **live state** identical between "erased" and
/// "never claimed" — the account is closed, so a reader deriving the PDA finds
/// nothing, and the member page renders a month or nothing with no third state.
/// That is the whole of the promise, and it is deliberately not more.
///
/// ONE PROOF, NOT TWO. Attesting needs a witness because it is a claim ABOUT a
/// month someone else must vouch for. Erasing is a claim about nothing — it only
/// removes. Requiring a witness to erase would mean a member could be held to a
/// record because no fellow member would sit down with them, which inverts the
/// consent property the subject proof exists to guarantee. So the subject's
/// consent proof stands alone here, against `single_leaf_root(commitment)`,
/// computed on chain.
///
/// WHAT A REPLAY WOULD COST, and why it is blocked. The proof authorises erasing
/// one specific `last_month` in one specific Circle: both are in `E_clear`, and
/// `last_month` is read from the ACCOUNT rather than taken as an argument, so a
/// caller cannot name a stale month to make an old proof fit. Once the record
/// advances to April, a March erasure proof verifies against nothing.
///
/// The rent refund goes to the payer, who should be the relayer — the same
/// reasoning as `attest_presence_zk`. A wallet that collects the refund links
/// itself to the erasure's timing, which is precisely the correlation the
/// relayer exists to break.
pub fn clear_presence(
    ctx: Context<ClearPresence>,
    subject_commitment: [u8; 32],
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    // Read the month from state, never from an argument. This is what makes the
    // proof bind to the record actually being destroyed.
    let last_month = ctx.accounts.presence.last_month;

    let external =
        clear_external_nullifier(&ctx.accounts.circle.key(), &subject_commitment, last_month);
    let choice = crate::merkle::field_from_u8(1); // 1 = "I consent"

    // Consent, and only consent: the sole witness satisfying this root is a
    // secret `s` with `Poseidon(s) == subject_commitment`.
    let root = crate::merkle::single_leaf_root(&subject_commitment)?;
    let inputs: [[u8; 32]; 4] = [nullifier, root, external, choice];
    verify_anchored_proof(
        ProofKind::MemberVote,
        &proof_a,
        &proof_b,
        &proof_c,
        &inputs,
        AyniError::VoteProofInvalid,
    )?;

    // The `close = payer` constraint does the erasure. Nothing is written first:
    // a "cleared" flag, a tombstone, or a zeroed-but-live account would each be
    // a third state distinguishable from never-claimed, which is the one thing
    // this instruction exists to prevent.
    Ok(())
}

#[derive(Accounts)]
#[instruction(subject_commitment: [u8; 32])]
pub struct ClearPresence<'info> {
    pub circle: Account<'info, Circle>,

    /// Closed, not emptied. `has_one` is impossible here by design — `Presence`
    /// stores neither its circle nor its member (see `docs/presence.md` §3), so
    /// the PDA seeds ARE the binding, and Anchor checks them.
    #[account(
        mut,
        close = payer,
        seeds = [b"presence", circle.key().as_ref(), subject_commitment.as_ref()],
        bump = presence.bump
    )]
    pub presence: Account<'info, Presence>,

    /// A relayer pays and is refunded, so the subject's wallet never appears.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instructions::attest_presence_zk::presence_external_nullifier;

    fn c() -> Pubkey {
        Pubkey::new_from_array([7u8; 32])
    }
    fn m() -> [u8; 32] {
        [9u8; 32]
    }

    /// THE one that matters. If these two ever collide, a proof authorising an
    /// attestation also authorises an erasure — so a witness, who by design
    /// holds a proof under the attestation's `E`, could delete the record they
    /// were only entitled to co-sign. Same circle, same commitment, same month:
    /// only the tag differs, and only the tag is stopping it.
    #[test]
    fn attesting_and_erasing_never_share_a_nullifier() {
        assert_ne!(
            presence_external_nullifier(&c(), &m(), 674),
            clear_external_nullifier(&c(), &m(), 674)
        );
    }

    /// Both land in BN254's scalar field. p > 2^253, so clearing the top three
    /// bits of the big-endian value is sufficient and needs no reduction the
    /// prover could disagree with.
    #[test]
    fn both_tags_produce_field_elements() {
        for month in [0u32, 1, 674, u32::MAX] {
            assert_eq!(presence_external_nullifier(&c(), &m(), month)[0] & 0xe0, 0);
            assert_eq!(clear_external_nullifier(&c(), &m(), month)[0] & 0xe0, 0);
        }
    }

    /// The month is in the preimage, which is what stops a March proof being
    /// replayed as an April one — and, for erasure, what stops a proof held
    /// from March being used against the April record that replaced it.
    #[test]
    fn the_month_is_bound_in() {
        assert_ne!(
            clear_external_nullifier(&c(), &m(), 674),
            clear_external_nullifier(&c(), &m(), 675)
        );
        assert_ne!(
            presence_external_nullifier(&c(), &m(), 674),
            presence_external_nullifier(&c(), &m(), 675)
        );
    }

    /// A proof for one Circle must not carry to another, and a proof about one
    /// member must not carry to another member.
    #[test]
    fn the_circle_and_the_member_are_bound_in() {
        let other_circle = Pubkey::new_from_array([8u8; 32]);
        let other_member = [10u8; 32];
        assert_ne!(
            clear_external_nullifier(&c(), &m(), 674),
            clear_external_nullifier(&other_circle, &m(), 674)
        );
        assert_ne!(
            clear_external_nullifier(&c(), &m(), 674),
            clear_external_nullifier(&c(), &other_member, 674)
        );
        assert_ne!(
            presence_external_nullifier(&c(), &m(), 674),
            presence_external_nullifier(&other_circle, &m(), 674)
        );
        assert_ne!(
            presence_external_nullifier(&c(), &m(), 674),
            presence_external_nullifier(&c(), &other_member, 674)
        );
    }

    /// Presence must not collide with the other anonymous acts a member
    /// performs, or an observer who sees two of them could join them to one
    /// person. The faucet tag is the nearest neighbour: same shape, same
    /// circle-plus-commitment preimage.
    #[test]
    fn presence_does_not_collide_with_the_faucet_tag() {
        let mut faucet = anchor_lang::solana_program::hash::hashv(&[
            b"AHA-faucet-grant",
            c().as_ref(),
            m().as_ref(),
            &674u32.to_le_bytes(),
        ])
        .to_bytes();
        faucet[0] &= 0x1f;
        assert_ne!(presence_external_nullifier(&c(), &m(), 674), faucet);
        assert_ne!(clear_external_nullifier(&c(), &m(), 674), faucet);
    }

    /// Pinned vectors. The tags are a one-way door: the browser prover computes
    /// the same preimage, so changing a tag, a field order or an endianness
    /// orphans every proof anyone has already generated. Same discipline as the
    /// frozen derivation vectors in tests/zk-field-constants.test.mjs — these
    /// are a guardrail, not documentation.
    #[test]
    fn the_preimages_are_frozen() {
        // Computed with an independent SHA-256 implementation, not read back
        // out of this code.
        assert_eq!(
            hex(&presence_external_nullifier(&c(), &m(), 674)),
            "0f00da98fa1aa249ffb34bc7887c2cd7e3642943e7cb3cc8cc3acf6238edd6f4"
        );
        assert_eq!(
            hex(&clear_external_nullifier(&c(), &m(), 674)),
            "1c0ec11835ea7861f11c80408e97a034885aa9f5aafa63027b6f1478e6e19270"
        );
    }

    fn hex(b: &[u8; 32]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
}
