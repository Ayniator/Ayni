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

/// Encode a u64 as a big-endian field element (value in the low 8 bytes).
pub fn field_from_u64(v: u64) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[24..32].copy_from_slice(&v.to_be_bytes());
    b
}

/// Reduce a Pubkey to a valid BN254 field element by clearing the top 3 bits
/// (BN254 p > 2^253, so the result is always < p). Used as a per-Circle external
/// nullifier for proof-of-personhood. The off-chain prover must mask identically.
pub fn field_from_pubkey(pk: &Pubkey) -> [u8; 32] {
    let mut b = pk.to_bytes();
    b[0] &= 0x1f;
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

/// Initialize an empty incremental tree (generic over the holding account's
/// fields). `init_empty`/`insert` below are thin wrappers for `Lineage`.
pub fn init_tree(
    depth: u8,
    next_index: &mut u64,
    root: &mut [u8; 32],
    filled: &mut [[u8; 32]; MAX_DEPTH],
) -> Result<()> {
    let d = depth as usize;
    require!(d <= MAX_DEPTH, AyniError::DepthTooLarge);
    let z = zeros(d)?;
    *next_index = 0;
    *root = z[d];
    for i in 0..d {
        filled[i] = z[i];
    }
    Ok(())
}

/// Append a leaf to a generic incremental tree, updating its fields.
pub fn insert_leaf(
    depth: u8,
    next_index: &mut u64,
    root: &mut [u8; 32],
    filled: &mut [[u8; 32]; MAX_DEPTH],
    leaf: [u8; 32],
) -> Result<()> {
    let d = depth as usize;
    require!(*next_index < (1u64 << d), AyniError::LineageFull);
    let z = zeros(d)?;

    let mut index = *next_index;
    let mut cur = leaf;
    for i in 0..d {
        let (left, right) = if index & 1 == 0 {
            filled[i] = cur;
            (cur, z[i])
        } else {
            (filled[i], cur)
        };
        cur = poseidon2(&left, &right)?;
        index >>= 1;
    }
    *next_index += 1;
    *root = cur;
    Ok(())
}

/// Initialize a `Lineage` to an empty tree of the given depth.
pub fn init_empty(lineage: &mut Lineage, depth: u8) -> Result<()> {
    lineage.depth = depth;
    init_tree(depth, &mut lineage.next_index, &mut lineage.root, &mut lineage.filled_subtrees)
}

/// Append a leaf to a `Lineage`.
pub fn insert(lineage: &mut Lineage, leaf: [u8; 32]) -> Result<()> {
    insert_leaf(
        lineage.depth,
        &mut lineage.next_index,
        &mut lineage.root,
        &mut lineage.filled_subtrees,
        leaf,
    )
}
