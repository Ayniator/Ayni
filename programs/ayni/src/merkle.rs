//! On-chain incremental Poseidon Merkle tree (Tornado-style).
//!
//! Uses the Solana `poseidon` syscall (light-poseidon) with `Bn254X5` +
//! big-endian, which is byte-for-byte compatible with circomlib `Poseidon` in
//! `circuits/lineage_grant.circom`. Any mismatch silently breaks inclusion
//! proofs — see docs/zk-lineage.md §5.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::poseidon::{hashv, Endianness, Parameters};

use crate::errors::AyniError;
use crate::state::Lineage;

/// Maximum supported tree depth (2^20 ≈ 1.05M lifetime credentials).
pub const MAX_DEPTH: usize = 20;

/// Poseidon(a, b) over BN254, big-endian — matches circomlib `Poseidon(2)`.
pub fn poseidon2(a: &[u8; 32], b: &[u8; 32]) -> Result<[u8; 32]> {
    let h = hashv(Parameters::Bn254X5, Endianness::BigEndian, &[a, b])
        .map_err(|_| error!(AyniError::PoseidonError))?;
    Ok(h.to_bytes())
}

/// Encode a small unsigned value as a big-endian field element (value in the
/// least-significant byte). Matches how the circuit treats `grantedLevel`.
pub fn field_from_u8(v: u8) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[31] = v;
    b
}

/// Empty-subtree hashes: `zeros[0] = field 0`, `zeros[i+1] = H(zeros[i], zeros[i])`.
/// Returns `depth + 1` entries. The off-chain prover must use the same zeros.
pub fn zeros(depth: usize) -> Result<[[u8; 32]; MAX_DEPTH + 1]> {
    require!(depth <= MAX_DEPTH, AyniError::DepthTooLarge);
    let mut z = [[0u8; 32]; MAX_DEPTH + 1];
    for i in 0..depth {
        z[i + 1] = poseidon2(&z[i], &z[i])?;
    }
    Ok(z)
}

/// Initialize a `Lineage` to an empty tree of the given depth.
pub fn init_empty(lineage: &mut Lineage, depth: u8) -> Result<()> {
    let d = depth as usize;
    require!(d <= MAX_DEPTH, AyniError::DepthTooLarge);
    let z = zeros(d)?;
    lineage.depth = depth;
    lineage.next_index = 0;
    lineage.root = z[d];
    for i in 0..d {
        lineage.filled_subtrees[i] = z[i];
    }
    Ok(())
}

/// Append a leaf, updating `filled_subtrees`, `next_index`, and `root`.
pub fn insert(lineage: &mut Lineage, leaf: [u8; 32]) -> Result<()> {
    let depth = lineage.depth as usize;
    require!(lineage.next_index < (1u64 << depth), AyniError::LineageFull);
    let z = zeros(depth)?;

    let mut index = lineage.next_index;
    let mut cur = leaf;
    for i in 0..depth {
        let (left, right) = if index & 1 == 0 {
            lineage.filled_subtrees[i] = cur;
            (cur, z[i])
        } else {
            (lineage.filled_subtrees[i], cur)
        };
        cur = poseidon2(&left, &right)?;
        index >>= 1;
    }
    lineage.next_index += 1;
    lineage.root = cur;
    Ok(())
}
