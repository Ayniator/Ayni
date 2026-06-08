//! Ayni — the Solana implementation of AHA (Ancestral Humanity Anonymous).
//!
//! This program holds the parts of the AHA model that Realms (governance) and
//! Squads (treasury) do not provide: the soulbound yearly membership lifecycle,
//! the 7-seat Council with 4-of-7 key recovery, and anonymous shamanic-level
//! lineage.
//!
//! See ../../PROJECT.md (the chain-agnostic AHA model) and ../../IMPLEMENTATION.md.

use anchor_lang::prelude::*;

pub mod council;
pub mod errors;
pub mod instructions;
pub mod merkle;
pub mod state;
pub mod verifying_key;
pub mod verifying_key_ack;

use council::ProposalAction;
use instructions::*;
use instructions::verify_disclosure::DisclosureGate;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod ayni {
    use super::*;

    /// Create a new Circle (a local AHA group) under the World Service Circle.
    /// `recovery_timelock` is the per-Circle contest window (seconds) a wallet
    /// migration must wait after reaching 4-of-7 before it can execute.
    pub fn initialize_circle(
        ctx: Context<InitializeCircle>,
        name: String,
        membership_period: i64,
        recovery_timelock: i64,
    ) -> Result<()> {
        instructions::initialize_circle(ctx, name, membership_period, recovery_timelock)
    }

    /// Issue a soulbound yearly membership, identified by a ZK commitment.
    /// `owner` is an optional controlling wallet (default() = fully anonymous);
    /// `recovery_keys` up to two optional guardians; `require_cosign` opts into
    /// member-co-signed migration.
    pub fn issue_membership(
        ctx: Context<IssueMembership>,
        commitment: [u8; 32],
        owner: Pubkey,
        recovery_keys: [Pubkey; crate::state::Membership::MAX_GUARDIANS],
        require_cosign: bool,
    ) -> Result<()> {
        instructions::issue_membership(ctx, commitment, owner, recovery_keys, require_cosign)
    }

    /// Renew (extend) a membership for another term on donation.
    pub fn renew_membership(ctx: Context<RenewMembership>) -> Result<()> {
        instructions::renew_membership(ctx)
    }

    // --- Resilience: 7-seat Council, 4-of-7 recovery (see docs/resilience.md) ---

    /// Seat a Council member (bootstrap / governance path). Seats 0..2 are the
    /// named servants (treasurer/secretary/rhythm keeper); 3..6 are elders.
    pub fn appoint_seat(ctx: Context<AppointSeat>, seat_index: u8, holder: Pubkey) -> Result<()> {
        instructions::appoint_seat(ctx, seat_index, holder)
    }

    /// A Council seat opens a proposal (RotateSeat or MigrateWallet).
    pub fn propose(ctx: Context<Propose>, nonce: u64, action: ProposalAction) -> Result<()> {
        instructions::propose(ctx, nonce, action)
    }

    /// A Council seat approves a pending proposal.
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        instructions::approve(ctx)
    }

    /// Execute a proposal once it reaches 4-of-7 (and, for migration, once the
    /// contest window has elapsed).
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        instructions::execute_proposal(ctx)
    }

    /// Any single Council seat cancels a pending proposal (the contest tripwire).
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        instructions::cancel_proposal(ctx)
    }

    /// Member configures their own recovery: set/rotate the guardian key and the
    /// require-co-sign policy (signed by owner or current recovery key).
    pub fn set_recovery(
        ctx: Context<SetRecovery>,
        recovery_keys: [Pubkey; crate::state::Membership::MAX_GUARDIANS],
        require_cosign: bool,
    ) -> Result<()> {
        instructions::set_recovery(ctx, recovery_keys, require_cosign)
    }

    /// Self-recovery: a member holding a key migrates their own membership owner
    /// with no Council vote and no time-lock.
    pub fn member_migrate(ctx: Context<MemberMigrate>, new_owner: Pubkey) -> Result<()> {
        instructions::member_migrate(ctx, new_owner)
    }

    /// Rebind a membership's owner under an executed MigrateWallet proposal
    /// (with the member's co-signature when the membership requires it).
    pub fn recover_membership(ctx: Context<RecoverMembership>) -> Result<()> {
        instructions::recover_membership(ctx)
    }

    /// Bootstrap a Circle's lineage tree with the World Service genesis credential.
    pub fn initialize_lineage(
        ctx: Context<InitializeLineage>,
        depth: u8,
        genesis_commitment: [u8; 32],
        genesis_level: u8,
    ) -> Result<()> {
        instructions::initialize_lineage(ctx, depth, genesis_commitment, genesis_level)
    }

    /// Issue an acknowledgment credential (course/initiation certificate),
    /// attested by an anonymous lineage teacher. Stores only the Poseidon root
    /// of the four blinded fields; selective disclosure happens off-chain via
    /// `circuits/ack_disclose.circom`. Reuses the lineage verifying key.
    pub fn issue_acknowledgment(
        ctx: Context<IssueAcknowledgment>,
        ack_root: [u8; 32],
        member_commitment: [u8; 32],
        attest_level: u8,
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::issue_acknowledgment(
            ctx,
            ack_root,
            member_commitment,
            attest_level,
            nullifier,
            proof_a,
            proof_b,
            proof_c,
        )
    }

    /// Verify an acknowledgment selective-disclosure proof against a gate's
    /// predicate requirements and mint an AccessPass (predicate-gated access).
    pub fn verify_disclosure(
        ctx: Context<VerifyDisclosure>,
        gate: [u8; 32],
        public_inputs: [[u8; 32]; instructions::verify_disclosure::ACK_DISCLOSE_PUBLIC_INPUTS],
        requirements: DisclosureGate,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::verify_disclosure(
            ctx,
            gate,
            public_inputs,
            requirements,
            proof_a,
            proof_b,
            proof_c,
        )
    }

    /// Grant a shamanic level along an anonymous, ZK-verified lineage.
    pub fn grant_level(
        ctx: Context<GrantLevel>,
        granted_level: u8,
        grantee_commitment: [u8; 32],
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::grant_level(
            ctx,
            granted_level,
            grantee_commitment,
            nullifier,
            proof_a,
            proof_b,
            proof_c,
        )
    }
}
