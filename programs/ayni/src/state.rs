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
    /// Sybil gate: if true, `issue_membership` requires a `PersonhoodCredential`
    /// (one human → one membership per Circle) proven against `personhood_root`.
    pub require_personhood: bool,
    /// Merkle root of a unique-human set (e.g. a World ID group, or a Circle's
    /// vouching set) that personhood proofs are checked against.
    pub personhood_root: [u8; 32],
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
        + 1                            // require_personhood
        + 32                           // personhood_root
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
    /// Up to two optional guardian/backup keys the member controls separately
    /// from `owner` (1-of-2: either can act, so losing one guardian still leaves
    /// recovery possible). Lets a member self-migrate or co-sign even after
    /// losing the owner key, and preserves anonymity (owner may stay `default()`
    /// while a guardian is set). Unused slots are `default()`.
    pub recovery_keys: [Pubkey; Self::MAX_GUARDIANS],
    /// If true, a Council `MigrateWallet` cannot rebind this membership without a
    /// signature from `owner` or a guardian — collusion-proof, but the
    /// membership is unrecoverable if every key is lost.
    pub require_cosign: bool,
    pub bump: u8,
}

impl Membership {
    pub const MAX_GUARDIANS: usize = 2;
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1 + 32 + 32 * Self::MAX_GUARDIANS + 1 + 1;

    /// True if `who` is a key the member controls (owner or a guardian),
    /// ignoring unset (`default()`) slots.
    pub fn is_member_key(&self, who: &Pubkey) -> bool {
        if who == &Pubkey::default() {
            return false;
        }
        (self.owner != Pubkey::default() && who == &self.owner)
            || self
                .recovery_keys
                .iter()
                .any(|k| k != &Pubkey::default() && k == who)
    }
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

/// An acknowledgment credential — a course/initiation certificate attesting
/// "portrait PPP followed course CCC, taught by XXX, on date DDD". Only the
/// Poseidon root `root = Poseidon(cP, cC, cX, cD)` of the four blinded field
/// commitments is stored, so nothing about the fields is public. The holder
/// later opens any subset with a ZK proof (`circuits/ack_disclose.circom`).
///
/// `issuer_attested` is set true because issuance verified an *issuer-anonymous*
/// lineage proof: a teacher of level >= `attest_level` in the lineage tree
/// authorized this `root` — so "taught by a real lineage holder" is guaranteed
/// without recording which teacher. See docs/acknowledgments.md.
#[account]
pub struct Acknowledgment {
    pub circle: Pubkey,
    pub member_commitment: [u8; 32],
    pub root: [u8; 32],
    pub attest_level: u8,
    pub issued_at: i64,
    pub issuer_attested: bool,
    pub bump: u8,
}

impl Acknowledgment {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 1 + 1;
}

/// A durable proof-of-eligibility minted by `verify_disclosure`: it records that
/// some acknowledgment satisfied a gate's predicate requirements. A downstream
/// program (a ceremony, a resource) checks the pass exists for its `gate`.
#[account]
pub struct AccessPass {
    pub acknowledgment: Pubkey,
    pub gate: [u8; 32],
    pub granted_at: i64,
    pub bump: u8,
}

impl AccessPass {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

/// The append-only Poseidon Merkle tree of *member* identity commitments for a
/// Circle (the votable population). Same shape as `Lineage`; `next_index` is the
/// member count. A commitment is inserted at `issue_membership`. Member voting
/// proves Semaphore-style inclusion against a snapshot of `root`.
#[account]
pub struct MemberTree {
    pub circle: Pubkey,
    pub depth: u8,
    pub next_index: u64,
    pub root: [u8; 32],
    pub filled_subtrees: [[u8; 32]; crate::merkle::MAX_DEPTH],
    pub bump: u8,
}

impl MemberTree {
    pub const SPACE: usize =
        8 + 32 + 1 + 8 + 32 + 32 * crate::merkle::MAX_DEPTH + 1;
}

/// A group-conscience proposal voted on by the whole membership: an idea, or a
/// change to shared material/documentation. One member = one vote, cast
/// anonymously (Merkle inclusion in the snapshotted member set + a per-proposal
/// nullifier). `description_hash` commits to the off-chain text (e.g. an IPFS CID
/// hash). See docs/member-voting.md.
#[account]
pub struct MemberProposal {
    pub circle: Pubkey,
    pub nonce: u64,
    pub description_hash: [u8; 32],
    pub member_root: [u8; 32], // snapshot of the eligible voter set
    pub eligible_count: u64,   // member_count at snapshot (for quorum)
    pub yes: u64,
    pub no: u64,
    pub deadline: i64,
    pub finalized: bool,
    pub passed: bool,
    pub bump: u8,
}

impl MemberProposal {
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1;
}

/// Proof that a unique human is eligible for one membership in a Circle, minted
/// by `prove_personhood` after an anonymous proof-of-personhood (World ID-style).
/// Its PDA is seeded by the personhood nullifier, so one human yields exactly one
/// credential per Circle; `issue_membership` consumes it (`used = true`) — one
/// human, one membership. The human's identity is never revealed.
#[account]
pub struct PersonhoodCredential {
    pub circle: Pubkey,
    pub used: bool,
    pub bump: u8,
}

impl PersonhoodCredential {
    pub const SPACE: usize = 8 + 32 + 1 + 1;
}
