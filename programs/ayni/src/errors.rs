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
}
