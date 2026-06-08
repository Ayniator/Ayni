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

use council::ProposalAction;
use instructions::*;

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
    /// `recovery_key` an optional guardian; `require_cosign` opts into
    /// member-co-signed migration.
    pub fn issue_membership(
        ctx: Context<IssueMembership>,
        commitment: [u8; 32],
        owner: Pubkey,
        recovery_key: Pubkey,
        require_cosign: bool,
    ) -> Result<()> {
        instructions::issue_membership(ctx, commitment, owner, recovery_key, require_cosign)
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
        recovery_key: Pubkey,
        require_cosign: bool,
    ) -> Result<()> {
        instructions::set_recovery(ctx, recovery_key, require_cosign)
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
