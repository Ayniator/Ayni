use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use groth16_solana::groth16::Groth16Verifier;

use crate::errors::AyniError;
use crate::instructions::activate_faucet::pay_uniform_grant;
use crate::state::{Circle, FaucetJar, MemberTree, Membership, Nullifier, RecentRoots, WingPeer};
use crate::verifying_key_vote::VERIFYING_KEY_VOTE;

/// Canonical external nullifier for a faucet endorsement:
/// `H("AHA-faucet-grant" || circle || neophyte_commitment)`, masked into BN254.
///
/// Two jobs, both load-bearing:
///
/// * **Binding.** It is the circuit's `proposalId`, so a proof is usable for
///   exactly one (circle, neophyte) pair and nothing else. A member's
///   endorsement of Ana cannot be re-aimed at Bo, or at Ana in another Circle.
/// * **Domain separation.** `attest_admission_zk` uses the raw newcomer
///   commitment as its external nullifier, so its emitted nullifier is
///   `Poseidon(secret, newcomer)`. If the faucet reused that, the same member
///   endorsing both would emit the *same* nullifier twice, and an observer
///   comparing the two transactions would learn "the admission attester and the
///   first-gas endorser are one member" — a correlation that shrinks the
///   anonymity set for free. Hashing under a distinct domain tag makes the two
///   nullifiers independent.
///
/// The mask is the same rule as `merkle::field_from_pubkey`: clearing the top 3
/// bits of the big-endian encoding puts the value below BN254's p (p > 2^253),
/// so the encoding is always a valid field element and never needs a reduction
/// the prover could disagree with. The browser prover must mask identically
/// (`frontend/lib/zk-vote.ts`, `faucetExternalNullifier`).
pub fn faucet_external_nullifier(circle: &Pubkey, neophyte_commitment: &[u8; 32]) -> [u8; 32] {
    let mut b = hashv(&[
        b"AHA-faucet-grant",
        circle.as_ref(),
        neophyte_commitment.as_ref(),
    ])
    .to_bytes();
    b[0] &= 0x1f; // BN254 p > 2^253 ⇒ always in field
    b
}

/// First gas for the neophyte, **anonymously endorsed** (F35 → Epic 2).
///
/// The Traditions problem this fixes: `activate_faucet` (now deprecated) makes
/// the parrain sign and pay, and passes their membership PDA, so the transaction
/// itself publishes "wallet W, holding membership commitment C, sponsors the
/// neophyte N" — plus a lamport transfer between the two. That is precisely the
/// named sponsor edge Epic 2 exists to abolish, and it was the sharpest
/// Traditions tension in shipped code (Sentinel R2).
///
/// Here the endorsement is a Groth16 proof instead of a signature: SOME member
/// of this Circle's member tree endorses first gas for this neophyte, and the
/// transaction contains no parrain account, no parrain commitment, no parrain
/// wallet, and no assertion about who they are. Nothing to extract, subpoena, or
/// mine, because nothing was written.
///
/// **Circuit reuse, not new cryptography.** This is `member_vote.circom` exactly
/// as `prove_personhood` and `attest_admission_zk` already reuse it — same
/// browser artifacts, same embedded ceremony key (`VERIFYING_KEY_VOTE`), no new
/// trusted setup (F44 stays out of scope):
///
/// ```text
///   root        = the Circle's member tree (current, or in the F54 ring buffer)
///   proposalId  = faucet_external_nullifier(circle, neophyte)   [see above]
///   choice      = 1 ("I endorse this grant"; the circuit constrains it boolean,
///                    which is why the domain tag lives in proposalId, not here)
///   nullifier   = Poseidon(secret, proposalId)                  [circuit output]
/// ```
///
/// **Economics unchanged.** Cooldown, uniform amount, rent floor, transfer and
/// counter all come from the one shared `pay_uniform_grant`, so this path cannot
/// pay differently from the named one. The one-shot guard is the same
/// `["faucetnull", circle, neophyte_commitment]` PDA with the same `init`-is-the
/// -refusal semantics and the same per-Circle scope — the two paths share it, so
/// they cannot be stacked to take two grants.
///
/// **Honest semantics, stated exactly:**
///
/// * *What the proof proves* is "a member of the tree", not "the neophyte's
///   designated wing" — `member_vote` has no notion of a WingPeer bond and
///   teaching it one would need a new circuit and a new ceremony. So the
///   endorsement is deliberately weaker than the named path's: any tree member
///   can release a neophyte's grant, not only their wing. What bounds the
///   consequence is that the grant is still one-per-neophyte-ever, still the
///   uniform amount, and still payable only to the neophyte's own wallet — an
///   arbitrary member can only cause the welcome that was going to happen.
///   This is the same trade `attest_admission_zk` already made for admission.
/// * *The bond must still exist.* The neophyte's `WingPeer` must be present and
///   active, exactly as in the named path, so a member with no sponsor at all is
///   not gassed up. Referencing that account leaks nothing new: its address is
///   `["wingpeer", circle, neophyte_commitment]` — derivable by anyone from the
///   neophyte commitment, which is public in this transaction regardless — and
///   the account is world-readable at any time. The commitment-level sponsor
///   edge it publishes is F27's leak (Sentinel R2), unchanged by us either way;
///   what F35 removes is the *wallet*-level edge and the program's assertion of
///   it. When F27 retires the public bond this constraint becomes an in-circuit
///   proof, not an account.
/// * *A neophyte in the tree can endorse their OWN grant.* The named path could
///   not be self-served — `establish_wing_peer` refuses `mentee == wing` — but
///   an anonymous proof cannot be compared against the neophyte's commitment
///   without a circuit that takes both, so this path cannot tell "my sponsor
///   endorsed me" from "I endorsed myself". Relayed, that means a confirmed
///   member can take their own first gas without waiting for their sponsor.
///   What it does NOT unlock is a bigger loss: still one grant per commitment,
///   still the uniform amount, still their own wallet, still their own Circle's
///   jar. The gate that actually bounds the faucet is the membership door
///   (`require_personhood` / closed admission), never the endorsement — a Circle
///   that lets anyone mint memberships could already farm the jar through
///   sock-puppet wings. What is lost is the ceremony, not the money.
/// * *"In good standing" means "in the member tree."* The tree is append-only,
///   so an expired-but-never-revoked member can still produce a proof — the same
///   semantics member voting already accepts, tightened only by F54 epochs.
/// * *No vouch-nullifier PDA is written*, deliberately. It would be pure
///   redundancy — the proof is bound to (circle, neophyte) and that pair's
///   `faucetnull` PDA is `init`-once, so a replayed proof cannot pay twice — and
///   it would be a small privacy loss: a `getProgramAccounts` sweep would then
///   enumerate every anonymous endorsement per Circle. The residual it leaves is
///   named in docs/faucet.md: a valid proof is public once its transaction
///   lands, so a *failed* activation (empty jar) can be re-submitted later by
///   anyone, moving only the timing of a grant that was already authorised, to a
///   recipient the prover already fixed.
/// * *Submit through the relayer* (`/api/relay`). A wallet that pays this fee
///   links itself to the endorsement's timing; the ZK proof is what stops the
///   fee-payer from being the parrain, but only if the parrain does not pay it.
pub fn activate_faucet_zk(
    ctx: Context<ActivateFaucetZk>,
    root: [u8; 32],
    nullifier: [u8; 32],
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Neophyte: live membership with a wallet of their own to receive first gas.
    // (Identical to the named path — a fully anonymous member with no bound
    // wallet still has nowhere to receive lamports; that is E0's remaining item,
    // not something this instruction can decide.)
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

    // The neophyte has an active sponsor bond — the bond's other side is never
    // named here, and no account of theirs is passed.
    require!(ctx.accounts.wing_peer.active, AyniError::NotParrain);

    // F54: accept the current root, or any root still in the ring buffer (cheap
    // check first, before the pairing work).
    let is_current = root == ctx.accounts.member_tree.root;
    let is_recent = ctx
        .accounts
        .recent_roots
        .as_ref()
        .map(|rr| rr.contains(&root))
        .unwrap_or(false);
    require!(is_current || is_recent, AyniError::RootNotRecent);

    // Public-signal order (outputs first): [nullifier, root, proposalId, choice].
    let external_nullifier = faucet_external_nullifier(
        &ctx.accounts.circle.key(),
        &ctx.accounts.neophyte_membership.commitment,
    );
    let public_inputs: [[u8; 32]; 4] = [
        nullifier,
        root,
        external_nullifier,
        crate::merkle::field_from_u8(1), // choice = 1: "I endorse this grant"
    ];

    let mut verifier =
        Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYING_KEY_VOTE)
            .map_err(|_| error!(AyniError::VoteProofInvalid))?;
    verifier
        .verify()
        .map_err(|_| error!(AyniError::VoteProofInvalid))?;

    // Cooldown + uniform amount + rent floor + transfer + counter — the shared
    // economics, identical in both activation paths.
    let recipient = ctx.accounts.recipient.to_account_info();
    pay_uniform_grant(&mut ctx.accounts.jar, &recipient, now)
}

#[derive(Accounts)]
pub struct ActivateFaucetZk<'info> {
    /// Boxed, like every other large account here: this instruction's account
    /// set (Circle + member tree + membership + bond) overflows the 4 KiB SBF
    /// stack frame if `try_accounts` deserializes them inline — the SBF linker
    /// flags it as potential frame corruption.
    pub circle: Box<Account<'info, Circle>>,

    /// The set the endorser proves membership of (current root).
    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    /// F54 ring buffer — pass it (after cranking `note_root`) so the proof
    /// survives concurrent admissions; may be null for a Circle that has never
    /// cranked, in which case only the exact current root is accepted.
    #[account(
        has_one = circle,
        seeds = [b"roots", circle.key().as_ref()],
        bump = recent_roots.bump
    )]
    pub recent_roots: Option<Box<Account<'info, RecentRoots>>>,

    /// The newcomer's membership; the grant goes to its `owner` wallet. This is
    /// the ONLY membership account in the transaction — there is no parrain
    /// side, which is the entire point.
    #[account(
        has_one = circle,
        seeds = [b"membership", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump = neophyte_membership.bump,
    )]
    pub neophyte_membership: Box<Account<'info, Membership>>,

    /// The neophyte's sponsor bond — seed-bound to the neophyte, and read only
    /// for `active`. Its `wing` field is NOT consulted and NOT compared against
    /// anything: this instruction never learns, asserts, or records who the
    /// sponsor is.
    #[account(
        has_one = circle,
        seeds = [b"wingpeer", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump = wing_peer.bump,
    )]
    pub wing_peer: Box<Account<'info, WingPeer>>,

    /// One grant per membership commitment — `init` collision IS the refusal.
    /// The SAME PDA the named path uses, so the two forms cannot be stacked.
    #[account(
        init,
        payer = payer,
        space = Nullifier::SPACE,
        seeds = [b"faucetnull", circle.key().as_ref(), neophyte_membership.commitment.as_ref()],
        bump
    )]
    pub grant_nullifier: Account<'info, Nullifier>,

    #[account(mut, has_one = circle, seeds = [b"faucet", circle.key().as_ref()], bump = jar.bump)]
    pub jar: Box<Account<'info, FaucetJar>>,

    /// CHECK: must equal the neophyte membership's `owner`.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// A relayer pays, so no member's wallet appears — the same rule as
    /// `cast_vote` and `attest_admission_zk`.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
