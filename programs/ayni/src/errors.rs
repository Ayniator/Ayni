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
}
