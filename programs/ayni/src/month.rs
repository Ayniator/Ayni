//! Calendar months, for F59 presence attestation.
//!
//! WHY A MONTH AND NOT A TIMESTAMP. `docs/presence.md` promises that a presence
//! record says "March 2026" and nothing finer. A stored `i64` would be a
//! written-at time — a finer-grained record than the design promises, and one
//! that a public meeting calendar could resolve to a single evening. So the
//! coarsening happens HERE, on chain, from `Clock`, and the fine value is never
//! written anywhere. A client cannot supply the month it likes: it supplies an
//! index, and the program checks that index against its own clock.
//!
//! UTC, deliberately. There is no per-Circle timezone and there must not be
//! one: a timezone attached to a presence record is a coarse location, and
//! location plus month is exactly the join `docs/presence.md` §4.3 warns about.
//! The cost is that a meeting late on the last evening of a month may fall in
//! the next month's index for members west of UTC. That is acceptable — the
//! attestation is a vouch for a month, not a receipt for an evening, and the
//! closed-month rule below means nobody is attesting near a boundary anyway.

use anchor_lang::prelude::*;

use crate::errors::AyniError;

/// Months elapsed since 1970-01. January 1970 is 0, so the index is small and
/// monotone, and `u32` covers to the year 350 million.
pub type MonthIndex = u32;

/// Civil date from a Unix day number — Howard Hinnant's `civil_from_days`,
/// which is exact for the proleptic Gregorian calendar over the whole `i64`
/// range we care about. Used rather than a leap-year loop because a loop over
/// years is both slower and easier to get wrong by one at the boundaries.
///
/// Returns `(year, month)` only; the day is deliberately discarded here — this
/// module has no business knowing it, and not computing it is one less value
/// that could leak into a log line.
fn year_month_from_days(z: i64) -> (i64, u32) {
    // Shift the era so the leap-day irregularity lands at the end of the cycle.
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], March-based
    // March-based month back to January-based.
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32)
}

/// The month index containing `unix_timestamp`.
///
/// Rejects pre-epoch timestamps rather than wrapping into a huge `u32`: a
/// negative clock is a broken validator, not a member in 1969, and silently
/// producing a plausible index for it would write a nonsense month that the
/// strictly-advancing rule then locks in forever.
pub fn month_of(unix_timestamp: i64) -> Result<MonthIndex> {
    require!(unix_timestamp >= 0, AyniError::ClockUnavailable);
    // Floor division: seconds -> days, both non-negative here.
    let days = unix_timestamp / 86_400;
    let (y, m) = year_month_from_days(days);
    require!(y >= 1970, AyniError::ClockUnavailable);
    let idx = (y - 1970)
        .checked_mul(12)
        .and_then(|v| v.checked_add(m as i64 - 1))
        .ok_or(error!(AyniError::ClockUnavailable))?;
    u32::try_from(idx).map_err(|_| error!(AyniError::ClockUnavailable))
}

/// The current month, from the on-chain clock.
pub fn current_month() -> Result<MonthIndex> {
    month_of(Clock::get()?.unix_timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_is_month_zero() {
        assert_eq!(month_of(0).unwrap(), 0); // 1970-01-01
        assert_eq!(month_of(86_399).unwrap(), 0); // last second of that day
    }

    #[test]
    fn known_dates_map_to_known_indices() {
        // 1970-02-01T00:00:00Z
        assert_eq!(month_of(31 * 86_400).unwrap(), 1);
        // 2026-03-01T00:00:00Z = 1772323200 -> (2026-1970)*12 + 2
        assert_eq!(month_of(1_772_323_200).unwrap(), 56 * 12 + 2);
        // The month boundary, to the second. Both constants were wrong by
        // exactly one day when first written, and only the SECOND of them
        // failed: the first still landed inside March, so it passed while
        // asserting something weaker than its own comment claimed. Verified
        // against an independent calendar rather than re-derived from the code
        // under test.
        //
        // 2026-03-31T23:59:59Z is still March.
        assert_eq!(month_of(1_775_001_599).unwrap(), 56 * 12 + 2);
        // 2026-04-01T00:00:00Z rolls over.
        assert_eq!(month_of(1_775_001_600).unwrap(), 56 * 12 + 3);
    }

    #[test]
    fn leap_day_is_february() {
        // 2024-02-29T12:00:00Z = 1709208000
        assert_eq!(month_of(1_709_208_000).unwrap(), 54 * 12 + 1);
        // 2024-03-01T00:00:00Z = 1709251200
        assert_eq!(month_of(1_709_251_200).unwrap(), 54 * 12 + 2);
    }

    #[test]
    fn century_non_leap_year_is_handled() {
        // 1900 was NOT a leap year, 2000 WAS — the classic off-by-one. We only
        // range over >=1970, but the era arithmetic must still be right across
        // the 2000 boundary.
        // 2000-02-29T00:00:00Z = 951782400
        assert_eq!(month_of(951_782_400).unwrap(), 30 * 12 + 1);
        // 2000-03-01T00:00:00Z = 951868800
        assert_eq!(month_of(951_868_800).unwrap(), 30 * 12 + 2);
    }

    #[test]
    fn months_are_strictly_monotone_across_a_long_run() {
        // Walk day by day for ~40 years and assert the index never goes
        // backwards and never jumps by more than one. This is what actually
        // protects the strictly-advancing write rule.
        let mut prev = month_of(0).unwrap();
        let mut d: i64 = 0;
        while d < 365 * 40 {
            let m = month_of(d * 86_400).unwrap();
            assert!(m == prev || m == prev + 1, "day {d}: {prev} -> {m}");
            prev = m;
            d += 1;
        }
    }

    #[test]
    fn negative_clock_is_rejected_not_wrapped() {
        assert!(month_of(-1).is_err());
        assert!(month_of(i64::MIN).is_err());
    }
}
