pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";

// Proves that the (hidden) prover holds a credential in the lineage tree whose
// level is >= grantedLevel, and authorizes a level grant to `granteeCommitment`,
// emitting a nullifier — without revealing which credential or whose secret.
//
// See docs/zk-lineage.md. Hash params MUST match the on-chain poseidon syscall:
// BN254, x^5 S-box (circomlib Poseidon), big-endian field elements.
template LineageGrant(depth) {
    // ---- public inputs ----
    signal input root;              // current lineage Merkle root
    signal input grantedLevel;      // level being conferred (1..=issuerLevel)
    signal input granteeCommitment; // student's pseudonymous identity commitment

    // ---- public output ----
    signal output nullifier;        // Poseidon(issuerSecret, granteeCommitment)

    // ---- private witness ----
    signal input issuerSecret;
    signal input issuerLevel;
    signal input pathElements[depth];
    signal input pathIndices[depth]; // 0 => current node is the left child

    // 1. issuer identity commitment from the secret (proves knowledge of secret)
    component commit = Poseidon(1);
    commit.inputs[0] <== issuerSecret;

    // 2. issuer credential leaf = Poseidon(identityCommitment, level)
    component leaf = Poseidon(2);
    leaf.inputs[0] <== commit.out;
    leaf.inputs[1] <== issuerLevel;

    // 3. Merkle inclusion: fold the leaf up to the root
    signal levelHash[depth + 1];
    levelHash[0] <== leaf.out;

    component left[depth];
    component right[depth];
    component node[depth];
    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be boolean
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // if idx==0: (left,right) = (cur, sibling); else (sibling, cur)
        left[i] = Mux1();
        left[i].c[0] <== levelHash[i];
        left[i].c[1] <== pathElements[i];
        left[i].s <== pathIndices[i];

        right[i] = Mux1();
        right[i].c[0] <== pathElements[i];
        right[i].c[1] <== levelHash[i];
        right[i].s <== pathIndices[i];

        node[i] = Poseidon(2);
        node[i].inputs[0] <== left[i].out;
        node[i].inputs[1] <== right[i].out;
        levelHash[i + 1] <== node[i].out;
    }
    root === levelHash[depth];

    // 4. level rule: 1 <= grantedLevel <= issuerLevel   (levels are u8)
    component le = LessEqThan(8);
    le.in[0] <== grantedLevel;
    le.in[1] <== issuerLevel;
    le.out === 1;

    component pos = GreaterThan(8);
    pos.in[0] <== grantedLevel;
    pos.in[1] <== 0;
    pos.out === 1;

    // 5. nullifier binds the granter's secret to this specific student
    component nh = Poseidon(2);
    nh.inputs[0] <== issuerSecret;
    nh.inputs[1] <== granteeCommitment;
    nullifier <== nh.out;
}

// depth 20 => up to 2^20 ≈ 1.05M lifetime credentials in the lineage.
component main {public [root, grantedLevel, granteeCommitment]} = LineageGrant(20);
