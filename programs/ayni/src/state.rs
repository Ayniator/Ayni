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

/// Binds a member proposal (F6 anonymous ZK ballot) to a seat election: if the
/// proposal passes, `candidate` is installed into `council.seats[seat_index]`
/// (group-conscience election of a servant). The proposal's `description_hash`
/// MUST equal H("AHA-elect" || seat_index || candidate), so the machine-readable
/// outcome is exactly what members anonymously voted on. PDA: ["election", proposal].
#[account]
pub struct SeatElection {
    pub circle: Pubkey,
    pub proposal: Pubkey,
    pub seat_index: u8,
    pub candidate: Pubkey,
    pub installed: bool,
    pub bump: u8,
}
impl SeatElection {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 32 + 1 + 1;
}

/// A MACI (Minimal Anti-Collusion Infrastructure) voting round bound to a member
/// proposal. Voters publish ENCRYPTED commands — a vote, or a key-change that
/// silently invalidates a coerced vote — sealed to the `coordinator` key, so no
/// observer or briber can see how anyone voted on-chain (receipt-freeness). The
/// coordinator decrypts the queue off-chain and submits a tally with a ZK proof
/// that it processed honestly; `tally_hash` records the verified result. This
/// account is the on-chain message queue + round state. PDA: ["maci", proposal].
/// (The process/tally circuits + coordinator service are specified in docs/maci.md.)
#[account]
pub struct MaciRound {
    pub circle: Pubkey,
    pub proposal: Pubkey,
    pub coordinator: [u8; 32], // x25519 pubkey messages are sealed to
    pub message_count: u64,
    /// Queue frozen: `publish_maci_message` refuses once this is set. Flipped by
    /// `close_maci_round` at the proposal deadline (F39) — the freeze is what
    /// makes `MaciState.frozen_message_count` an honest snapshot.
    pub processed: bool,
    pub tally_hash: [u8; 32], // set by commit_maci_tally (F39)
    pub bump: u8,
}
impl MaciRound {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1 + 32 + 1;
}

/// One encrypted MACI command (vote or key-change), sealed to the round's
/// coordinator with a single-use ephemeral key. Append-only; the coordinator
/// applies last-valid-per-voter off-chain, so a later message overrides an
/// earlier (coerced) one. PDA: ["macimsg", round, index].
#[account]
pub struct MaciMessage {
    pub round: Pubkey,
    pub index: u64,
    pub eph_pubkey: [u8; 32],
    pub ciphertext: Vec<u8>, // fixed CT_LEN
    pub bump: u8,
}
impl MaciMessage {
    /// 160-byte padded MACI command + 16-byte NaCl box MAC.
    pub const CT_LEN: usize = 176;
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 4 + Self::CT_LEN + 1;
}

/// A member's per-element visibility policy (Trust Platform Epic 5): who may see
/// each element of their page — the avatar, the quipu, the bio — chosen
/// independently. The audience widens through three tiers:
///   0 = ChosenOnes   (only members the owner has chosen)
///   1 = MyCircle     (members of this Circle) — the DEFAULT for every element
///   2 = AllMembers   (any member of the fellowship — the widest audience that
///                     exists; nothing is ever visible to the public internet)
///
/// Absent ⇒ every element defaults to `MyCircle` (tier 1): the protective
/// default gives disclosure its social meaning, and opening up is a deliberate
/// act. A viewer outside an element's audience sees the element simply absent —
/// there is NO "hidden" indicator, so a sparse newcomer's page and a private
/// elder's page look identical. PDA: ["visibility", circle, member].
///
/// This is the policy engine. Cryptographic enforcement of `MyCircle` (a ZK
/// circle-membership proof on the read path, inheriting Epic 2's machinery) and
/// the encrypted per-tier key distribution for avatar/bio are the remaining
/// Phase-2 work; the quipu is on-chain and gated by this policy directly.
#[account]
pub struct VisibilityPolicy {
    pub circle: Pubkey,
    pub member: [u8; 32], // membership commitment
    pub avatar: u8,       // tier 0..=2
    pub quipu: u8,
    pub bio: u8,
    pub bump: u8,
}

impl VisibilityPolicy {
    pub const CHOSEN: u8 = 0;
    pub const MY_CIRCLE: u8 = 1; // the default
    pub const ALL_MEMBERS: u8 = 2;
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1 + 1 + 1;

    pub fn valid_tier(t: u8) -> bool {
        t <= Self::ALL_MEMBERS
    }
}

/// One quipu cord — a single step of the twelve, completed and tied by the
/// member's sponsor as the closing act of the ceremony (Trust Platform Epic 3).
///
/// Binary and personal by design: the account either exists (you walked the
/// step) or it does not. There is NO score, no fraction, no "N of 12" — the
/// only fields are which step and when. The cord's alchemical COLOUR is not
/// stored on-chain; it is derived from `step` client-side (see
/// `frontend/lib/quipu.ts` and `docs/quipu.md`), so the colour mapping can be
/// finalised against the Emerald correspondence table without a chain change.
///
/// `sponsor` is the tying sponsor's membership commitment (the wing bond), so
/// the ceremony's closing act is recorded as anonymously as the memberships
/// themselves. One cord per (member, step). PDA: ["quipu", circle, member, step].
#[account]
pub struct QuipuCord {
    pub circle: Pubkey,
    pub member: [u8; 32],  // the walker's membership commitment
    pub step: u8,          // 1..=12
    pub sponsor: [u8; 32], // the tying sponsor's membership commitment
    pub completed_at: i64,
    pub bump: u8,
}

impl QuipuCord {
    pub const FIRST_STEP: u8 = 1;
    pub const LAST_STEP: u8 = 12;
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 32 + 8 + 1;
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
    /// 512-byte padded envelope + 16-byte NaCl box MAC. Was 1040 — but a
    /// 1040-byte ciphertext makes the send_message instruction data 1156
    /// bytes, which CANNOT fit Solana's 1232-byte transaction limit with
    /// accounts and a signature: the old size was unsendable in a single
    /// transaction (found by the F55 relayer integration test, 2026-08-11).
    /// 528 fits with room to spare, halves the account rent (the deferred
    /// F32 rent item), and long-form mail belongs to the F63 mailbox anyway.
    pub const CT_LEN: usize = 528;
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

/// Per-Circle two-sponsor admission policy (Trust Platform Epic 1, amended
/// v0.2). Absent or `required == false` ⇒ admission works as before (F4
/// Secretary-gated, or F31 open). Present with `required == true` ⇒ every
/// admission needs the asymmetric attestation pair: the **parrain** (any member
/// in good standing) and a **trusted servant** (any of the 7 Council seats),
/// two different people. Sibling PDA so the `Circle` layout is untouched.
/// PDA: ["twosponsor", circle].
#[account]
pub struct TwoSponsorAdmission {
    pub circle: Pubkey,
    pub required: bool,
    pub bump: u8,
}

impl TwoSponsorAdmission {
    pub const SPACE: usize = 8 + 32 + 1 + 1;
}

/// The parrain's attestation for one newcomer (Epic 1, attestation A). One per
/// newcomer — the PDA seed is the refusal of a second. Two forms:
///
/// * **Named (pilot)** — `attest_admission`: `parrain` records the attesting
///   membership's commitment (needed for the distinct-persons rule; no more
///   linkable than the WingPeer bond the pilot already accepts), `nullifier`
///   is zero.
/// * **Anonymous (Epic 2)** — `attest_admission_zk`: `parrain` is zero and
///   `nullifier = Poseidon(secret, newcomer)` from a Groth16 proof that SOME
///   member of the tree attested — the sponsor edge never exists on-chain.
///
/// PDA: ["attest", circle, newcomer_commitment] — one parrain either way.
#[account]
pub struct AdmissionAttestation {
    pub circle: Pubkey,
    pub newcomer: [u8; 32],
    pub parrain: [u8; 32],   // named form: attesting commitment; zero if anonymous
    pub nullifier: [u8; 32], // anonymous form: vouch nullifier; zero if named
    pub attested_at: i64,
    /// Set by `confirm_admission`: 1 + the MemberTree leaf index the newcomer
    /// was inserted at (1-BASED; 0 = not yet confirmed), and the member epoch
    /// it belongs to (F54). Lets clients reconstruct the exact insertion order
    /// even when confirmations interleave with direct issuance. Valid only
    /// while `leaf_epoch` equals the Circle's current epoch
    /// (`RecentRoots.epoch`); stale after an epoch rebuild (the reinsertion's
    /// `EpochLeaf` supersedes it).
    pub leaf_index: u64,
    pub leaf_epoch: u64,
    pub bump: u8,
}

impl AdmissionAttestation {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1;

    pub fn is_anonymous(&self) -> bool {
        self.parrain == [0u8; 32]
    }
}

/// F54a — ring buffer of a Circle's recent MemberTree roots, plus the current
/// member epoch (F54b). Companion PDA ["roots", circle] so the already-deployed
/// MemberTree layout never changes. Written by the permissionless `note_root`
/// crank (run by a prover right before proving, so the root they prove against
/// survives concurrent insertions) and by `begin_member_epoch`/`reinsert_member`.
/// A proof verified against ANY root in the buffer is accepted where the
/// instruction opts in (attest_admission_zk) — a bounded staleness window, not
/// an unbounded one: the buffer holds `N` roots and old ones are overwritten.
#[account]
pub struct RecentRoots {
    pub circle: Pubkey,
    /// Member epoch — 0 until the first `begin_member_epoch` rebuild. Each
    /// rebuild increments it and empties the tree; only live memberships are
    /// re-inserted, which is what makes the votable set a GOOD-STANDING set.
    pub epoch: u64,
    /// When the current epoch began (0 for epoch 0).
    pub epoch_started_at: i64,
    /// Next write position in `roots` (wraps at N).
    pub index: u8,
    /// Last N roots, zero entries = never written.
    pub roots: [[u8; 32]; Self::N],
    pub bump: u8,
}

impl RecentRoots {
    // 16, not 32: borsh deserializes the array on the SBF stack, and 32 roots
    // (1 KiB) overflowed the 4 KiB frame in the widest accounts struct. 16
    // recent roots is still a generous staleness window for a proof in flight.
    pub const N: usize = 16;
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 1 + 32 * Self::N + 1;

    pub fn push(&mut self, root: [u8; 32]) {
        // Skip consecutive duplicates so a crank cannot flush the buffer by
        // re-noting the same root N times.
        let last = (self.index as usize + Self::N - 1) % Self::N;
        if self.roots[last] == root {
            return;
        }
        self.roots[self.index as usize] = root;
        self.index = ((self.index as usize + 1) % Self::N) as u8;
    }

    pub fn contains(&self, root: &[u8; 32]) -> bool {
        *root != [0u8; 32] && self.roots.iter().any(|r| r == root)
    }
}

/// F54b — one re-inserted leaf of an epoch rebuild. PDA
/// ["epochleaf", circle, epoch_le, commitment]; `init` collision is the
/// double-reinsertion guard. `leaf_index` lets clients reconstruct the new
/// tree's insertion order exactly.
#[account]
pub struct EpochLeaf {
    pub circle: Pubkey,
    pub epoch: u64,
    pub commitment: [u8; 32],
    pub leaf_index: u64,
    pub bump: u8,
}

impl EpochLeaf {
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 8 + 1;
}

/// F56 — fellowship-wide verification anchor: a Circle's member root published
/// under its foundation, so any Circle in the same federation can verify a
/// visiting member's proof without holding the visitor's home tree. Written by
/// the permissionless `publish_member_root` crank (it only copies verified
/// on-chain state); parentage is constraint-checked with the same rule the
/// federation-governance fixes hardened (`child.parent == foundation`).
/// PDA: ["anchor", foundation, circle].
#[account]
pub struct CircleRootAnchor {
    pub foundation: Pubkey,
    pub circle: Pubkey,
    pub root: [u8; 32],
    pub epoch: u64,
    pub updated_at: i64,
    pub bump: u8,
}

impl CircleRootAnchor {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

/// F56 — a foundation's CONSENT that `circle` is genuinely part of its
/// federation. Without this, `circle.parent == foundation` proves nothing:
/// `initialize_circle` is permissionless and `parent` is caller-set, so an
/// attacker could self-claim a real foundation as parent, anchor an
/// attacker-controlled root, and forge a fellow-member `VisitPass` at every
/// host in the federation (ultracode CRITICAL, 2026-08-11b). This PDA — created
/// only by a **foundation Council seat** via `approve_federation_child` — is the
/// missing consent: `publish_member_root` requires it, so only foundation-vetted
/// children can be anchored, and `verify_fellow_member` (which needs the anchor)
/// is transitively gated. `state.rs`'s own note that `parent` is "a link, never
/// an actor" is why the actor must be this explicit approval. PDA:
/// ["fedchild", foundation, circle].
#[account]
pub struct FederationChild {
    pub foundation: Pubkey,
    pub circle: Pubkey,
    pub approved_at: i64,
    pub bump: u8,
}

impl FederationChild {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

/// F56 — proof that AN anonymous member of `home_circle` verified themselves to
/// `host_circle`. The nullifier is Poseidon(secret, host_circle_field) — one
/// pass per member per host Circle, deterministic, naming no one. PDA:
/// ["visit", host_circle, nullifier].
#[account]
pub struct VisitPass {
    pub host_circle: Pubkey,
    pub home_circle: Pubkey,
    pub nullifier: [u8; 32],
    pub verified_at: i64,
    pub bump: u8,
}

impl VisitPass {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
}

/// Marks a membership as provisional (Epic 1 / Epic 9): admitted on the
/// parrain's attestation alone, awaiting the trusted servant's co-attestation.
/// While this marker exists the commitment is NOT in the MemberTree, so every
/// members-only proof (votes, elections) fails by construction — the one-way
/// glass is structural, not cosmetic. The faucet still works: `activate_faucet`
/// checks the membership account, not the tree. `confirm_admission` inserts the
/// commitment into the tree and closes this marker.
/// PDA: ["provisional", circle, commitment].
#[account]
pub struct ProvisionalMember {
    pub circle: Pubkey,
    pub commitment: [u8; 32],
    pub issued_at: i64,
    pub bump: u8,
}

impl ProvisionalMember {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

/// A Circle's gas faucet — first-transaction-fee mutual aid for newly admitted
/// members (Trust Platform Epic 0, Tradition 7). The jar's lamports live ON this
/// account; anyone may top it up by plain transfer, but treasury→jar refills
/// require a passed anonymous member vote (`refill_faucet`), and outflows happen
/// only through `activate_faucet` — one uniform grant per neophyte, ever,
/// triggered by the neophyte's designated parrain (their WingPeer).
///
/// `grant_lamports` is Treasurer-tunable but the program itself enforces the
/// absolute cap `FAUCET_MAX_GRANT_LAMPORTS` — the cap is revised at the equinox
/// by governance (a program upgrade), never by a price oracle.
///
/// Every grant pays exactly `grant_lamports`, and uniformity is enforced rather
/// than merely intended: a retune stamps `amount_changed_at`, and no grant may
/// be paid until `FAUCET_AMOUNT_COOLDOWN` has elapsed. Without that wait a
/// Treasurer could set a distinctive amount immediately before one neophyte's
/// activation and restore it after, tagging that person's wallet with a
/// correlatable transfer — exactly the fingerprint uniform amounts exist to
/// prevent. PDA: ["faucet", circle].
#[account]
pub struct FaucetJar {
    pub circle: Pubkey,
    /// Lamports paid out per grant (Treasurer-set, ≤ FAUCET_MAX_GRANT_LAMPORTS).
    pub grant_lamports: u64,
    /// Jar-level accounting: how many grants this jar has ever paid. Jar-level,
    /// never member-level — nothing here counts or ranks a person.
    pub granted: u64,
    /// Unix time `grant_lamports` was last changed (0 = never). Grants wait out
    /// `FAUCET_AMOUNT_COOLDOWN` after a change, so an amount can never be aimed
    /// at an individual.
    pub amount_changed_at: i64,
    pub bump: u8,
}

impl FaucetJar {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1;
}

/// Absolute on-chain ceiling for a faucet grant (≈ USD 0.25; revised each
/// equinox by top-circle vote via program upgrade — see Epic 0 analysis).
pub const FAUCET_MAX_GRANT_LAMPORTS: u64 = 2_000_000; // 0.002 SOL
/// Default grant: rent-exempt minimum for a fresh wallet + >100 tx fees.
pub const FAUCET_DEFAULT_GRANT_LAMPORTS: u64 = 1_500_000; // 0.0015 SOL
/// How long grants pause after the Treasurer retunes the amount (24h), so a
/// change applies to everyone alike instead of to one targeted neophyte.
pub const FAUCET_AMOUNT_COOLDOWN: i64 = 24 * 60 * 60;
/// --- Member-ballot integrity (governance-hole fix, 2026-08-14) ---
///
/// These three bounds exist because a single Council seat could otherwise pass
/// an arbitrary member proposal alone. The chain was: `begin_member_epoch`
/// (one seat) empties the MemberTree and zeroes `member_count`; the
/// permissionless `reinsert_member` crank re-enters ONE commitment — the
/// attacker's; `create_member_proposal` validated `voting_period` not at all,
/// so a ballot could open and close in seconds against that manufactured
/// electorate of one; and `quorum_threshold(1, ..)` is `.max(1)` = 1, so a
/// single `yes` met quorum and passed. `refill_faucet` and every other
/// member-vote-gated action then executed on one person's say-so.
///
/// Each constant below cuts that chain at a different point, so no single one
/// of them is load-bearing.

/// At least two distinct members must actually cast a ballot for a member
/// proposal to pass. This is the direct fix for the arithmetic that made the
/// attack work: quorum is `((eligible + 2) / 3).max(1)`, and the `.max(1)` floor
/// — correct in itself, so quorum never rounds to zero — means an electorate of
/// one has a quorum of one. A single `yes` was a passing group conscience.
///
/// Deliberately a TURNOUT floor rather than a minimum voting DURATION. A
/// duration floor looks equivalent and is worse: it would make the passed-vote
/// path untestable on a live validator (a test cannot wait out days), costing
/// the only end-to-end coverage of the path that gates `refill_faucet`, while
/// still not preventing one member from being the whole electorate.
///
/// Two is the floor, not a quorum: real quorum stays the configured
/// one-third-of-eligible. This only says that one person alone is never a group
/// conscience, which is Tradition 2 read literally.
pub const MIN_TURNOUT: u64 = 2;
/// Upper bound on a member ballot (90 days), matching the Council child
/// proposals. A ballot parked open indefinitely votes against a snapshot of an
/// electorate that has long since moved on.
pub const MAX_VOTING_PERIOD: i64 = 90 * 24 * 60 * 60;
/// How long after a member-epoch rebuild a new ballot must wait (30 days). The
/// rebuild empties the votable set on purpose; until the live memberships have
/// re-entered, `member_count` undercounts and quorum is computed against a set
/// the caller of `begin_member_epoch` chose. `reinsert_member` is
/// permissionless and anyone may crank it on anyone's behalf, so this window is
/// long enough for the electorate to heal by itself.
pub const EPOCH_SETTLE_PERIOD: i64 = 30 * 24 * 60 * 60;
/// Fewest members for an anonymous ballot to be a group conscience at all.
/// Below this a Circle is not blocked from governing itself — a seat of its
/// PARENT Circle co-signs the proposal instead, supplying the second party a
/// captured seat cannot manufacture. `Circle.parent` is a PDA seed and so is
/// immutable for the Circle's life, which is what makes that escape safe: a
/// captured seat cannot redirect its own Circle at a parent it controls.
pub const MIN_ELECTORATE: u64 = 3;

/// A single refill vote may move at most this many grants' worth into the jar.
/// The jar is a second treasury outflow, guarded only by a member vote whose
/// amount lives in an opaque hash — without a ceiling one ballot could commit
/// the entire treasury. Bounding it keeps the jar mutual aid, not a back door
/// around `withdraw_treasury`'s 4-of-7 + time-lock + allowlist.
pub const FAUCET_MAX_REFILL_GRANTS: u64 = 100;

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

// ---------------------------------------------------------------------------
// Epic 5 Phase-2 — shielded ownership and the encrypted read path (F60 / F61)
// ---------------------------------------------------------------------------

/// The blinded owner tag: the de-enumeration primitive for `Membership.owner`.
///
/// THE LEAK IT CLOSES. `Membership.owner` is a raw wallet at a fixed offset, so
/// anyone could `getProgramAccounts` with one memcmp filter and list every
/// membership a wallet holds — the roster / membership graph Epic 2 and Epic 5
/// forbid publishing. The member needed that field only for two things: signing
/// as themselves, and FINDING their own memberships. This account takes the
/// second job away from it, so `owner` can stop being the member's public
/// wallet altogether (see `shield_membership`).
///
/// PDA: ["mownr", tag] — `tag` is 32 bytes the member derives from a secret only
/// they hold (their viewing secret, itself derived from the master secret, the
/// credential of record), domain-separated per Circle and per index. Because the
/// tag is the ADDRESS, there is no field to scan and nothing to filter on: an
/// observer can read every one of these accounts and learn only that some
/// membership is shielded. Deriving the address requires the secret; inverting
/// it requires breaking SHA-256. Two tags of the SAME member are unlinkable to
/// each other (distinct Circle inputs, distinct hashes).
///
/// It stores no owner, no wallet, no commitment and no authority — deliberately.
/// An `authority` field would be exactly the memcmp handle this account exists
/// to remove. Rotation is by minting a fresh tag at the next index; a stale tag
/// reveals nothing it did not already reveal.
#[account]
pub struct OwnerTag {
    /// The membership this tag resolves to.
    pub membership: Pubkey,
    pub bump: u8,
}

impl OwnerTag {
    pub const SPACE: usize = 8 + 32 + 1;
    pub const SEED: &'static [u8] = b"mownr";
}

/// The member's encrypted profile object — the served bio and the pointer to the
/// served avatar, as CIPHERTEXT the chain cannot read (F60 Phase-2).
///
/// Before this, per-tier visibility was enforced app-side: the plaintext was
/// never served at all (there was no serving layer), and `mayView` in
/// `frontend/lib/visibility.ts` was a rendering decision a modified client could
/// simply ignore. Here the served bytes ARE the ciphertext; a viewer without the
/// element key gets 200 bytes of noise, which is what "hidden" has to mean.
///
/// FIXED-LENGTH BY CONSTRUCTION. `bio_ct` is always the same size, always
/// written, and always random-looking. A member with no bio stores random bytes
/// (no key ever opens them) — so "wrote nothing" and "wrote something you may
/// not read" are the same 200 bytes on chain. Hidden ≡ absent, at the byte
/// level, not at the CSS level.
///
/// PDA: ["mprofile", circle, commitment] — commitment-keyed exactly like
/// `VisibilityPolicy`, so it adds no linkage that the membership itself does not
/// already publish, and no wallet appears anywhere in it.
#[account]
pub struct MemberProfile {
    pub circle: Pubkey,
    /// The owning membership's commitment.
    pub member: [u8; 32],
    /// The member's X25519 public key, derived from their viewing secret. This
    /// is how a viewer computes the shared secret that addresses their key drop.
    /// It is a public key by definition and links to no wallet.
    pub enc_pub: [u8; 32],
    /// Key epoch. Every element key and every key-drop address is derived over
    /// this number, so bumping it re-keys the profile and silently expires every
    /// outstanding drop — that is the revocation mechanism, and it emits no
    /// "revoked X" record about anybody.
    pub epoch: u16,
    /// The bio, sealed under the bio element key. Always exactly `BIO_CT` bytes.
    pub bio_ct: [u8; MemberProfile::BIO_CT],
    /// Padded pointer (CID) to the avatar ciphertext, or all-zero for none. The
    /// avatar blob itself is never stored in the clear anywhere.
    pub avatar_ref: [u8; MemberProfile::AVATAR_REF],
    pub bump: u8,
}

impl MemberProfile {
    /// 24-byte nonce + secretbox(160-byte padded plaintext) = 24 + 160 + 16.
    pub const BIO_CT: usize = 200;
    pub const AVATAR_REF: usize = 64;
    pub const SPACE: usize =
        8 + 32 + 32 + 32 + 2 + Self::BIO_CT + Self::AVATAR_REF + 1;
    pub const SEED: &'static [u8] = b"mprofile";
}

/// One sealed element key, dropped for exactly one viewer (F60 Phase-2).
///
/// WHY THIS PUBLISHES NO AUDIENCE GRAPH. The account's ADDRESS is
/// ["vdrop", H(domain ‖ X25519(owner, viewer) ‖ owner_commitment ‖ epoch)] —
/// derived from a Diffie-Hellman shared secret, so only the two parties can
/// compute it. It names neither party. It has no authority field, no owner
/// field, no recipient field and no membership field: an observer reading every
/// drop that exists sees a pile of 104-byte blobs and cannot say who granted
/// what to whom, nor even how many people one member granted. That is why a
/// "who may read whom" table — the interest graph Epic 5 forbids — never
/// materialises on chain.
///
/// It is deliberately WRITE-ONCE and has no revoke instruction: a closer or an
/// updater would need an authority, and an authority is a memcmp handle. Access
/// is withdrawn by bumping `MemberProfile.epoch`, which re-keys the content and
/// strands every drop of the previous epoch at once.
#[account]
pub struct VisibilityKeyDrop {
    /// 24-byte nonce + secretbox([bio_key ‖ avatar_key]) = 24 + 64 + 16.
    /// A key the viewer may not have is all-zero inside the plaintext, so a
    /// partial grant is indistinguishable in size from a full one.
    pub sealed: [u8; VisibilityKeyDrop::SEALED],
    pub epoch: u16,
    pub bump: u8,
}

impl VisibilityKeyDrop {
    pub const SEALED: usize = 104;
    pub const SPACE: usize = 8 + Self::SEALED + 2 + 1;
    pub const SEED: &'static [u8] = b"vdrop";
    /// Length of the element-key plaintext inside `sealed`: bio ‖ avatar.
    pub const KEYS_LEN: usize = 64;
}

#[cfg(test)]
mod visibility_phase2_tests {
    use super::*;

    #[test]
    fn shielded_ownership_accounts_carry_no_wallet_handle() {
        // The whole point of OwnerTag is that it has nothing to filter on but
        // the membership it resolves to. If this ever grows an authority or an
        // owner field, the memcmp enumeration this closes reopens.
        assert_eq!(OwnerTag::SPACE, 8 + 32 + 1);
        // Likewise the key drop: no recipient, no granter, no membership.
        assert_eq!(
            VisibilityKeyDrop::SPACE,
            8 + VisibilityKeyDrop::SEALED + 2 + 1
        );
    }

    #[test]
    fn member_profile_bio_is_fixed_length_so_silence_looks_like_secrecy() {
        // Fixed-size ciphertext: a member with no bio and a member with a bio
        // you may not read occupy the same bytes.
        assert_eq!(MemberProfile::BIO_CT, 200);
        assert_eq!(
            MemberProfile::SPACE,
            8 + 32 + 32 + 32 + 2 + 200 + 64 + 1
        );
        // Sealed element keys are two 32-byte keys under one secretbox.
        assert_eq!(VisibilityKeyDrop::KEYS_LEN, 64);
        assert_eq!(
            VisibilityKeyDrop::SEALED,
            24 + VisibilityKeyDrop::KEYS_LEN + 16
        );
    }

    #[test]
    fn a_membership_key_is_never_the_default_pubkey() {
        // Regression guard for the shielded path: clearing `owner` to default
        // must not accidentally authorise the default pubkey.
        let m = Membership {
            circle: Pubkey::default(),
            commitment: [0u8; 32],
            issued_at: 0,
            expires_at: 0,
            level: 0,
            owner: Pubkey::default(),
            recovery_keys: [Pubkey::default(); Membership::MAX_GUARDIANS],
            require_cosign: false,
            bump: 0,
        };
        assert!(!m.is_member_key(&Pubkey::default()));
    }
}

// ---------------------------------------------------------------------------
// F39 — MACI processing + tally (the second half of coercion-resistant voting).
//
// `MaciRound` / `MaciMessage` above are the submission layer (round state +
// append-only sealed queue). Everything below is the part that turns a queue of
// sealed commands into an outcome: a per-round lifecycle account, the ZK sign-up
// records that bound the tally, and the front-running guard for sign-up.
//
// Read docs/maci.md before changing any of this — in particular the honest
// statement of what the coordinator can and cannot do.
// ---------------------------------------------------------------------------

/// Round is open: sign-ups and sealed commands are accepted.
pub const MACI_STAGE_OPEN: u8 = 0;
/// Queue frozen at `frozen_message_count`; the crank may fold messages.
pub const MACI_STAGE_CLOSED: u8 = 1;
/// Every frozen message has been folded into `chain_digest`.
pub const MACI_STAGE_PROCESSED: u8 = 2;
/// The coordinator has committed a tally; the challenge window is running.
pub const MACI_STAGE_COMMITTED: u8 = 3;
/// The outcome has been written onto the member proposal. Terminal.
pub const MACI_STAGE_FINALIZED: u8 = 4;

/// Largest message batch one `process_maci_messages` call may fold. Bounded by
/// the 1232-byte transaction limit (each message is an extra account meta), not
/// by compute; clients should use ~20 without an address-lookup table.
pub const MACI_PROCESS_MAX_BATCH: usize = 32;

/// Upper bound on a round's dispute window (30 days).
pub const MACI_MAX_CHALLENGE_SECS: i64 = 30 * 24 * 60 * 60;

/// Serialized length of a `MaciMessage` account: 8 discriminator + 32 round +
/// 8 index + 32 eph_pubkey + 4 vec-len + 176 ciphertext + 1 bump. The crank
/// reads these accounts as raw bytes (never deserializing them onto the SBF
/// stack), so the offsets are pinned here next to the struct they mirror.
pub const MACI_MESSAGE_DATA_LEN: usize = 8 + 32 + 8 + 32 + 4 + MaciMessage::CT_LEN + 1;
pub const MACI_MSG_OFF_ROUND: usize = 8;
pub const MACI_MSG_OFF_INDEX: usize = 40;
pub const MACI_MSG_OFF_EPH: usize = 48;
pub const MACI_MSG_OFF_CTLEN: usize = 80;
pub const MACI_MSG_OFF_CT: usize = 84;
pub const MACI_MSG_OFF_BUMP: usize = MACI_MESSAGE_DATA_LEN - 1;

/// Lifecycle + tally state for one MACI round. Kept in its own PDA so
/// `MaciRound` (already deployed) is never resized. PDA: ["macistate", round].
///
/// `chain_digest` is the load-bearing field: it is folded **on chain**, message
/// by message, in strict index order, from the actual `MaciMessage` accounts. It
/// therefore pins the exact multiset AND order of sealed commands the tally was
/// computed over — a coordinator cannot censor a message, insert one, or reorder
/// the queue without changing a value the program itself computed.
#[account]
pub struct MaciState {
    pub round: Pubkey,
    pub proposal: Pubkey,
    pub circle: Pubkey,
    /// The wallet that opened the round: the only signer allowed to commit a
    /// tally. Named on purpose — the coordinator is accountable, not anonymous.
    pub coordinator_authority: Pubkey,
    /// Sign-ups and sealed commands are refused from this instant (= the member
    /// proposal's deadline, snapshotted at open).
    pub msg_deadline: i64,
    /// Dispute window between `commit_maci_tally` and `finalize_maci_round`.
    pub challenge_secs: i64,
    pub signup_count: u64,
    /// `MaciRound.message_count` at the moment the queue was frozen.
    pub frozen_message_count: u64,
    pub processed_count: u64,
    pub chain_digest: [u8; 32],
    /// Running hash over registered sign-up keys, in registration order.
    pub signup_digest: [u8; 32],
    pub tally_yes: u64,
    pub tally_no: u64,
    /// Coordinator's commitment to the decrypted queue it applied (see
    /// docs/maci.md — this is what makes a wrong tally provable after the fact).
    pub plaintext_digest: [u8; 32],
    /// Binding hash over every public tally input; mirrored into
    /// `MaciRound.tally_hash`.
    pub tally_hash: [u8; 32],
    pub committed_at: i64,
    pub stage: u8,
    pub passed: bool,
    pub bump: u8,
}

impl MaciState {
    pub const SPACE: usize = 8        // discriminator
        + 32 * 4                       // round, proposal, circle, coordinator_authority
        + 8 * 6                        // msg_deadline, challenge_secs, signup_count,
                                       // frozen_message_count, processed_count, committed_at
        + 32 * 4                       // chain_digest, signup_digest, plaintext_digest, tally_hash
        + 8 + 8                        // tally_yes, tally_no
        + 1 + 1 + 1; // stage, passed, bump
}

/// Front-running guard for MACI sign-up. A sign-up publishes a ZK proof and a
/// MACI signing key, and the proof does NOT bind the key (the `member_vote`
/// circuit has no input for it, and adding one means a new trusted setup — F44,
/// out of scope). Without this account, anyone who saw the sign-up transaction
/// could re-submit the same proof with THEIR key and steal the member's vote.
///
/// So sign-up is commit–reveal: first publish
/// `H("AHA-maci-signup" || round || nullifier || maci_pubkey)`, then reveal in a
/// LATER slot. An attacker cannot pre-commit — the nullifier is a Poseidon
/// output they only learn from the reveal itself, by which time their commitment
/// can no longer be older. The commitment leaks nothing: it is a hash of values
/// that are unlinkable to the member. PDA: ["macicommit", round, commitment].
#[account]
pub struct MaciSignupCommit {
    pub round: Pubkey,
    pub commitment: [u8; 32],
    pub slot: u64,
    pub bump: u8,
}

impl MaciSignupCommit {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

/// One registered MACI voter: an ed25519 key that may sign commands for this
/// round, admitted by an anonymous `member_vote` proof (Merkle inclusion in the
/// proposal's snapshotted member set + a per-round nullifier, so one member gets
/// exactly one key). The key is public — that is fine and is how MACI works; a
/// *key change* to a key nobody else knows is what defeats coercion, and key
/// changes only ever travel inside sealed commands. PDA: ["macisignup", round, pubkey].
#[account]
pub struct MaciSignup {
    pub round: Pubkey,
    pub pubkey: [u8; 32],
    pub index: u64,
    /// Voice credits. One member, one voice — reserved for future weighting.
    pub weight: u64,
    pub bump: u8,
}

impl MaciSignup {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1;
}
