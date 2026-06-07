use anchor_lang::prelude::*;

use crate::council::Council;

/// A Circle — a local AHA group, forked under the World Service Circle.
/// Governance (proposals/voting) lives in a Realms Realm; the treasury in a
/// Squads multisig. This account holds the membership/Council/lineage state that
/// those tools do not provide.
#[account]
pub struct Circle {
    /// The AHA World Service Circle authority this Circle forks under.
    pub world_service: Pubkey,
    /// Circle admin — typically a Realms/Squads governance PDA. Used to
    /// bootstrap and seat the Council; ongoing changes go through the 4-of-7
    /// proposal flow.
    pub authority: Pubkey,
    /// The 7-seat Council (3 named servants + 4 elders); threshold 4-of-7.
    pub council: Council,
    /// Length of one membership term, in seconds (e.g. one year).
    pub membership_period: i64,
    pub member_count: u64,
    /// Human-readable Circle name (also a PDA seed, so <= MAX_NAME bytes).
    pub name: String,
    pub bump: u8,
}

impl Circle {
    pub const MAX_NAME: usize = 32; // PDA seed components must be <= 32 bytes
    pub const SPACE: usize = 8        // account discriminator
        + 32                           // world_service
        + 32                           // authority
        + Council::SPACE               // 7 seats + threshold
        + 8                            // membership_period
        + 8                            // member_count
        + 4 + Self::MAX_NAME           // name (String: 4-byte len prefix + bytes)
        + 1; // bump
}

/// A yearly, non-transferable (soulbound) membership.
///
/// For anonymity the member is identified by a ZK `commitment` (a Poseidon/
/// keccak hash of their secret identity), NOT by a wallet — so on-chain reads
/// never reveal who the member is. A Token-2022 NonTransferable token may be
/// minted alongside for selective public disclosure.
#[account]
pub struct Membership {
    pub circle: Pubkey,
    pub commitment: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    /// Highest shamanic level attained (0 = none).
    pub level: u8,
    /// Optional controlling wallet for selective disclosure. `default()` means
    /// fully anonymous (no wallet bound). This is the field a 4-of-7 wallet
    /// migration rebinds during key recovery.
    pub owner: Pubkey,
    pub bump: u8,
}

impl Membership {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 32 + 1;
}

/// Record of a single shamanic level grant along an anonymous lineage.
///
/// `issuer_commitment` is the ZK commitment of the granting shaman — recorded
/// so the chain of transmission can be re-proved later, WITHOUT revealing the
/// granter's identity on-chain.
#[account]
pub struct LevelGrant {
    pub membership: Pubkey,
    pub level: u8,
    pub issuer_commitment: [u8; 32],
    pub granted_at: i64,
    pub bump: u8,
}

impl LevelGrant {
    pub const SPACE: usize = 8 + 32 + 1 + 32 + 8 + 1;
}

/// The append-only Poseidon Merkle tree of lineage credentials for a Circle.
/// `root` is what ZK `grant_level` proofs are checked against. Incremental
/// insertion state (`filled_subtrees`, `next_index`) follows the Tornado
/// MerkleTreeWithHistory pattern. See docs/zk-lineage.md.
#[account]
pub struct Lineage {
    pub circle: Pubkey,
    pub depth: u8,
    pub next_index: u64,
    pub root: [u8; 32],
    pub filled_subtrees: [[u8; 32]; crate::merkle::MAX_DEPTH],
    pub bump: u8,
}

impl Lineage {
    pub const SPACE: usize = 8        // discriminator
        + 32                           // circle
        + 1                            // depth
        + 8                            // next_index
        + 32                           // root
        + 32 * crate::merkle::MAX_DEPTH // filled_subtrees
        + 1; // bump
}

/// A spent ZK nullifier. Existence == "this grant has already been made";
/// Anchor `init` fails if the PDA already exists, giving replay protection.
#[account]
pub struct Nullifier {}

impl Nullifier {
    pub const SPACE: usize = 8;
}
