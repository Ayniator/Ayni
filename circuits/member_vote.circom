pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// Anonymous one-member-one-vote (Semaphore-style). Proves the voter holds a
// membership whose identity commitment `Poseidon(secret)` is in the snapshotted
// member set `root`, and emits a per-proposal nullifier `Poseidon(secret,
// proposalId)` so each member can vote at most once. The voter stays hidden; the
// ballot `choice` is public (a secret ballot whose content is visible but whose
// caster is not). Reused for proof-of-personhood (root = personhood set,
// proposalId = Circle external nullifier). See docs/member-voting.md.
template MemberVote(depth) {
    // ---- public ----
    signal input root;
    signal input proposalId;
    signal input choice;        // 0 = no, 1 = yes (or 1 for a personhood claim)
    signal output nullifier;

    // ---- private ----
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // identity commitment = the member-set leaf
    component idc = Poseidon(1);
    idc.inputs[0] <== secret;

    // Merkle inclusion
    signal cur[depth + 1];
    cur[0] <== idc.out;
    component l[depth];
    component r[depth];
    component h[depth];
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        l[i] = Mux1(); l[i].c[0] <== cur[i]; l[i].c[1] <== pathElements[i]; l[i].s <== pathIndices[i];
        r[i] = Mux1(); r[i].c[0] <== pathElements[i]; r[i].c[1] <== cur[i]; r[i].s <== pathIndices[i];
        h[i] = Poseidon(2); h[i].inputs[0] <== l[i].out; h[i].inputs[1] <== r[i].out;
        cur[i + 1] <== h[i].out;
    }
    root === cur[depth];

    // choice must be boolean
    choice * (1 - choice) === 0;

    // per-proposal nullifier
    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== proposalId;
    nullifier <== nh.out;
}

component main {public [root, proposalId, choice]} = MemberVote(20);
