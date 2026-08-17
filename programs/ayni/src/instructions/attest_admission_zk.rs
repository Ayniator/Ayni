use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::proof_anchor::{verify_anchored_proof, ProofKind};
use crate::state::{AdmissionAttestation, Circle, MemberTree, Nullifier, RecentRoots};

/// Attestation A, anonymous form (Trust Platform Epic 2): a Groth16 proof that
/// SOME member of the Circle's member tree attests for this newcomer — naming
/// no one. The sponsor edge Epic 2 exists to prevent never comes into being:
/// nothing on-chain, in logs, or in this account links the parrain to the
/// newcomer, and the attestation "can never be extracted, subpoenaed, or mined
/// from public data" (the epic's own words) because it does not exist.
///
/// Circuit reuse, not new cryptography: this is `member_vote.circom` exactly as
/// `prove_personhood` already reuses it — root = the member tree, external
/// nullifier (`proposalId`) = the newcomer's commitment, `choice` = 1 ("I
/// attest"), nullifier = Poseidon(secret, newcomer). Same circuit, same
/// embedded ceremony key (`VERIFYING_KEY_VOTE`), verified end-to-end on devnet
/// by F28. The nullifier is deterministic per (member, newcomer), so one member
/// cannot attest twice for the same newcomer even across both forms — and the
/// ["attest", circle, newcomer] PDA (shared with the named form) already caps
/// the newcomer at one parrain attestation total.
///
/// Honest semantics, stated exactly:
/// * "In good standing" here means "in the member tree" — the tree is
///   append-only, so an expired member who was never revoked can still produce
///   a proof. This is the SAME semantics member voting already accepts for a
///   snapshot; tightening it needs an epoch-refreshed good-standing tree (F54).
/// * The proof is verified against the CURRENT tree root **or any root in the
///   Circle's recent-roots ring buffer** (F54): the prover reconstructs the
///   tree client-side (as `zk-vote.ts` does), cranks `note_root` so the root
///   they prove against is recorded, and a concurrent admission no longer
///   kills the in-flight proof. Staleness is bounded by the buffer size.
/// * `confirm_admission` cannot compare a trusted servant against an anonymous
///   parrain, so the distinct-persons rule downgrades from program-enforced to
///   circle-visible for anonymous attestations: the confirming seat is public,
///   the other six see who confirmed, and a covert self-confirmation requires
///   the servant to also be the (anonymous) parrain — accepted and documented,
///   with `require_personhood` (F5) as the structural backstop against the
///   Sybil variant.
/// * Submit through the relayer (`/api/relay`) — a wallet that pays the fee for
///   this transaction links itself to the attestation timing.
pub fn attest_admission_zk(
    ctx: Context<AttestAdmissionZk>,
    newcomer_commitment: [u8; 32],
    root: [u8; 32],
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    // F54: accept the current root, or any root still in the ring buffer
    // (cheap check first, before the pairing work).
    let is_current = root == ctx.accounts.member_tree.root;
    let is_recent = ctx
        .accounts
        .recent_roots
        .as_ref()
        .map(|rr| rr.contains(&root))
        .unwrap_or(false);
    require!(is_current || is_recent, AyniError::RootNotRecent);

    // Public-signal order (outputs first): [nullifier, root, proposalId, choice].
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        root,
        newcomer_commitment,
        crate::merkle::field_from_u8(1), // choice = 1: "I attest"
    ];

    verify_anchored_proof(
        ProofKind::MemberVote,
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        AyniError::VoteProofInvalid,
    )?;

    let a = &mut ctx.accounts.attestation;
    a.circle = ctx.accounts.circle.key();
    a.newcomer = newcomer_commitment;
    a.parrain = [0u8; 32]; // anonymous — there is nothing to record
    a.nullifier = nullifier;
    a.attested_at = Clock::get()?.unix_timestamp;
    a.bump = ctx.bumps.attestation;
    Ok(())
}

#[derive(Accounts)]
#[instruction(newcomer_commitment: [u8; 32], root: [u8; 32], nullifier: [u8; 32])]
pub struct AttestAdmissionZk<'info> {
    pub circle: Account<'info, Circle>,

    /// The votable set the parrain proves membership of (current root).
    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Account<'info, MemberTree>,

    /// F54 ring buffer — pass it (after cranking `note_root`) so the proof
    /// survives concurrent admissions; may be null for a Circle that has never
    /// cranked, in which case only the exact current root is accepted.
    #[account(
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Option<Box<Account<'info, RecentRoots>>>,

    /// One parrain attestation per newcomer — shared PDA with the named form,
    /// so the two forms cannot be stacked.
    #[account(
        init,
        payer = payer,
        space = AdmissionAttestation::SPACE,
        seeds = [b"attest", circle.key().as_ref(), newcomer_commitment.as_ref()],
        bump
    )]
    pub attestation: Account<'info, AdmissionAttestation>,

    /// Replay guard on the vouch nullifier itself.
    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"vouchnull", circle.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub vouch_nullifier: Account<'info, Nullifier>,

    /// A relayer pays, so the parrain's wallet never appears — the same rule
    /// as `cast_vote`.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
