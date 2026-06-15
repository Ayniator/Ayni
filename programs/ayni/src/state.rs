use anchor_lang::prelude::*;

use crate::council::{Council, COUNCIL_SEATS};

/// A Circle — a local AHA group, forked under the World Service Circle.
/// Governance (proposals/voting) lives in a Realms Realm; the treasury in a
/// Squads multisig. This account holds the membership/Council/lineage state that
/// those tools do not provide.
#[account]
pub struct Circle {
    /// The parent Circle this one is nested under (the World Service Circle's
    /// address, or a fixed root for the foundation itself). A PDA seed + the
    /// federation link — never an actor. There is NO admin key: the **Council is
    /// the authority** (group conscience), so a Circle is governed only by its
    /// 7 seats.
    pub parent: Pubkey,
    /// The 7-seat Council (3 named servants + 4 elders) — the Circle's authority;
    /// threshold 4-of-7.
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
    /// Token-2022 NonTransferable (soulbound) membership mint, if configured.
    /// `default()` = none. Mint authority must be this Circle PDA.
    pub membership_mint: Pubkey,
    /// Human-readable Circle name (also a PDA seed, so <= MAX_NAME bytes).
    pub name: String,
    pub bump: u8,
}

impl Circle {
    pub const MAX_NAME: usize = 32; // PDA seed components must be <= 32 bytes
    pub const SPACE: usize = 8        // account discriminator
        + 32                           // parent
        + Council::SPACE               // 7 seats + threshold (the authority)
        + 8                            // membership_period
        + 8                            // member_count
        + 1                            // require_personhood
        + 32                           // personhood_root
        + 32                           // membership_mint
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
    /// keccak(DisclosureGate) — the exact predicate policy this pass was minted
    /// under. A consumer MUST check this equals the hash of its own required
    /// policy, so a pass minted under weaker requirements can't be reused.
    pub requirements_hash: [u8; 32],
    pub granted_at: i64,
    pub bump: u8,
}

impl AccessPass {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
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

/// Public directory profile for a Circle — powers the "Find a Circle Near You"
/// map and the shared-document links. Optional and separate from `Circle` (so it
/// never touches the audited core account); a Circle with no profile simply
/// doesn't appear on the map. Set/updated by any Council seat via
/// `upsert_circle_profile`. Coordinates are fixed-point **microdegrees**
/// (degrees × 1e6) to avoid floats: lat ∈ [-90e6, 90e6], lon ∈ [-180e6, 180e6].
/// The IPFS CIDs point to the Circle's shared material (12 Steps, Preamble, and
/// the Daily Reflections collection), fetched read-only from a public gateway.
#[account]
pub struct CircleProfile {
    pub circle: Pubkey,
    pub lat_microdeg: i32,
    pub lon_microdeg: i32,
    pub name: String,
    pub city: String,
    pub address: String,
    pub twelve_steps_cid: String,
    pub preamble_cid: String,
    pub daily_reflections_cid: String,
    pub bump: u8,
}

impl CircleProfile {
    pub const MAX_NAME: usize = 64;
    pub const MAX_CITY: usize = 64;
    pub const MAX_ADDRESS: usize = 160;
    pub const MAX_CID: usize = 64; // IPFS CIDv1 base32 is ~59 chars

    pub const SPACE: usize = 8        // discriminator
        + 32                           // circle
        + 4                            // lat_microdeg
        + 4                            // lon_microdeg
        + 4 + Self::MAX_NAME           // name
        + 4 + Self::MAX_CITY           // city
        + 4 + Self::MAX_ADDRESS        // address
        + 4 + Self::MAX_CID            // twelve_steps_cid
        + 4 + Self::MAX_CID            // preamble_cid
        + 4 + Self::MAX_CID            // daily_reflections_cid
        + 1; // bump

    /// Reject over-long fields (PDAs/strings have fixed budgets).
    pub fn validate(
        name: &str,
        city: &str,
        address: &str,
        twelve_steps_cid: &str,
        preamble_cid: &str,
        daily_reflections_cid: &str,
    ) -> bool {
        name.len() <= Self::MAX_NAME
            && city.len() <= Self::MAX_CITY
            && address.len() <= Self::MAX_ADDRESS
            && twelve_steps_cid.len() <= Self::MAX_CID
            && preamble_cid.len() <= Self::MAX_CID
            && daily_reflections_cid.len() <= Self::MAX_CID
    }
}

/// Per-Circle membership-admission policy, kept in its own PDA so the `Circle`
/// layout is untouched and every existing Circle keeps deserializing.
///
/// Absent (the default for every Circle) ⇒ the **Scribe-Secretary** seat admits
/// members — validation required. Present with `open == true` ⇒ **permissionless**:
/// anyone may self-admit a membership. Toggled by any Council seat via
/// `set_open_membership`; consulted (optionally) by `issue_membership`.
///
/// PDA: ["openjoin", circle].
#[account]
pub struct OpenMembership {
    pub circle: Pubkey,
    pub open: bool,
    pub bump: u8,
}

impl OpenMembership {
    pub const SPACE: usize = 8 + 32 + 1 + 1;
}

/// A Circle's country — an ISO-3166-1 alpha-2 code (e.g. "FR"), set by any
/// Council seat. Powers the foundation directory's continent → country grouping
/// (the continent is derived client-side from the code). A separate PDA, so the
/// `Circle`/`CircleProfile` layouts are untouched and existing Circles need no
/// migration. PDA: ["country", circle].
#[account]
pub struct CircleCountry {
    pub circle: Pubkey,
    pub code: String, // ISO-3166-1 alpha-2, uppercase (e.g. "FR")
    pub bump: u8,
}

impl CircleCountry {
    pub const MAX_CODE: usize = 8;
    pub const SPACE: usize = 8 + 32 + 4 + Self::MAX_CODE + 1;
}

/// Per-Circle tunable policy — a sibling PDA so the `Circle` layout is untouched
/// and existing Circles need no migration. Any Council seat sets it; it is
/// created on first use with safe defaults (no donation, classic ⅓-quorum +
/// simple-majority voting, treasury allowlist off). PDA: ["config", circle].
///
/// The full layout is defined up front so the donation / quorum / allowlist
/// features can be wired in incrementally without ever re-migrating the account.
#[account]
pub struct CircleConfig {
    pub circle: Pubkey,
    /// Donation (lamports) required *into the treasury* to renew a membership
    /// (Tradition 7 — self-support). 0 = renewal is free.
    pub renew_donation_lamports: u64,
    /// Member-vote quorum as num/den of the eligible set (0 den ⇒ default ⅓).
    pub vote_quorum_num: u16,
    pub vote_quorum_den: u16,
    /// Member-vote pass threshold as yes/turnout (0 den ⇒ default simple majority).
    pub vote_pass_num: u16,
    pub vote_pass_den: u16,
    /// When true, a treasury withdrawal recipient must hold a TreasuryAllow marker.
    pub treasury_allowlist: bool,
    pub bump: u8,
}
impl CircleConfig {
    pub const SPACE: usize = 8 + 32 + 8 + 2 + 2 + 2 + 2 + 1 + 1;
}

/// Treasury allowlist entry: marks `recipient` as permitted to receive a
/// withdrawal from `circle` (only enforced when `CircleConfig.treasury_allowlist`
/// is on). PDA: ["treasallow", circle, recipient].
#[account]
pub struct TreasuryAllow {
    pub circle: Pubkey,
    pub recipient: Pubkey,
    pub allowed: bool,
    pub bump: u8,
}
impl TreasuryAllow {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1;
}

/// A WingPeer relationship — a more-experienced member ("wing") who takes a
/// newer member ("mentee") under their wing (the fellowship's sponsor bond).
/// Both are memberships of the same Circle, identified by commitment so the
/// pairing stays as anonymous as the memberships. One primary wing per mentee.
/// PDA: ["wingpeer", circle, mentee].
#[account]
pub struct WingPeer {
    pub circle: Pubkey,
    pub mentee: [u8; 32], // mentee membership commitment
    pub wing: [u8; 32],   // wing-peer membership commitment
    pub established_at: i64,
    pub active: bool,
    pub bump: u8,
}
impl WingPeer {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1 + 1;
}

/// A progress token — an on-chain milestone "chip" celebrating a member's
/// journey (e.g. 30 / 90 / 365 days), attested by a Council seat. One per
/// (member, milestone). PDA: ["progress", circle, member, milestone].
#[account]
pub struct ProgressToken {
    pub circle: Pubkey,
    pub member: [u8; 32], // membership commitment
    pub milestone: u32,   // days reached (a chip's denomination)
    pub issued_at: i64,
    pub issuer: Pubkey,   // the seat that attested it
    pub bump: u8,
}
impl ProgressToken {
    pub const SPACE: usize = 8 + 32 + 32 + 4 + 8 + 32 + 1;
}

/// A Circle's meeting calendar — recurring patterns + exceptional sessions —
/// as a compact JSON string every member (and visitor) can read. Set by any
/// Council seat. Separate PDA so the `Circle`/`CircleProfile` layouts are
/// untouched. PDA: ["meetings", circle].
#[account]
pub struct CircleMeetings {
    pub circle: Pubkey,
    pub data: String, // JSON: { recurring: [...], sessions: [...] }
    pub bump: u8,
}

impl CircleMeetings {
    pub const MAX_DATA: usize = 900;
    pub const SPACE: usize = 8 + 32 + 4 + Self::MAX_DATA + 1;
}

/// A foundation-led 4-of-7 vote to DELETE (close) a federation Circle, valid
/// for a chosen window. PDA: ["childclose", child, &nonce.to_le_bytes()].
#[account]
pub struct ChildCloseVote {
    pub foundation: Pubkey,
    pub child: Pubkey,
    pub nonce: u64,
    pub approvals: u8,
    pub created_at: i64,
    pub expires_at: i64,
    pub executed: bool,
    pub bump: u8,
}
impl ChildCloseVote {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 1 + 1;
    pub fn approval_count(&self) -> u8 {
        self.approvals.count_ones() as u8
    }
}

/// A wallet's published x25519 messaging public key (signature-derived), so
/// others can encrypt private messages to it. PDA: ["msgkey", owner].
#[account]
pub struct MessagingKey {
    pub owner: Pubkey,
    pub box_pubkey: [u8; 32],
    pub bump: u8,
}
impl MessagingKey {
    pub const SPACE: usize = 8 + 32 + 32 + 1;
}

/// An end-to-end encrypted 1:1 message with a SEALED SENDER: neither the program
/// nor the public chain stores who sent it. `eph_pubkey` is a fresh, single-use
/// x25519 key — it leaks no identity and gives the sender forward secrecy (its
/// secret half is destroyed right after send). The real sender is named AND
/// signed *inside* the ciphertext, and the recipient verifies that signature
/// after decrypting. The ciphertext is always exactly `CT_LEN` bytes (the
/// plaintext is padded before sealing), so every message looks identical
/// on-chain — no message-length leak. `expires_at` (0 = never) lets clients hide
/// it and anyone close it afterwards. PDA: ["msg", recipient, &id.to_le_bytes()].
///
/// NOTE (documented limitation): the *recipient* and *timing* are unavoidably
/// public (the recipient finds their mail by querying their own address), and
/// the transaction fee-payer still links a message to whoever paid for it. True
/// sender anonymity would need a relayer/mixnet — out of scope here.
#[account]
pub struct Message {
    pub recipient: Pubkey,
    pub eph_pubkey: [u8; 32], // single-use x25519 pubkey (sealed sender)
    pub nonce: [u8; 24],
    pub id: u64,
    pub created_at: i64,
    pub expires_at: i64, // 0 = never
    pub ciphertext: Vec<u8>, // always CT_LEN bytes (padded then sealed)
    pub bump: u8,
}
impl Message {
    /// Fixed sealed length: 1024-byte padded plaintext + 16-byte NaCl box MAC.
    pub const CT_LEN: usize = 1040;
    pub const SPACE: usize = 8 + 32 + 32 + 24 + 8 + 8 + 8 + 4 + Self::CT_LEN + 1;
}

/// A foundation-led vote to rotate a CHILD Circle's Council seats. The World
/// Service / foundation Circle (the child's `parent`) may help a member Circle
/// rotate its 7 seats: a 4-of-7 vote among the FOUNDATION's seats, valid for a
/// chosen window (1–90 days), that — once it reaches threshold before expiry —
/// writes the new seat set into the child's Council via `execute_child_rotation`.
///
/// This is the one cross-Circle authority: the parent can rotate a direct
/// child's seats. PDA: ["childvote", child, &nonce.to_le_bytes()].
#[account]
pub struct ChildSeatVote {
    pub foundation: Pubkey,                 // the parent Circle whose seats vote
    pub child: Pubkey,                      // the target Circle
    pub nonce: u64,
    pub new_seats: [Pubkey; COUNCIL_SEATS], // the proposed seat set
    pub approvals: u8,                      // bitmask over the foundation's seats
    pub created_at: i64,
    pub expires_at: i64,                    // vote validity deadline (1–90 days out)
    pub executed: bool,
    pub bump: u8,
}

impl ChildSeatVote {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 32 * COUNCIL_SEATS + 1 + 8 + 8 + 1 + 1;
    pub fn approval_count(&self) -> u8 {
        self.approvals.count_ones() as u8
    }
}

/// The Circle's designated treasury steward wallet (governed by a 4-of-7
/// `SetTreasuryWallet` vote, applied by `set_treasury_wallet`). Separate PDA so
/// the `Circle` layout is untouched. Absent ⇒ none set (the treasury PDA itself
/// remains the only custodian). PDA: ["treasurycfg", circle].
#[account]
pub struct TreasuryConfig {
    pub circle: Pubkey,
    pub wallet: Pubkey,
    pub bump: u8,
}

impl TreasuryConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 1;
}

/// A member-authored post / bulletin for a Circle (F30). Text and/or an IPFS
/// image, shown only within [start_date, end_date]. Authored by a member (a
/// wallet that owns a live membership in the Circle); deletable by ANY of the 7
/// Council seats at any time. PDA: ["post", circle, author, &nonce.to_le_bytes()].
#[account]
pub struct Post {
    pub circle: Pubkey,
    pub author: Pubkey,
    pub nonce: u64,
    pub created_at: i64,
    pub start_date: i64,
    pub end_date: i64,
    pub image_cid: String, // IPFS CID of an optional image ("" = none)
    pub text: String,
    pub bump: u8,
}

impl Post {
    pub const MAX_TEXT: usize = 500;
    pub const MAX_CID: usize = 64;
    pub const SPACE: usize = 8        // discriminator
        + 32                           // circle
        + 32                           // author
        + 8                            // nonce
        + 8                            // created_at
        + 8                            // start_date
        + 8                            // end_date
        + 4 + Self::MAX_CID            // image_cid
        + 4 + Self::MAX_TEXT           // text
        + 1; // bump
}
