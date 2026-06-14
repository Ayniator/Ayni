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
/// Default contest window before a wallet migration may execute (7 days).
pub const DEFAULT_RECOVERY_TIMELOCK: i64 = 7 * 24 * 60 * 60;

/// Named seats. The Council IS the authority — there is no separate admin key.
/// 3 functional servants + 4 elders of the four directions (medicine wheel).
pub const SEAT_TREASURER: usize = 0;
pub const SEAT_SECRETARY: usize = 1;
pub const SEAT_RHYTHM_KEEPER: usize = 2;
pub const SEAT_ELDER_NORTH: usize = 3;
pub const SEAT_ELDER_EAST: usize = 4;
pub const SEAT_ELDER_SOUTH: usize = 5;
pub const SEAT_ELDER_WEST: usize = 6;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Council {
    pub seats: [Pubkey; COUNCIL_SEATS],
    pub threshold: u8,
    /// Seconds a `MigrateWallet` must wait after reaching threshold before it
    /// can execute — the contest window during which any seat may cancel it.
    pub recovery_timelock: i64,
}

impl Council {
    pub const SPACE: usize = 32 * COUNCIL_SEATS + 1 + 8;

    pub fn empty() -> Self {
        Council {
            seats: [Pubkey::default(); COUNCIL_SEATS],
            threshold: DEFAULT_THRESHOLD,
            recovery_timelock: DEFAULT_RECOVERY_TIMELOCK,
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

    /// Require `who` to hold *some* seat (any of the 7 may act).
    pub fn require_any_seat(&self, who: &Pubkey) -> Result<()> {
        require!(self.seat_of(who).is_some(), AyniError::NotCouncilSeat);
        Ok(())
    }

    /// Require `who` to hold the *specific* seat at `index` (e.g. the Secretary
    /// admits members; the Treasurer stewards the mint).
    pub fn require_seat(&self, who: &Pubkey, index: usize) -> Result<()> {
        require!(
            self.seats[index] != Pubkey::default() && &self.seats[index] == who,
            AyniError::Unauthorized
        );
        Ok(())
    }

    /// True if `who` already holds a seat other than `except`. Used to keep
    /// seats one-holder-each, so no wallet can occupy several seats (which would
    /// shrink the effective Council and could enable double approval across a
    /// rotation). `default()` (vacant) never collides.
    pub fn occupied_elsewhere(&self, who: &Pubkey, except: usize) -> bool {
        if who == &Pubkey::default() {
            return false;
        }
        self.seats
            .iter()
            .enumerate()
            .any(|(i, s)| i != except && s == who)
    }
}

/// What a 4-of-7 vote authorizes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalAction {
    /// Replace the wallet occupying a Council seat.
    RotateSeat { seat_index: u8, new_holder: Pubkey },
    /// Definitively migrate every artifact from `old_wallet` to `new_wallet`.
    MigrateWallet { old_wallet: Pubkey, new_wallet: Pubkey },
    /// Spend from the Circle treasury — group conscience over funds (Tradition 7).
    /// High-stakes ⇒ time-locked + contestable, then drawn by `withdraw_treasury`.
    WithdrawTreasury { amount: u64, recipient: Pubkey },
    /// Designate/rotate the Circle's treasury steward wallet (the governed payout
    /// destination shown in the directory/console). High-stakes ⇒ time-locked +
    /// contestable, then written by `set_treasury_wallet` into `TreasuryConfig`.
    SetTreasuryWallet { new_wallet: Pubkey },
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
    pub cancelled: bool,
    /// For `WithdrawTreasury`: set true once the lamports have actually moved, so
    /// an executed proposal cannot be replayed to drain the treasury repeatedly.
    pub drained: bool,
    pub created_at: i64,
    /// Earliest unix time the proposal may execute; 0 = not yet armed (threshold
    /// unmet). Set when approvals first reach threshold: `now` for RotateSeat,
    /// `now + recovery_timelock` for MigrateWallet.
    pub eligible_at: i64,
    pub bump: u8,
}

impl Proposal {
    pub const SPACE: usize =
        8 + 32 + 8 + ProposalAction::MAX_SIZE + 1 + 1 + 1 + 1 + 8 + 8 + 1;

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

    /// Once approvals reach `threshold`, set `eligible_at`. EVERY action waits out
    /// the contest window, so any single honest seat can `cancel_proposal` before
    /// it executes. Idempotent (only arms once).
    ///
    /// Seat rotation is time-locked too (was instant): otherwise a 4-of-7 majority
    /// could instantly rotate out the honest minority and *then* run a migration
    /// or withdrawal with no seat left to contest it (the "purge-before-migrate"
    /// escalation). With a uniform contest window the honest seats are still
    /// present to cancel a hostile rotation.
    pub fn arm_if_ready(&mut self, threshold: u8, recovery_timelock: i64, now: i64) {
        if self.eligible_at == 0 && self.approval_count() >= threshold {
            // Uniform contest window for all high-stakes actions.
            self.eligible_at = now.saturating_add(recovery_timelock).max(1);
        }
    }
}
