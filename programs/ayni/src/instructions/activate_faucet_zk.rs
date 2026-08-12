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
/// Here the endorsement is a Groth16 proof instead of a signature: the
/// neophyte's **wing** endorses first gas, and the transaction contains no
/// parrain account, no parrain wallet, no parrain signature and no lamport
/// transfer between members. Nothing to extract, subpoena, or mine from the
/// *wallet* layer, because nothing of it was written.
///
/// **F35-R2 — mandatory sponsorship, restored without a new circuit.** F35 as
/// first shipped proved only "SOME member of the tree endorses", which lost the
/// one structural property the named path had: `establish_wing_peer` refuses
/// `mentee == wing`, so a member could never serve themselves. An anonymous
/// "some member" proof let an admitted neophyte endorse their OWN first gas.
/// This instruction now pins the proof's `root` to a tree the PROGRAM computes,
/// whose only leaf is this bond's `wing` — so the only witness that satisfies it
/// is a secret `s` with `Poseidon(s) == wing_peer.wing`. See
/// `merkle::single_leaf_root`.
///
/// **Circuit reuse, not new cryptography.** This is `member_vote.circom` exactly
/// as `prove_personhood` and `attest_admission_zk` already reuse it — same
/// browser artifacts, same embedded ceremony key (`VERIFYING_KEY_VOTE`), no new
/// trusted setup (F44 stays out of scope). The circuit constrains only
/// `root === cur[depth]` and never learns what set `root` denotes, so repointing
/// it is a program-side change and nothing else:
///
/// ```text
///   root        = single_leaf_root(wing_peer.wing)   -- computed on chain
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
/// * *What the proof proves* is "the holder of `wing_peer.wing`'s secret
///   endorses this grant" — no more and no less. It does NOT prove the wing is
///   currently in the member tree (see good standing, below), and it does not
///   make the sponsorship sincere: a mentee can re-point their own bond
///   (`establish_wing_peer` is `init_if_needed` and mentee-signed) at a second
///   membership whose secret they hold, and endorse from that. That sock-puppet
///   is bounded by the membership door (`require_personhood` / closed admission
///   / two-sponsor), exactly as the *named* path's sock-puppet wing always was,
///   never by the endorsement. What is restored here is precisely the property
///   the named path had and F35-as-shipped lost: **a capability held by a
///   commitment other than the neophyte's must be exercised.** Claim that, not
///   more.
/// * *What is newly PUBLISHED, stated plainly.* `root` is now a deterministic
///   public function of `wing_peer.wing`, so anyone can precompute
///   `single_leaf_root(c)` over the (enumerable) commitment set and read the
///   endorser's commitment straight off the transaction. The endorsement's
///   commitment-level anonymity set is 1. The *edge* is not new — `WingPeer`
///   is world-readable at `["wingpeer", circle, neophyte_commitment]` and is
///   already IN this transaction (F27 / Sentinel R2). What is new is a
///   liveness/timing RECORD: proof that the holder of that commitment's secret
///   was alive, key-holding and acting at this slot, where before the chain
///   supported only a guess. You cannot have "the program enforces that the wing
///   endorsed" without the chain recording that the wing endorsed; restoring
///   mandatory sponsorship IS the decision to publish that fact. The *wallet*
///   layer is untouched: no parrain membership account, no signature, no
///   transfer — that is the F35 win and it survives intact.
/// * *FORWARD-COMPAT TRAP for F27.* When F27 retires the public `WingPeer` bond,
///   this `root` would STILL arithmetically name the wing, re-introducing by
///   computation exactly the leak F27 removes — and in immutable ledger data
///   that no later work can retract. F27's design must replace this check with
///   an in-circuit proof of the bond (F44) in the same change, or it silently
///   regresses.
/// * *Cross-act unlinkability is NOT harmed.* The emitted nullifier is
///   `Poseidon(secret, faucet_external_nullifier(circle, neophyte))` and is
///   written to no account on this path. An observer gains one attributed sample
///   of the wing's nullifier function under one domain-tagged proposalId, which
///   reveals nothing about that member's ballots (proposal nonce), admission
///   attestations (raw newcomer commitment), personhood or visit passes. The
///   domain separation above is what holds this line — a refactor must not
///   collapse it.
/// * *The bond must still exist and be active*, exactly as in the named path, so
///   a member with no sponsor at all is not gassed up.
/// * *GOOD STANDING IS NOT PROVED — accepted deliberately.* `wing_peer.wing` is
///   frozen at bond time and this root is not epoch-scoped, so `begin_member_epoch`
///   (whose purpose is that stale roots stop authorising things) no longer
///   constrains this instruction: an expired, revoked, or not-yet-reinserted wing
///   can still endorse. Two further consequences, both real:
///   (a) the member tree is not consulted at all here, so a **provisional**
///   commitment — `issue_provisional_membership` writes a `Membership` at the
///   same PDA while deliberately NOT inserting into the tree — is a valid
///   endorser, where under F35-as-shipped it was not. That lowers the
///   sock-puppet's cost relative to the *previous ZK path* (it is parity with
///   the named path, which never checked the tree either), and it is DESCOPED
///   for this round, not overlooked;
///   (b) the bounded loss in every case is one uniform, one-time grant to the
///   neophyte's OWN wallet, and the neophyte's own membership must still be
///   unexpired. Do NOT "fix" this by passing the wing's `Membership` to re-check
///   standing: that is the one move that puts a sponsor account back into the
///   transaction and hands back the F35 win. The wallet-free tightenings are an
///   `EpochLeaf` requirement (strands directly-issued sponsors — `issue_membership`
///   mints none) or a two-proof / equal-nullifier construction (~250-280k CU,
///   needs a ComputeBudget instruction the relayer cannot currently send).
/// * *LIVENESS: the wing is a single point of failure for the neophyte's first
///   gas.* Their ZK secret is device-bound and, for a legacy CSPRNG identity,
///   explicitly not shard-recoverable. The escape hatch F35 had — any tree
///   member can activate — is gone by design. The remaining fallback is the
///   deprecated named `activate_faucet`, where the wing signs with a WALLET key
///   (which IS recoverable via F9/F10/F11 guardian/Council migration), at the
///   cost of re-publishing the sponsor edge for that one grant; the UI must say
///   so before the wing takes it. Note that re-pointing the bond is NOT a
///   general fallback: `establish_wing_peer` is signer-paid and is not on the
///   relay allowlist, so a neophyte with an empty wallet cannot afford the
///   transaction that would unblock their first gas.
/// * *A generated proof can be invalidated by the mentee.* Because
///   `establish_wing_peer` is `init_if_needed` and mentee-signed, the mentee can
///   re-point the bond after the wing has proved, and the proof stops verifying.
///   It harms only the mentee, but the client must refetch `wing_peer.wing`
///   immediately before proving rather than trusting cached state.
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

    // The neophyte has an active sponsor bond — no account of the wing's is
    // passed, and no wallet of theirs appears.
    require!(ctx.accounts.wing_peer.active, AyniError::NotParrain);

    // F35-R2 — MANDATORY SPONSORSHIP, STILL ANONYMOUS.
    //
    // The proof must be made against the depth-20 tree whose ONLY leaf is this
    // bond's `wing` commitment, so the only witness that satisfies it is a
    // secret `s` with `Poseidon(s) == wing`. `wing_peer` is seed-bound to the
    // neophyte and `establish_wing_peer` refuses `mentee == wing`, so a
    // neophyte can never satisfy this with their own secret.
    //
    // *** THIS REPLACES THE MEMBER-TREE / F54-RING GATE. IT MUST NEVER JOIN IT. ***
    // Accepting `member_tree.root || recent_roots.contains(root) || wing_root`
    // leaves the self-endorsement hole exactly as wide as it was — a
    // self-endorsing neophyte simply keeps sending the tree root. `member_tree`
    // and `recent_roots` remain in the account struct ONLY to keep the account
    // count and ordering the relay allowlist pins; their `root` is deliberately
    // never read here, and a Sentinel grep asserts it stays that way.
    let expected_root = crate::merkle::single_leaf_root(&ctx.accounts.wing_peer.wing)?;
    require!(root == expected_root, AyniError::EndorsementNotByWing);

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

    /// NOT CONSULTED since F35-R2 — kept only so the account count and ordering
    /// stay exactly what `frontend/lib/relayPolicy.ts` pins (accountCount 10,
    /// payerIndex 8), because a policy/program skew makes the relayer refuse and
    /// the UI fall back to the NAMED path, republishing the sponsor wallet — the
    /// very leak under repair. The endorsement root is
    /// `single_leaf_root(wing_peer.wing)`, not this tree's root: reading
    /// `member_tree.root` here would re-open self-endorsement.
    #[account(
        has_one = circle,
        seeds = [b"members", circle.key().as_ref()],
        bump = member_tree.bump
    )]
    pub member_tree: Box<Account<'info, MemberTree>>,

    /// NOT CONSULTED since F35-R2 — same reason as `member_tree`. A wing's
    /// "tree of one" has no concurrency race and never goes stale, so the F54
    /// ring is irrelevant to this path; clients should pass `null` (worth
    /// ~8k CU). It must never receive a wing-derived root: see the invariant on
    /// `merkle::single_leaf_root`.
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

    /// The neophyte's sponsor bond — seed-bound to the neophyte. Since F35-R2
    /// its `wing` field IS load-bearing: it is folded into the single-leaf root
    /// the proof must match, which is what makes sponsorship mandatory. No
    /// account or wallet of the wing's is passed, but the endorser's commitment
    /// is now derivable from the transaction — see the doc comment above.
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
