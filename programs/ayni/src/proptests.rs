//! F42 — property/fuzz tests over the PURE governance logic:
//!
//!   * Council vote accounting (`council::Proposal` bitmask approvals, arming,
//!     the execution guard, cancellation, timelock arithmetic),
//!   * member-vote quorum / pass-threshold math
//!     (`instructions::finalize_member_proposal::{quorum_threshold, vote_passes,
//!     member_vote_outcome}`),
//!   * the incremental Poseidon Merkle tree (`merkle`) and the
//!     `RecentRoots` 16-slot ring buffer,
//!   * nullifier PDA seed derivation (determinism + domain separation).
//!
//! Host-only (`#[cfg(test)]`): none of this is compiled into the SBF binary.
//! Case counts are capped so the whole suite stays in the 1–2 minute budget.

use std::collections::HashSet;

use anchor_lang::prelude::Pubkey;
use proptest::collection::vec as pvec;
use proptest::prelude::*;

use crate::council::{Proposal, ProposalAction, COUNCIL_SEATS};
use crate::instructions::finalize_member_proposal::{
    member_vote_outcome, quorum_threshold, vote_passes,
};
use crate::merkle::{self, poseidon2, MAX_DEPTH};
use crate::state::RecentRoots;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn new_proposal() -> Proposal {
    Proposal {
        circle: Pubkey::default(),
        nonce: 0,
        action: ProposalAction::RotateSeat { seat_index: 0, new_holder: Pubkey::default() },
        approvals: 0,
        executed: false,
        cancelled: false,
        drained: false,
        created_at: 0,
        eligible_at: 0,
        bump: 0,
    }
}

/// A 32-byte value guaranteed to be a valid BN254 field element (top 3 bits of
/// the big-endian encoding cleared, so the value is < p — same masking rule as
/// `merkle::field_from_pubkey`).
fn arb_field() -> impl Strategy<Value = [u8; 32]> {
    any::<[u8; 32]>().prop_map(|mut b| {
        b[0] &= 0x1f;
        b
    })
}

/// Roots for the ring-buffer test: drawn from a small alphabet so duplicates
/// (consecutive and non-consecutive) and the zero root actually occur.
fn arb_root() -> impl Strategy<Value = [u8; 32]> {
    prop_oneof![
        // small alphabet incl. zero → collisions + consecutive duplicates
        (0u8..12).prop_map(|i| {
            let mut b = [0u8; 32];
            b[31] = i;
            b
        }),
        any::<[u8; 32]>(),
    ]
}

/// Full-tree reference root: pad the leaf set with zero leaves to 2^depth and
/// fold pairwise — an independent implementation the incremental insert must
/// agree with.
fn reference_levels(depth: usize, leaves: &[[u8; 32]]) -> Vec<Vec<[u8; 32]>> {
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    level.resize(1usize << depth, [0u8; 32]);
    let mut all = vec![level];
    for _ in 0..depth {
        let prev = all.last().unwrap();
        let next: Vec<[u8; 32]> = prev
            .chunks(2)
            .map(|c| poseidon2(&c[0], &c[1]).unwrap())
            .collect();
        all.push(next);
    }
    all
}

fn reference_root(depth: usize, leaves: &[[u8; 32]]) -> [u8; 32] {
    reference_levels(depth, leaves)[depth][0]
}

/// Sibling path for the leaf at `index`.
fn reference_path(levels: &[Vec<[u8; 32]>], depth: usize, index: usize) -> Vec<[u8; 32]> {
    (0..depth).map(|l| levels[l][(index >> l) ^ 1]).collect()
}

/// Recompute the root from a leaf + its sibling path (what the circuit does).
fn verify_path(leaf: [u8; 32], index: usize, path: &[[u8; 32]]) -> [u8; 32] {
    let mut cur = leaf;
    let mut idx = index;
    for sib in path {
        cur = if idx & 1 == 0 {
            poseidon2(&cur, sib).unwrap()
        } else {
            poseidon2(sib, &cur).unwrap()
        };
        idx >>= 1;
    }
    cur
}

// ---------------------------------------------------------------------------
// 1. Council vote accounting
// ---------------------------------------------------------------------------

/// One step of a governance history, mirroring the `approve` /
/// `cancel_proposal` / `execute_proposal` handlers over the pure `Proposal`
/// methods. Each op advances the clock by `dt` seconds (time is monotone).
#[derive(Clone, Debug)]
enum Op {
    Approve { seat: usize, dt: u32 },
    Cancel { dt: u32 },
    Execute { dt: u32 },
}

fn arb_op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0..COUNCIL_SEATS, 0u32..1_000_000).prop_map(|(seat, dt)| Op::Approve { seat, dt }),
        (0u32..1_000_000).prop_map(|dt| Op::Cancel { dt }),
        (0u32..20_000_000).prop_map(|dt| Op::Execute { dt }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// For ARBITRARY sequences of approvals/cancellations/execution attempts
    /// across up to 7 seats:
    ///   * the approved-count never exceeds `COUNCIL_SEATS` and always equals
    ///     the number of DISTINCT seats that approved (no double-counting; a
    ///     repeat approval errors),
    ///   * `eligible_at` arms exactly when the count first reaches threshold,
    ///     and never changes afterwards (idempotent arming),
    ///   * `require_executable` succeeds ONLY with count ≥ threshold, armed,
    ///     past the timelock, not cancelled, not already executed,
    ///   * a cancellation at any point before execution (in particular before
    ///     the unlock) permanently blocks execution — cancel always wins.
    #[test]
    fn council_vote_accounting(
        ops in pvec(arb_op(), 0..48),
        threshold in 1u8..=COUNCIL_SEATS as u8,
        timelock in 0i64..=1_000_000_000,
        start in -1_000_000_000_000i64..=1_000_000_000_000,
    ) {
        let mut p = new_proposal();
        let mut approved: HashSet<usize> = HashSet::new();
        let mut cancelled = false;
        let mut executed = false;
        let mut armed_at: Option<i64> = None;
        let mut now = start;

        for op in ops {
            match op {
                Op::Approve { seat, dt } => {
                    now += dt as i64;
                    // approve handler rejects on executed/cancelled proposals
                    if executed || cancelled {
                        continue;
                    }
                    let res = p.add_approval(seat);
                    if approved.contains(&seat) {
                        // a seat can never double-count itself
                        prop_assert!(res.is_err());
                    } else {
                        prop_assert!(res.is_ok());
                        approved.insert(seat);
                    }
                    p.arm_if_ready(threshold, timelock, now);
                    if armed_at.is_none() && approved.len() >= threshold as usize {
                        // armed exactly when threshold first reached, one
                        // full contest window out (clamped to ≥ 1)
                        prop_assert_eq!(p.eligible_at, now.saturating_add(timelock).max(1));
                        armed_at = Some(p.eligible_at);
                    }
                }
                Op::Cancel { dt } => {
                    now += dt as i64;
                    // cancel handler rejects on executed/cancelled proposals
                    if executed || cancelled {
                        continue;
                    }
                    p.cancelled = true;
                    cancelled = true;
                }
                Op::Execute { dt } => {
                    now += dt as i64;
                    let res = p.require_executable(threshold, now);
                    if executed || cancelled {
                        // cancellation (or prior execution) always wins
                        prop_assert!(res.is_err());
                    } else if res.is_ok() {
                        // execution REQUIRES threshold + armed + timelock
                        prop_assert!(approved.len() >= threshold as usize);
                        prop_assert!(p.eligible_at != 0 && now >= p.eligible_at);
                        p.executed = true;
                        executed = true;
                    } else {
                        // rejected ⇒ some guard genuinely failed
                        prop_assert!(
                            approved.len() < threshold as usize
                                || p.eligible_at == 0
                                || now < p.eligible_at
                        );
                    }
                }
            }

            // Global invariants, after every step:
            prop_assert!(p.approval_count() as usize <= COUNCIL_SEATS);
            prop_assert_eq!(p.approval_count() as usize, approved.len());
            // armed iff threshold ever reached; once armed, frozen
            match armed_at {
                Some(at) => prop_assert_eq!(p.eligible_at, at),
                None => prop_assert_eq!(p.eligible_at, 0),
            }
        }
    }

    /// The timelock arithmetic never underflows/overflows (panics) for
    /// ARBITRARY i64 timestamps and windows, and an armed `eligible_at` is
    /// always ≥ 1 (0 is reserved for "not armed").
    #[test]
    fn timelock_arithmetic_total(
        approvals in any::<u8>(),
        threshold in 0u8..=8,
        timelock in any::<i64>(),
        now in any::<i64>(),
        later in any::<i64>(),
    ) {
        let mut p = new_proposal();
        p.approvals = approvals & 0x7f; // 7 seats
        p.arm_if_ready(threshold, timelock, now); // must not panic
        prop_assert_eq!(p.eligible_at != 0, p.approval_count() >= threshold);
        if p.eligible_at != 0 {
            prop_assert!(p.eligible_at >= 1);
        }
        let _ = p.require_executable(threshold, later); // must not panic
        // Arming is idempotent even under a different clock:
        let at = p.eligible_at;
        p.arm_if_ready(threshold, timelock, later);
        prop_assert_eq!(p.eligible_at, at);
    }
}

// ---------------------------------------------------------------------------
// 2. Quorum / pass-threshold math (CircleConfig policy; 0 denominators = defaults)
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Total (no division-by-zero, no panic) for the whole u16 config space
    /// including zero denominators, and quorum is always ≥ 1. With the default
    /// policy (den = 0) the quorum is exactly ceil(eligible/3), clamped ≥ 1.
    #[test]
    fn quorum_total_and_defaults(
        e in 0u64..=1u64 << 40,
        qn in any::<u16>(),
        qd in any::<u16>(),
        pn in any::<u16>(),
        pd in any::<u16>(),
        yes in any::<u64>(),
        no in any::<u64>(),
    ) {
        let q = quorum_threshold(e, qn as u64, qd as u64); // must not panic
        prop_assert!(q >= 1);
        if qd == 0 {
            // default: ceil(e / 3), min 1
            prop_assert_eq!(q, (e / 3 + u64::from(e % 3 != 0)).max(1));
        } else {
            prop_assert_eq!(q, (e.saturating_mul(qn as u64) / qd as u64).max(1));
        }
        let _ = vote_passes(yes, no, pn as u128, pd as u128); // must not panic
        let _ = member_vote_outcome(yes, no, e, qn as u64, qd as u64, pn as u128, pd as u128);
    }

    /// Rounding never lets a vote pass BELOW the configured percentage:
    /// `vote_passes` is exactly equivalent to `yes ≥ ceil(p_num·turnout/p_den)`
    /// (an independently-derived formulation), so the smallest passing `yes` is
    /// the true ceiling — one vote fewer always fails.
    #[test]
    fn pass_threshold_rounding(
        yes in 0u64..=1_000_000,
        no in 0u64..=1_000_000,
        pn in 1u16..=1000,
        pd in 1u16..=1000,
    ) {
        let turnout = yes + no;
        let (pn, pd) = (pn as u128, pd as u128);
        let min_yes = (pn * turnout as u128 + pd - 1) / pd; // ceil
        prop_assert_eq!(vote_passes(yes, no, pn, pd), (yes as u128) >= min_yes);

        // Boundary: exactly the ceiling passes; one fewer fails.
        if turnout > 0 && min_yes <= turnout as u128 {
            let by = min_yes as u64;
            prop_assert!(vote_passes(by, turnout - by, pn, pd));
            if by > 0 {
                prop_assert!(!vote_passes(by - 1, turnout - (by - 1), pn, pd));
            }
        }
    }

    /// Quorum boundary: a unanimous-yes turnout of EXACTLY the quorum passes
    /// (default majority rule), and a turnout of quorum − 1 can never pass —
    /// for arbitrary policies including the defaults.
    #[test]
    fn quorum_boundary(
        e in 0u64..=100_000,
        qn in 0u16..=1000,
        qd in 0u16..=1000,
    ) {
        let q = quorum_threshold(e, qn as u64, qd as u64);
        // exactly at quorum, all-yes, default pass rule (yes > no) ⇒ passes
        prop_assert!(member_vote_outcome(q, 0, e, qn as u64, qd as u64, 0, 0));
        // one below quorum (or zero turnout) ⇒ never passes, even unanimous
        prop_assert!(!member_vote_outcome(q - 1, 0, e, qn as u64, qd as u64, 0, 0));
    }

    /// Default pass rule (p_den = 0) is a strict simple majority: ties fail.
    #[test]
    fn default_majority_is_strict(yes in 0u64..=1_000_000, no in 0u64..=1_000_000) {
        prop_assert_eq!(vote_passes(yes, no, 0, 0), yes > no);
    }
}

// ---------------------------------------------------------------------------
// 3. Merkle tree + RecentRoots ring buffer
// ---------------------------------------------------------------------------

proptest! {
    // Poseidon on the host is the slow part — 48 cases keeps this in budget.
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// For arbitrary leaf sets ≤ capacity: the incremental (Tornado-style)
    /// insert produces the same root as an independent full-tree fold;
    /// insert-then-prove roundtrips (every leaf's sibling path recomputes the
    /// root); and a proof for leaf A never verifies for a different leaf B.
    #[test]
    fn merkle_insert_prove_roundtrip(
        depth in 2u8..=5,
        raw_leaves in pvec(arb_field(), 1..=32),
    ) {
        let cap = 1usize << depth;
        let leaves: Vec<[u8; 32]> =
            raw_leaves.into_iter().take(cap).collect();

        // Incremental insert (the on-chain path).
        let mut next_index = 0u64;
        let mut root = [0u8; 32];
        let mut filled = [[0u8; 32]; MAX_DEPTH];
        merkle::init_tree(depth, &mut next_index, &mut root, &mut filled).unwrap();
        prop_assert_eq!(root, reference_root(depth as usize, &[]));
        for leaf in &leaves {
            merkle::insert_leaf(depth, &mut next_index, &mut root, &mut filled, *leaf).unwrap();
        }
        prop_assert_eq!(next_index, leaves.len() as u64);

        // Same root as the independent reference implementation.
        let levels = reference_levels(depth as usize, &leaves);
        prop_assert_eq!(root, levels[depth as usize][0]);

        // Insert-then-prove roundtrip for EVERY leaf.
        for (i, leaf) in leaves.iter().enumerate() {
            let path = reference_path(&levels, depth as usize, i);
            prop_assert_eq!(verify_path(*leaf, i, &path), root);

            // A proof for leaf A never verifies a different leaf B.
            let j = (i + 1) % leaves.len();
            if leaves[j] != *leaf {
                prop_assert_ne!(verify_path(leaves[j], i, &path), root);
            }
            // ... nor a tampered leaf.
            let mut tampered = *leaf;
            tampered[31] ^= 1;
            prop_assert_ne!(verify_path(tampered, i, &path), root);
        }
    }

    /// A full tree rejects the (capacity + 1)-th insert.
    #[test]
    fn merkle_capacity_enforced(depth in 1u8..=3) {
        let cap = 1u64 << depth;
        let mut next_index = 0u64;
        let mut root = [0u8; 32];
        let mut filled = [[0u8; 32]; MAX_DEPTH];
        merkle::init_tree(depth, &mut next_index, &mut root, &mut filled).unwrap();
        for i in 0..cap {
            let leaf = merkle::field_from_u64(i + 1);
            prop_assert!(
                merkle::insert_leaf(depth, &mut next_index, &mut root, &mut filled, leaf).is_ok()
            );
        }
        let overflow = merkle::field_from_u64(cap + 1);
        prop_assert!(
            merkle::insert_leaf(depth, &mut next_index, &mut root, &mut filled, overflow).is_err()
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The RecentRoots(16) ring buffer keeps exactly the last 16 EFFECTIVE
    /// pushes (consecutive duplicates are skipped, so a crank re-noting one
    /// root cannot flush the window), rejects anything older that no longer
    /// appears in the window, and never accepts the zero root.
    #[test]
    fn recent_roots_ring_buffer(pushes in pvec(arb_root(), 0..64)) {
        let mut rr = RecentRoots {
            circle: Pubkey::default(),
            epoch: 0,
            epoch_started_at: 0,
            index: 0,
            roots: [[0u8; 32]; RecentRoots::N],
            bump: 0,
        };

        // Model: collapse consecutive duplicates (initial "last written" is
        // the zero root), then keep the last N entries.
        let mut effective: Vec<[u8; 32]> = Vec::new();
        for r in &pushes {
            let prev = effective.last().copied().unwrap_or([0u8; 32]);
            rr.push(*r);
            if prev != *r {
                effective.push(*r);
            }
        }
        let window: HashSet<[u8; 32]> =
            effective.iter().rev().take(RecentRoots::N).copied().collect();

        // The zero root is never accepted.
        prop_assert!(!rr.contains(&[0u8; 32]));

        // Every pushed root is contained iff it is nonzero and within the
        // last-16 window; overwritten (older) roots are rejected.
        for r in &pushes {
            prop_assert_eq!(
                rr.contains(r),
                *r != [0u8; 32] && window.contains(r),
                "root {:?}", r
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Nullifier PDA seed determinism / domain separation
// ---------------------------------------------------------------------------

/// Every nullifier-consuming PDA family in the program: seeds are
/// [prefix, base_account, 32-byte nullifier/commitment].
const NULLIFIER_PREFIXES: [&[u8]; 7] = [
    b"vouchnull",      // attest_admission_zk
    b"faucetnull",     // activate_faucet + activate_faucet_zk (shared one-shot)
    b"vote_nullifier", // cast_vote
    b"nullifier",      // grant_level
    b"ack_nullifier",  // issue_acknowledgment
    b"personhood",     // prove_personhood
    b"visit",          // verify_fellow_member
];

fn nullifier_pda(prefix: &[u8], base: &Pubkey, n: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[prefix, base.as_ref(), n.as_ref()], &crate::ID).0
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Same inputs → same PDA (determinism); distinct (circle, nullifier)
    /// inputs → distinct PDAs (no cross-circle collision by construction);
    /// and the seed prefixes domain-separate the families (the same
    /// (circle, nullifier) under two different prefixes never collides).
    #[test]
    fn nullifier_pda_seeds(
        c1 in any::<[u8; 32]>(),
        c2 in any::<[u8; 32]>(),
        n1 in any::<[u8; 32]>(),
        n2 in any::<[u8; 32]>(),
    ) {
        let circle1 = Pubkey::new_from_array(c1);
        let circle2 = Pubkey::new_from_array(c2);

        for prefix in NULLIFIER_PREFIXES {
            // Determinism: derive twice, get the same address.
            prop_assert_eq!(
                nullifier_pda(prefix, &circle1, &n1),
                nullifier_pda(prefix, &circle1, &n1)
            );
            // Distinct circle ⇒ distinct PDA (same nullifier reusable across
            // Circles without collision — the per-Circle scoping guarantee).
            if circle1 != circle2 {
                prop_assert_ne!(
                    nullifier_pda(prefix, &circle1, &n1),
                    nullifier_pda(prefix, &circle2, &n1)
                );
            }
            // Distinct nullifier ⇒ distinct PDA.
            if n1 != n2 {
                prop_assert_ne!(
                    nullifier_pda(prefix, &circle1, &n1),
                    nullifier_pda(prefix, &circle1, &n2)
                );
            }
        }

        // Domain separation between families.
        for (i, a) in NULLIFIER_PREFIXES.iter().enumerate() {
            for b in &NULLIFIER_PREFIXES[i + 1..] {
                prop_assert_ne!(
                    nullifier_pda(a, &circle1, &n1),
                    nullifier_pda(b, &circle1, &n1)
                );
            }
        }
    }

    /// `field_from_pubkey` (the per-Circle external nullifier encoding) is
    /// deterministic, always a valid BN254 field element (top 3 bits cleared ⇒
    /// value < p), and preserves the remaining 253 bits verbatim.
    #[test]
    fn field_from_pubkey_masks_into_field(pk_bytes in any::<[u8; 32]>()) {
        let pk = Pubkey::new_from_array(pk_bytes);
        let f = merkle::field_from_pubkey(&pk);
        prop_assert_eq!(f, merkle::field_from_pubkey(&pk)); // deterministic
        prop_assert_eq!(f[0] & 0xe0, 0); // top 3 bits cleared ⇒ < p (p > 2^253)
        prop_assert_eq!(f[0], pk_bytes[0] & 0x1f);
        prop_assert_eq!(&f[1..], &pk_bytes[1..]);
    }

    /// F35 anonymous activation — the faucet endorsement's external nullifier
    /// (`H("AHA-faucet-grant" || circle || neophyte)`, masked into BN254):
    ///
    ///   * deterministic (the browser prover and the program must agree, or
    ///     every proof fails verification);
    ///   * always a valid field element (top 3 bits cleared ⇒ < p);
    ///   * BOUND to the pair — a different circle or a different neophyte gives
    ///     a different external nullifier, so an endorsement can never be
    ///     re-aimed at another neophyte or replayed into another Circle;
    ///   * DOMAIN-SEPARATED from `attest_admission_zk`, which uses the raw
    ///     commitment as its external nullifier. If the two ever coincided, the
    ///     same member endorsing both would emit the same `Poseidon(secret, ·)`
    ///     twice and an observer could link the two anonymous acts.
    #[test]
    fn faucet_external_nullifier_binds_and_separates(
        c1 in any::<[u8; 32]>(),
        c2 in any::<[u8; 32]>(),
        n1 in arb_field(),
        n2 in arb_field(),
    ) {
        use crate::instructions::activate_faucet_zk::faucet_external_nullifier;

        let circle1 = Pubkey::new_from_array(c1);
        let circle2 = Pubkey::new_from_array(c2);

        let e = faucet_external_nullifier(&circle1, &n1);
        prop_assert_eq!(e, faucet_external_nullifier(&circle1, &n1)); // deterministic
        prop_assert_eq!(e[0] & 0xe0, 0); // in-field

        if circle1 != circle2 {
            prop_assert_ne!(e, faucet_external_nullifier(&circle2, &n1));
        }
        if n1 != n2 {
            prop_assert_ne!(e, faucet_external_nullifier(&circle1, &n2));
        }

        // Never equal to the raw commitment (attest_admission_zk's external
        // nullifier for the same newcomer).
        prop_assert_ne!(e, n1);
    }
}
