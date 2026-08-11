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
    #[msg("Voting period must be between 1 and 90 days")]
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
}
