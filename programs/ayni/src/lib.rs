//! Ayni — the Solana implementation of AHA (Ancestral Humanity Anonymous).
//!
//! This program holds the parts of the AHA model that Realms (governance) and
//! Squads (treasury) do not provide: the soulbound yearly membership lifecycle,
//! the three trusted-servant roles, and anonymous shamanic-level lineage.
//!
//! See ../../PROJECT.md (the chain-agnostic AHA model) and ../../IMPLEMENTATION.md.

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod merkle;
pub mod state;
pub mod verifying_key;

use instructions::*;
use state::ServantRole;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod ayni {
    use super::*;

    /// Create a new Circle (a local AHA group) under the World Service Circle.
    pub fn initialize_circle(
        ctx: Context<InitializeCircle>,
        name: String,
        membership_period: i64,
    ) -> Result<()> {
        instructions::initialize_circle(ctx, name, membership_period)
    }

    /// Issue a soulbound yearly membership, identified by a ZK commitment.
    pub fn issue_membership(ctx: Context<IssueMembership>, commitment: [u8; 32]) -> Result<()> {
        instructions::issue_membership(ctx, commitment)
    }

    /// Renew (extend) a membership for another term on donation.
    pub fn renew_membership(ctx: Context<RenewMembership>) -> Result<()> {
        instructions::renew_membership(ctx)
    }

    /// Appoint one of the three trusted servants (treasurer/secretary/rhythm keeper).
    pub fn appoint_servant(
        ctx: Context<AppointServant>,
        role: ServantRole,
        servant: Pubkey,
    ) -> Result<()> {
        instructions::appoint_servant(ctx, role, servant)
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
