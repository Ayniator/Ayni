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
pub mod state;

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

    /// Grant a shamanic level along an anonymous, ZK-verified lineage.
    pub fn grant_level(
        ctx: Context<GrantLevel>,
        level: u8,
        issuer_commitment: [u8; 32],
        lineage_proof: Vec<u8>,
    ) -> Result<()> {
        instructions::grant_level(ctx, level, issuer_commitment, lineage_proof)
    }
}
