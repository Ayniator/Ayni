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
pub mod verifying_key_vote;

#[cfg(test)]
mod proptests;

use council::ProposalAction;
use instructions::*;
use instructions::verify_disclosure::DisclosureGate;

declare_id!("AHAHnRiJEANtYJpWZxGZZa63ZTFzMa5e5Q8DszCgavSG");

#[program]
pub mod ayni {
    use super::*;

    /// Create a Circle and seat its 7-seat Council (the authority) in one tx.
    /// `parent` is the Circle this nests under (the World Service address, or a
    /// root for the foundation); `seats` are the 7 Council members.
    pub fn initialize_circle(
        ctx: Context<InitializeCircle>,
        parent: Pubkey,
        name: String,
        membership_period: i64,
        recovery_timelock: i64,
        seats: [Pubkey; crate::council::COUNCIL_SEATS],
    ) -> Result<()> {
        instructions::initialize_circle(ctx, parent, name, membership_period, recovery_timelock, seats)
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

    // --- Two-sponsor admission (Trust Platform Epic 1, amended v0.2) ---

    /// Any Council seat toggles the two-sponsor admission policy: parrain (any
    /// member in good standing) + trusted servant (any of the 7 seats).
    pub fn set_two_sponsor_admission(ctx: Context<SetTwoSponsorAdmission>, required: bool) -> Result<()> {
        instructions::set_two_sponsor_admission(ctx, required)
    }

    /// Attestation A: the parrain attests for the newcomer they sponsor — one
    /// action, one attestation per newcomer, self-attestation refused.
    pub fn attest_admission(ctx: Context<AttestAdmission>, newcomer_commitment: [u8; 32]) -> Result<()> {
        instructions::attest_admission(ctx, newcomer_commitment)
    }

    /// Attestation A, anonymous form (Epic 2): a Groth16 proof that SOME member
    /// of the tree attests for this newcomer — the sponsor edge never exists.
    /// Reuses the member_vote circuit + ceremony key, like prove_personhood.
    pub fn attest_admission_zk(
        ctx: Context<AttestAdmissionZk>,
        newcomer_commitment: [u8; 32],
        root: [u8; 32],
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::attest_admission_zk(ctx, newcomer_commitment, root, nullifier, proof_a, proof_b, proof_c)
    }

    /// F54a — record the current member root into the recent-roots ring buffer
    /// (permissionless crank; run before proving).
    pub fn note_root(ctx: Context<NoteRoot>) -> Result<()> {
        instructions::note_root(ctx)
    }

    /// F54b — begin a new member epoch: empty the tree; only live memberships
    /// re-enter via `reinsert_member`. Any-seat housekeeping.
    pub fn begin_member_epoch(ctx: Context<BeginMemberEpoch>) -> Result<()> {
        instructions::begin_member_epoch(ctx)
    }

    /// F54b — re-insert one live membership into the current epoch's tree
    /// (permissionless).
    pub fn reinsert_member(ctx: Context<ReinsertMember>, epoch: u64) -> Result<()> {
        instructions::reinsert_member(ctx, epoch)
    }

    /// F56 — a foundation Council seat vouches a child into its federation
    /// (the consent `parent` alone cannot give).
    pub fn approve_federation_child(ctx: Context<ApproveFederationChild>) -> Result<()> {
        instructions::approve_federation_child(ctx)
    }

    /// F56 — publish an APPROVED child's member root under its foundation
    /// (permissionless crank once approved).
    pub fn publish_member_root(ctx: Context<PublishMemberRoot>) -> Result<()> {
        instructions::publish_member_root(ctx)
    }

    /// F56 — verify a visiting member of a sibling Circle against its anchored
    /// root; mints an anonymous VisitPass.
    pub fn verify_fellow_member(
        ctx: Context<VerifyFellowMember>,
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::verify_fellow_member(ctx, nullifier, proof_a, proof_b, proof_c)
    }

    /// Provisional admission on the parrain's attestation: membership exists
    /// (page live, faucet usable) but the commitment is NOT in the member tree,
    /// so every members-only proof fails by construction.
    pub fn issue_provisional_membership(
        ctx: Context<IssueProvisionalMembership>,
        commitment: [u8; 32],
        owner: Pubkey,
        recovery_keys: [Pubkey; crate::state::Membership::MAX_GUARDIANS],
        require_cosign: bool,
    ) -> Result<()> {
        instructions::issue_provisional_membership(ctx, commitment, owner, recovery_keys, require_cosign)
    }

    /// Attestation B: a trusted servant (distinct person from the parrain)
    /// co-attests — the commitment enters the votable set and the provisional
    /// marker closes. Admission complete.
    pub fn confirm_admission(ctx: Context<ConfirmAdmission>, epoch: u64) -> Result<()> {
        instructions::confirm_admission(ctx, epoch)
    }

    /// Renew (extend) a membership for another term on donation.
    pub fn renew_membership(ctx: Context<RenewMembership>) -> Result<()> {
        instructions::renew_membership(ctx)
    }

    /// Revoke (delete) a membership — Scribe-Secretary seat; closes the account.
    pub fn revoke_membership(ctx: Context<RevokeMembership>) -> Result<()> {
        instructions::revoke_membership(ctx)
    }

    // --- Treasury (self-supporting) & soulbound token (see docs/treasury.md) ---

    /// Donate SOL to a Circle's treasury (anyone may contribute).
    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        instructions::donate(ctx, amount)
    }

    /// Donate any SPL / Token-2022 token to a Circle's treasury (anyone, any
    /// amount). For the foundation, pass the foundation Circle — see the
    /// `fundFoundation` client helper.
    pub fn donate_token(ctx: Context<DonateToken>, amount: u64) -> Result<()> {
        instructions::donate_token(ctx, amount)
    }

    /// Move treasury SOL, authorized by an executed 4-of-7 WithdrawTreasury proposal.
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>) -> Result<()> {
        instructions::withdraw_treasury(ctx)
    }

    /// Move an SPL / Token-2022 treasury balance, authorized by an executed 4-of-7
    /// `WithdrawTreasuryToken` proposal. Without this, `donate_token` deposits were
    /// unrecoverable (no treasury-PDA signing path for tokens).
    pub fn withdraw_treasury_token(ctx: Context<WithdrawTreasuryToken>) -> Result<()> {
        instructions::withdraw_treasury_token(ctx)
    }

    /// Write the Circle's treasury steward wallet, authorized by an executed
    /// 4-of-7 `SetTreasuryWallet` proposal.
    pub fn set_treasury_wallet(ctx: Context<SetTreasuryWallet>) -> Result<()> {
        instructions::set_treasury_wallet(ctx)
    }

    /// Publish/replace a Circle's meeting calendar (recurring + sessions JSON).
    pub fn set_meetings(ctx: Context<SetMeetings>, data: String) -> Result<()> {
        instructions::set_meetings(ctx, data)
    }

    // --- The gas faucet: first gas for the neophyte (Trust Platform Epic 0) ---

    /// Create the Circle's faucet jar (any Council seat; default grant amount).
    pub fn init_faucet(ctx: Context<InitFaucet>) -> Result<()> {
        instructions::init_faucet(ctx)
    }

    /// Treasurer tunes the per-grant amount, within the absolute on-chain cap.
    pub fn set_faucet_amount(ctx: Context<SetFaucetAmount>, lamports: u64) -> Result<()> {
        instructions::set_faucet_amount(ctx, lamports)
    }

    /// DEPRECATED (F35 → Epic 2) — prefer `activate_faucet_zk`. The named pilot
    /// form: the neophyte's parrain (their WingPeer) signs the one-time gas
    /// grant, which publishes the sponsor edge (their wallet, their commitment,
    /// and the claim binding them to the neophyte). Kept only for a parrain
    /// whose device holds no ZK voting key; the client must prefer the
    /// anonymous path. One grant per identity commitment, ever, by nullifier.
    pub fn activate_faucet(ctx: Context<ActivateFaucet>) -> Result<()> {
        instructions::activate_faucet(ctx)
    }

    /// First gas for the neophyte, anonymously endorsed (F35 → Epic 2): a
    /// Groth16 proof that SOME member of the Circle's member tree endorses this
    /// grant — no parrain account, commitment or wallet in the transaction.
    /// Reuses the member_vote circuit + ceremony key, like `attest_admission_zk`;
    /// same jar economics and same one-shot `faucetnull` guard as the named form.
    pub fn activate_faucet_zk(
        ctx: Context<ActivateFaucetZk>,
        root: [u8; 32],
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::activate_faucet_zk(ctx, root, nullifier, proof_a, proof_b, proof_c)
    }

    /// Move treasury funds into the jar under a passed anonymous member vote
    /// whose description_hash commits to exactly (circle, amount). One-shot.
    pub fn refill_faucet(ctx: Context<RefillFaucet>, amount: u64) -> Result<()> {
        instructions::refill_faucet(ctx, amount)
    }

    /// The sponsor ties a quipu cord for a completed step (Epic 3): one cord per
    /// (member, step), step 1..=12, colour derived off-chain from the step.
    pub fn tie_quipu_cord(ctx: Context<TieQuipuCord>, step: u8) -> Result<()> {
        instructions::tie_quipu_cord(ctx, step)
    }

    /// A member sets their per-element visibility (Epic 5): avatar/quipu/bio each
    /// to tier 0 (chosen) / 1 (my circle) / 2 (all members). Default is my circle.
    pub fn set_visibility(ctx: Context<SetVisibility>, avatar: u8, quipu: u8, bio: u8) -> Result<()> {
        instructions::set_visibility(ctx, avatar, quipu, bio)
    }

    /// Shield a membership's ownership (F61): bind a private `OwnerTag` the
    /// member finds themselves by, and rebind `owner` off the public wallet in
    /// the same transaction, so `Membership.owner` stops being a memcmp index
    /// into the roster.
    pub fn shield_membership(
        ctx: Context<ShieldMembership>,
        tag: [u8; 32],
        shielded_owner: Pubkey,
    ) -> Result<()> {
        instructions::shield_membership(ctx, tag, shielded_owner)
    }

    /// Write the member's ENCRYPTED profile object (F60 Phase-2): a fixed-length
    /// sealed bio and a pointer to the sealed avatar. The program stores bytes it
    /// cannot read; `epoch` re-keys and silently expires every outstanding drop.
    pub fn upsert_member_profile(
        ctx: Context<UpsertMemberProfile>,
        enc_pub: [u8; 32],
        epoch: u16,
        bio_ct: [u8; crate::state::MemberProfile::BIO_CT],
        avatar_ref: [u8; crate::state::MemberProfile::AVATAR_REF],
    ) -> Result<()> {
        instructions::upsert_member_profile(ctx, enc_pub, epoch, bio_ct, avatar_ref)
    }

    /// Drop a sealed element key at an address only the member and one viewer can
    /// compute (F60 Phase-2). The account names neither of them.
    pub fn grant_visibility_key(
        ctx: Context<GrantVisibilityKey>,
        drop_id: [u8; 32],
        sealed: [u8; crate::state::VisibilityKeyDrop::SEALED],
        epoch: u16,
    ) -> Result<()> {
        instructions::grant_visibility_key(ctx, drop_id, sealed, epoch)
    }

    // --- Member posts / bulletins (F30) ---

    /// A member publishes a time-boxed post (text and/or IPFS image).
    pub fn create_post(
        ctx: Context<CreatePost>,
        nonce: u64,
        text: String,
        image_cid: String,
        start_date: i64,
        end_date: i64,
    ) -> Result<()> {
        instructions::create_post(ctx, nonce, text, image_cid, start_date, end_date)
    }

    /// Any of the 7 Council seats deletes a post (moderation by group conscience).
    pub fn delete_post(ctx: Context<DeletePost>) -> Result<()> {
        instructions::delete_post(ctx)
    }

    /// Register the Circle's Token-2022 NonTransferable (soulbound) membership mint.
    pub fn set_membership_mint(ctx: Context<SetMembershipMint>, mint: Pubkey) -> Result<()> {
        instructions::set_membership_mint(ctx, mint)
    }

    /// Create the Circle's soulbound Token-2022 NonTransferable membership mint
    /// (authority = Circle PDA) and register it — no external setup step (F3).
    pub fn create_membership_mint(ctx: Context<CreateMembershipMint>) -> Result<()> {
        instructions::create_membership_mint(ctx)
    }

    /// Create/update a Circle's public directory profile (geo + IPFS doc CIDs)
    /// that powers "Find a Circle Near You". Any Council seat may set it.
    pub fn upsert_circle_profile(
        ctx: Context<UpsertCircleProfile>,
        lat_microdeg: i32,
        lon_microdeg: i32,
        name: String,
        city: String,
        address: String,
        twelve_steps_cid: String,
        preamble_cid: String,
        daily_reflections_cid: String,
    ) -> Result<()> {
        instructions::upsert_circle_profile(
            ctx,
            lat_microdeg,
            lon_microdeg,
            name,
            city,
            address,
            twelve_steps_cid,
            preamble_cid,
            daily_reflections_cid,
        )
    }

    /// Update only a Circle's location (coordinates + city + address) on its
    /// existing directory profile — name & doc CIDs untouched. Overwrite only,
    /// no location history kept. Any Council seat may move the Circle.
    pub fn update_circle_location(
        ctx: Context<UpdateCircleLocation>,
        lat_microdeg: i32,
        lon_microdeg: i32,
        city: String,
        address: String,
    ) -> Result<()> {
        instructions::update_circle_location(ctx, lat_microdeg, lon_microdeg, city, address)
    }

    /// Delist a Circle from the public directory by closing its `CircleProfile`
    /// (the Circle itself is untouched). Any Council seat may do it; rent is
    /// refunded to that seat.
    pub fn close_circle_profile(ctx: Context<CloseCircleProfile>) -> Result<()> {
        instructions::close_circle_profile(ctx)
    }

    /// Mint one soulbound membership token to a member's Token-2022 account.
    pub fn mint_membership_token(ctx: Context<MintMembershipToken>) -> Result<()> {
        instructions::mint_membership_token(ctx)
    }

    // --- Member voting: anonymous one-member-one-vote (see docs/member-voting.md) ---

    /// Create the Circle's member-set tree (votable population). Run once.
    pub fn initialize_member_tree(ctx: Context<InitializeMemberTree>, depth: u8) -> Result<()> {
        instructions::initialize_member_tree(ctx, depth)
    }

    /// A Council seat opens a group-conscience proposal for the membership.
    pub fn create_member_proposal(
        ctx: Context<CreateMemberProposal>,
        nonce: u64,
        description_hash: [u8; 32],
        voting_period: i64,
    ) -> Result<()> {
        instructions::create_member_proposal(ctx, nonce, description_hash, voting_period)
    }

    /// Cast one anonymous ballot (ZK member-set inclusion + per-proposal nullifier).
    pub fn cast_vote(
        ctx: Context<CastVote>,
        choice: bool,
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::cast_vote(ctx, choice, nullifier, proof_a, proof_b, proof_c)
    }

    /// Close voting and record the group conscience (quorum + majority).
    pub fn finalize_member_proposal(ctx: Context<FinalizeMemberProposal>) -> Result<()> {
        instructions::finalize_member_proposal(ctx)
    }

    /// Set the Circle's membership-admission policy: `open = true` makes joining
    /// permissionless (anyone self-admits); `open = false` restores Scribe-Secretary
    /// validation. Any Council seat may toggle it. Uses a separate marker PDA, so
    /// the `Circle` account (and every existing Circle) is untouched.
    pub fn set_open_membership(ctx: Context<SetOpenMembership>, open: bool) -> Result<()> {
        instructions::set_open_membership(ctx, open)
    }

    /// Set a Circle's country (ISO-3166-1 alpha-2 code, e.g. "FR") for the
    /// foundation directory's continent → country grouping. Any Council seat may
    /// set it; a separate PDA, so existing Circles need no migration.
    /// PDA: ["country", circle].
    pub fn set_circle_country(ctx: Context<SetCircleCountry>, code: String) -> Result<()> {
        instructions::set_circle_country(ctx, code)
    }

    /// A member designates (or changes) their WingPeer (mentor). Caller controls
    /// the mentee membership; the wing must be a real member of the Circle.
    pub fn establish_wing_peer(ctx: Context<EstablishWingPeer>) -> Result<()> {
        instructions::establish_wing_peer(ctx)
    }

    /// End a WingPeer relationship (either party). Sets active = false.
    pub fn end_wing_peer(ctx: Context<EndWingPeer>) -> Result<()> {
        instructions::end_wing_peer(ctx)
    }

    /// A Council seat awards a member a progress token (milestone chip).
    pub fn issue_progress_token(ctx: Context<IssueProgressToken>, milestone: u32) -> Result<()> {
        instructions::issue_progress_token(ctx, milestone)
    }

    /// Bind a member proposal to a seat election (F28). The proposal's
    /// description_hash must equal H("AHA-elect" || seat_index || candidate).
    pub fn link_seat_election(ctx: Context<LinkSeatElection>, seat_index: u8, candidate: Pubkey) -> Result<()> {
        instructions::link_seat_election(ctx, seat_index, candidate)
    }

    /// Install the winner of a passed seat election into the Council (F28).
    pub fn install_elected_seat(ctx: Context<InstallElectedSeat>) -> Result<()> {
        instructions::install_elected_seat(ctx)
    }

    /// Open a MACI (coercion-resistant) round over a member proposal, registering
    /// the coordinator's encryption key. Any seat. See docs/maci.md.
    pub fn open_maci_round(ctx: Context<OpenMaciRound>, coordinator: [u8; 32], challenge_secs: i64) -> Result<()> {
        instructions::open_maci_round(ctx, coordinator, challenge_secs)
    }

    /// Publish an encrypted MACI command (vote or key-change) to an open round.
    pub fn publish_maci_message(ctx: Context<PublishMaciMessage>, eph_pubkey: [u8; 32], ciphertext: Vec<u8>) -> Result<()> {
        instructions::publish_maci_message(ctx, eph_pubkey, ciphertext)
    }

    /// F39 step 1 of MACI sign-up: publish the commit–reveal binding hash.
    pub fn maci_signup_commit(ctx: Context<MaciSignupCommitIx>, commitment: [u8; 32]) -> Result<()> {
        instructions::maci_signup_commit(ctx, commitment)
    }

    /// F39 step 2 of MACI sign-up: prove membership (ZK) and register one MACI
    /// voting key for this round.
    pub fn maci_signup(
        ctx: Context<MaciSignupIx>,
        maci_pubkey: [u8; 32],
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::maci_signup(ctx, maci_pubkey, nullifier, proof_a, proof_b, proof_c)
    }

    /// F39 freeze a MACI round at its deadline (permissionless).
    pub fn close_maci_round(ctx: Context<CloseMaciRound>) -> Result<()> {
        instructions::close_maci_round(ctx)
    }

    /// F39 fold the next `count` sealed commands into the round's message chain
    /// (permissionless crank; messages go in `remaining_accounts`, ascending).
    pub fn process_maci_messages(ctx: Context<ProcessMaciMessages>, count: u32) -> Result<()> {
        instructions::process_maci_messages(ctx, count)
    }

    /// F39 the coordinator commits the tally over the fully folded queue.
    pub fn commit_maci_tally(ctx: Context<CommitMaciTally>, yes: u64, no: u64, plaintext_digest: [u8; 32]) -> Result<()> {
        instructions::commit_maci_tally(ctx, yes, no, plaintext_digest)
    }

    /// F39 write the MACI outcome onto the member proposal after the dispute
    /// window (same quorum/pass math as `finalize_member_proposal`).
    pub fn finalize_maci_round(ctx: Context<FinalizeMaciRound>) -> Result<()> {
        instructions::finalize_maci_round(ctx)
    }

    /// Add/remove a treasury withdrawal recipient on a Circle's spend allowlist
    /// (any seat). Enforced by `withdraw_treasury` when the allowlist is on.
    pub fn set_treasury_allow(
        ctx: Context<SetTreasuryAllow>,
        recipient: Pubkey,
        allowed: bool,
    ) -> Result<()> {
        instructions::set_treasury_allow(ctx, recipient, allowed)
    }

    /// Set a Circle's tunable policy (donation-on-renew, member-vote
    /// quorum/pass thresholds, treasury allowlist). Any seat; PDA ["config", circle].
    pub fn set_circle_config(
        ctx: Context<SetCircleConfig>,
        renew_donation_lamports: u64,
        vote_quorum_num: u16,
        vote_quorum_den: u16,
        vote_pass_num: u16,
        vote_pass_den: u16,
        treasury_allowlist: bool,
    ) -> Result<()> {
        instructions::set_circle_config(
            ctx,
            renew_donation_lamports,
            vote_quorum_num,
            vote_quorum_den,
            vote_pass_num,
            vote_pass_den,
            treasury_allowlist,
        )
    }

    // --- Sybil resistance: anonymous proof-of-personhood (see docs/sybil.md) ---

    /// Configure the Circle's sybil gate (on/off + the unique-human Merkle root).
    pub fn set_personhood(
        ctx: Context<SetPersonhood>,
        require_personhood: bool,
        personhood_root: [u8; 32],
    ) -> Result<()> {
        instructions::set_personhood(ctx, require_personhood, personhood_root)
    }

    /// Mint a one-per-human PersonhoodCredential from an anonymous proof.
    pub fn prove_personhood(
        ctx: Context<ProvePersonhood>,
        nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::prove_personhood(ctx, nullifier, proof_a, proof_b, proof_c)
    }

    // --- The Council is the authority: 4-of-7 proposals (see docs/resilience.md) ---

    /// A Council seat opens a proposal (RotateSeat / MigrateWallet / WithdrawTreasury).
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

    // --- Foundation-led child-Circle seat rotation (the parent helps a child) ---

    /// A foundation seat opens a 4-of-7 vote to rotate a child Circle's 7 seats,
    /// valid for `validity_secs` (1–90 days).
    pub fn propose_child_rotation(
        ctx: Context<ProposeChildRotation>,
        nonce: u64,
        new_seats: [Pubkey; crate::council::COUNCIL_SEATS],
        validity_secs: i64,
    ) -> Result<()> {
        instructions::propose_child_rotation(ctx, nonce, new_seats, validity_secs)
    }

    /// Another foundation seat approves a pending child-rotation vote.
    pub fn approve_child_rotation(ctx: Context<ApproveChildRotation>) -> Result<()> {
        instructions::approve_child_rotation(ctx)
    }

    /// Apply a passed child-rotation vote into the child Circle's Council.
    pub fn execute_child_rotation(ctx: Context<ExecuteChildRotation>) -> Result<()> {
        instructions::execute_child_rotation(ctx)
    }

    /// A foundation seat opens a 4-of-7 vote to DELETE a federation Circle.
    pub fn propose_child_close(ctx: Context<ProposeChildClose>, nonce: u64, validity_secs: i64) -> Result<()> {
        instructions::propose_child_close(ctx, nonce, validity_secs)
    }

    /// Another foundation seat approves a pending delete-Circle vote.
    pub fn approve_child_close(ctx: Context<ApproveChildClose>) -> Result<()> {
        instructions::approve_child_close(ctx)
    }

    /// Apply a passed delete-Circle vote: close the child (and its profile).
    pub fn execute_child_close(ctx: Context<ExecuteChildClose>) -> Result<()> {
        instructions::execute_child_close(ctx)
    }

    // --- Encrypted 1:1 messaging (F32) ---

    /// Publish the caller's x25519 messaging public key.
    pub fn register_messaging_key(ctx: Context<RegisterMessagingKey>, box_pubkey: [u8; 32]) -> Result<()> {
        instructions::register_messaging_key(ctx, box_pubkey)
    }

    /// Store an end-to-end encrypted, sealed-sender message to any wallet.
    pub fn send_message(
        ctx: Context<SendMessage>,
        id: u64,
        recipient: Pubkey,
        eph_pubkey: [u8; 32],
        nonce: [u8; 24],
        expires_at: i64,
        ciphertext: Vec<u8>,
    ) -> Result<()> {
        instructions::send_message(ctx, id, recipient, eph_pubkey, nonce, expires_at, ciphertext)
    }

    /// Delete a message (sender/recipient anytime; anyone once expired).
    pub fn delete_message(ctx: Context<DeleteMessage>) -> Result<()> {
        instructions::delete_message(ctx)
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
        requirements_hash: [u8; 32],
        public_inputs: [[u8; 32]; instructions::verify_disclosure::ACK_DISCLOSE_PUBLIC_INPUTS],
        requirements: DisclosureGate,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::verify_disclosure(
            ctx,
            gate,
            requirements_hash,
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
