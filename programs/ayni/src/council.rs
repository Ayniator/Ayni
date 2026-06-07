//! Resilience: the 7-seat Council and its 4-of-7 proposals.
//!
//! Each Circle (and the World Service Circle) is governed by a Council of 7
//! seats with a threshold of 4. The Council rotates its own seats and recovers
//! lost keys by definitively migrating every artifact from one wallet to
//! another. See docs/resilience.md and PROJECT.md §6.

use anchor_lang::prelude::*;

use crate::errors::AyniError;

pub const COUNCIL_SEATS: usize = 7;
pub const DEFAULT_THRESHOLD: u8 = 4;

/// Named functional seats; seats 3..=6 are elders (quorum / resilience only).
pub const SEAT_TREASURER: usize = 0;
pub const SEAT_SECRETARY: usize = 1;
pub const SEAT_RHYTHM_KEEPER: usize = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Council {
    pub seats: [Pubkey; COUNCIL_SEATS],
    pub threshold: u8,
}

impl Council {
    pub const SPACE: usize = 32 * COUNCIL_SEATS + 1;

    pub fn empty() -> Self {
        Council {
            seats: [Pubkey::default(); COUNCIL_SEATS],
            threshold: DEFAULT_THRESHOLD,
        }
    }

    /// Index of the seat held by `who`, if any (ignoring empty seats).
    pub fn seat_of(&self, who: &Pubkey) -> Option<usize> {
        if who == &Pubkey::default() {
            return None;
        }
        self.seats.iter().position(|s| s == who)
    }

    pub fn occupied(&self) -> u8 {
        self.seats.iter().filter(|s| *s != &Pubkey::default()).count() as u8
    }
}

/// What a 4-of-7 vote authorizes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalAction {
    /// Replace the wallet occupying a Council seat.
    RotateSeat { seat_index: u8, new_holder: Pubkey },
    /// Definitively migrate every artifact from `old_wallet` to `new_wallet`.
    MigrateWallet { old_wallet: Pubkey, new_wallet: Pubkey },
}

impl ProposalAction {
    /// borsh: 1-byte enum tag + largest variant (two pubkeys).
    pub const MAX_SIZE: usize = 1 + 32 + 32;
}

/// A pending Council decision. Approvals are a bitmask over the 7 seats, so a
/// seat can approve only once and a tally is `count_ones()`.
#[account]
pub struct Proposal {
    pub circle: Pubkey,
    pub nonce: u64,
    pub action: ProposalAction,
    pub approvals: u8,
    pub executed: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl Proposal {
    pub const SPACE: usize =
        8 + 32 + 8 + ProposalAction::MAX_SIZE + 1 + 1 + 8 + 1;

    pub fn approval_count(&self) -> u8 {
        self.approvals.count_ones() as u8
    }

    /// Record an approval from the seat at `index`; error if it already voted.
    pub fn add_approval(&mut self, index: usize) -> Result<()> {
        let bit = 1u8 << index;
        require!(self.approvals & bit == 0, AyniError::AlreadyApproved);
        self.approvals |= bit;
        Ok(())
    }
}
