use anchor_lang::prelude::*;

/// A Circle — a local AHA group, forked under the World Service Circle.
/// Governance (proposals/voting) lives in a Realms Realm; the treasury in a
/// Squads multisig. This account holds the membership/role/lineage state that
/// those tools do not provide.
#[account]
pub struct Circle {
    /// The AHA World Service Circle authority this Circle forks under.
    pub world_service: Pubkey,
    /// Circle admin — typically a Realms/Squads governance PDA, not a person.
    pub authority: Pubkey,
    /// The three trusted servants (rotating service positions).
    pub treasurer: Pubkey,
    pub secretary: Pubkey,
    pub rhythm_keeper: Pubkey,
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
        + 32 * 5                       // world_service, authority, 3 servants
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
    pub bump: u8,
}

impl Membership {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1;
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

/// The three trusted servants of a Circle.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ServantRole {
    Treasurer,
    Secretary,
    RhythmKeeper,
}
