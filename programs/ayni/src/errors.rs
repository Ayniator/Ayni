use anchor_lang::prelude::*;

#[error_code]
pub enum AyniError {
    #[msg("Circle name exceeds maximum length")]
    NameTooLong,
    #[msg("Membership has expired")]
    MembershipExpired,
    #[msg("Caller is not the circle authority")]
    Unauthorized,
    #[msg("Invalid lineage / level-grant proof")]
    InvalidLineageProof,
    #[msg("New level must be greater than the current level")]
    NonIncreasingLevel,
    #[msg("Poseidon hashing failed")]
    PoseidonError,
    #[msg("Lineage Merkle tree is full")]
    LineageFull,
    #[msg("Requested depth exceeds MAX_DEPTH")]
    DepthTooLarge,
    #[msg("Signer does not hold a Council seat")]
    NotCouncilSeat,
    #[msg("This Council seat has already approved")]
    AlreadyApproved,
    #[msg("Proposal has already been executed")]
    AlreadyExecuted,
    #[msg("Proposal has not reached the 4-of-7 threshold")]
    ThresholdNotMet,
    #[msg("Proposal action does not match this operation")]
    WrongProposalAction,
    #[msg("Artifact is not owned by the wallet being migrated")]
    WalletMismatch,
    #[msg("Council seat index out of range")]
    InvalidSeatIndex,
    #[msg("Migration time-lock has not elapsed yet")]
    TimelockNotElapsed,
    #[msg("Recovery time-lock must not be negative")]
    InvalidTimelock,
    #[msg("Proposal has been cancelled")]
    ProposalCancelled,
    #[msg("This membership requires the member's co-signature to migrate")]
    MemberCosignRequired,
    #[msg("Invalid acknowledgment disclosure proof")]
    DisclosureProofInvalid,
    #[msg("Disclosure does not satisfy the gate's predicate requirements")]
    PredicateNotMet,
    #[msg("Invalid vote / personhood proof")]
    VoteProofInvalid,
    #[msg("Voting is closed for this proposal")]
    VotingClosed,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Proposal already finalized")]
    AlreadyFinalized,
    #[msg("Proof of personhood is required to join this Circle")]
    PersonhoodRequired,
    #[msg("That wallet already holds another Council seat")]
    DuplicateSeat,
    #[msg("Gate requirements hash does not match the supplied requirements")]
    GateMismatch,
    #[msg("Circle profile field exceeds its maximum length")]
    ProfileFieldTooLong,
    #[msg("Geographic coordinate out of range")]
    InvalidCoordinate,
    /// Shared by the Council child-circle proposals (1–90 days) and, since the
    /// 2026-08-14 ballot-integrity fix, by member proposals (MIN_VOTING_PERIOD
    /// ..=MAX_VOTING_PERIOD, 3–30 days). The message no longer names a single
    /// range because the two are deliberately different: a member ballot must
    /// close while its electorate snapshot is still meaningful.
    #[msg("Voting period is outside the allowed range for this kind of proposal")]
    InvalidVotingPeriod,
    #[msg("Treasury steward wallet must be an initialized SPL multisig (m-of-n, m >= 2)")]
    TreasuryNotMultisig,
    #[msg("Failed to initialize the membership mint")]
    MintInitFailed,
    #[msg("Faucet grant amount exceeds the absolute on-chain cap")]
    FaucetCapExceeded,
    #[msg("Faucet jar has insufficient funds for the grant")]
    FaucetInsufficient,
    #[msg("Signer is not the neophyte's designated parrain (WingPeer)")]
    NotParrain,
    #[msg("Neophyte membership has no owner wallet to receive the grant")]
    NeophyteWalletUnset,
    #[msg("Faucet grant amount changed recently; grants resume after the cooldown")]
    FaucetAmountCooling,
    #[msg("Faucet refill exceeds the maximum a single vote may move")]
    FaucetRefillTooLarge,
    #[msg("This Circle admits by two-sponsor attestation — use the provisional admission flow")]
    TwoSponsorRequired,
    #[msg("Two-sponsor admission is not enabled for this Circle")]
    TwoSponsorNotEnabled,
    #[msg("A member cannot attest for their own admission")]
    SelfAttestation,
    #[msg("The trusted servant must be a different person than the parrain")]
    ParrainCannotConfirm,
    #[msg("Quipu step must be between 1 and 12")]
    InvalidStep,
    #[msg("Visibility tier must be 0 (chosen), 1 (my circle), or 2 (all members)")]
    InvalidVisibilityTier,
    #[msg("Proof root is not the current member root nor a recent one")]
    RootNotRecent,
    #[msg("Proof root does not match the published anchor root for that Circle")]
    AnchorMismatch,
    #[msg("Membership is not live (expired or still provisional)")]
    NotInGoodStanding,
    #[msg("MACI round is not in the required stage for this action")]
    MaciWrongStage,
    #[msg("MACI message account does not match the expected round/index/shape")]
    MaciMessageMismatch,
    #[msg("MACI batch is empty or exceeds the per-transaction maximum")]
    MaciBatchTooLarge,
    #[msg("MACI queue has not been fully processed yet")]
    MaciQueueIncomplete,
    #[msg("MACI tally claims more ballots than there are registered sign-ups")]
    MaciTallyExceedsSignups,
    #[msg("MACI sign-up commitment must be at least one slot old")]
    MaciCommitTooRecent,
    #[msg("MACI sign-up reveal does not match its commitment")]
    MaciSignupMismatch,
    #[msg("MACI challenge (dispute) window has not elapsed")]
    MaciChallengeWindow,
    #[msg("MACI rounds must be opened before any ballot is cast on the proposal")]
    MaciProposalAlreadyVoted,
    #[msg("Owner tag must not be zero")]
    InvalidOwnerTag,
    #[msg("Shielding must rebind owner away from the signing wallet")]
    OwnerNotShielded,
    #[msg("That would leave the membership with no key that can act for it")]
    MembershipWouldBeUnusable,
    #[msg("Profile encryption key must not be zero")]
    InvalidProfileKey,
    #[msg("Profile key epoch may only move forward")]
    EpochWentBackwards,
    #[msg("Key-drop id must not be zero")]
    InvalidKeyDrop,
    #[msg("First gas must be endorsed by the neophyte's own wing — prove against the wing's commitment")]
    EndorsementNotByWing,
    #[msg("MACI tallying is disabled: the chain cannot yet verify a tally, so its result must not decide seats or treasury")]
    MaciTallyUnverified,
    #[msg("A member epoch was rebuilt too recently: let the good-standing set re-enter before opening a ballot against it")]
    EpochNotSettled,
    #[msg("Too few members for a group conscience — grow the circle, or have a seat of the parent Circle co-sign the ballot")]
    ElectorateTooSmall,
    #[msg("Only a month that has already closed may be attested — the current month narrows a member to a window a meeting calendar can resolve")]
    MonthNotClosed,
    #[msg("A presence record only moves forward — this month is not later than the one already recorded")]
    MonthWentBackwards,
    #[msg("The subject and the witness must be two different people — the two proofs carry the same nullifier")]
    WitnessIsSubject,
    #[msg("The on-chain clock is unusable for calendar arithmetic")]
    ClockUnavailable,
}
