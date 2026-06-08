pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";

// Merkle root from a leaf + authentication path (Poseidon; pathIndices[i]=0 => left).
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal cur[depth + 1];
    cur[0] <== leaf;
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
    root <== cur[depth];
}

// Selective disclosure of an acknowledgment credential, with optional predicate
// proofs. See docs/acknowledgments.md.
//
//   cF = Poseidon(fieldF, saltF) for F in {P portrait, C course, X teacher, D date}
//   R  = Poseidon(cP, cC, cX, cD)
//
// Per field the holder may reveal it, hide it, or (for date/course/teacher)
// prove a predicate about it without revealing it. Each predicate has an
// `enable` flag so the same circuit serves every combination.
template AckDisclose(setDepth) {
    // ---- public inputs ----
    signal input root;
    signal input revealP; signal input revealC; signal input revealX; signal input revealD;
    signal input valueP; signal input valueC; signal input valueX; signal input valueD;
    signal input dateLowerBound;     // prove ddd >= this (0 = trivially satisfied)
    signal input catalogRoot;        // Merkle root of the accredited-course set
    signal input enableCatalog;      // 1 => enforce ccc ∈ catalog
    signal input teacherSetRoot;     // Merkle root of the recognized-teacher set
    signal input enableTeacherSet;   // 1 => enforce xxx ∈ teacher set

    // ---- public outputs ----
    signal output dateOk;            // 1 iff ddd >= dateLowerBound
    signal output courseAccredited;  // 1 iff enableCatalog and ccc ∈ catalog
    signal output teacherRecognized; // 1 iff enableTeacherSet and xxx ∈ teacher set

    // ---- private witness ----
    signal input ppp; signal input ccc; signal input xxx; signal input ddd;
    signal input saltP; signal input saltC; signal input saltX; signal input saltD;
    signal input catalogPathElements[setDepth]; signal input catalogPathIndices[setDepth];
    signal input teacherPathElements[setDepth]; signal input teacherPathIndices[setDepth];

    // 1. per-field commitments + credential root
    component cp = Poseidon(2); cp.inputs[0] <== ppp; cp.inputs[1] <== saltP;
    component cc = Poseidon(2); cc.inputs[0] <== ccc; cc.inputs[1] <== saltC;
    component cx = Poseidon(2); cx.inputs[0] <== xxx; cx.inputs[1] <== saltX;
    component cd = Poseidon(2); cd.inputs[0] <== ddd; cd.inputs[1] <== saltD;
    component r = Poseidon(4);
    r.inputs[0] <== cp.out; r.inputs[1] <== cc.out; r.inputs[2] <== cx.out; r.inputs[3] <== cd.out;
    root === r.out;

    // 2. selective reveal: reveal => value==field; hide => value==0
    revealP * (1 - revealP) === 0; revealC * (1 - revealC) === 0;
    revealX * (1 - revealX) === 0; revealD * (1 - revealD) === 0;
    revealP * (ppp - valueP) === 0; (1 - revealP) * valueP === 0;
    revealC * (ccc - valueC) === 0; (1 - revealC) * valueC === 0;
    revealX * (xxx - valueX) === 0; (1 - revealX) * valueX === 0;
    revealD * (ddd - valueD) === 0; (1 - revealD) * valueD === 0;

    // 3. date predicate
    component ge = GreaterEqThan(32); // dates fit 32 bits (unix seconds < 2^32)
    ge.in[0] <== ddd; ge.in[1] <== dateLowerBound;
    dateOk <== ge.out;

    // 4. course-in-catalog predicate (optional). leaf = Poseidon(ccc).
    enableCatalog * (1 - enableCatalog) === 0;
    component leafC = Poseidon(1); leafC.inputs[0] <== ccc;
    component mkC = MerkleRoot(setDepth);
    mkC.leaf <== leafC.out;
    for (var i = 0; i < setDepth; i++) {
        mkC.pathElements[i] <== catalogPathElements[i];
        mkC.pathIndices[i] <== catalogPathIndices[i];
    }
    // when enabled, the computed root must equal the (public, pinned) catalogRoot
    enableCatalog * (mkC.root - catalogRoot) === 0;
    courseAccredited <== enableCatalog;

    // 5. teacher-in-set predicate (optional). leaf = Poseidon(xxx).
    enableTeacherSet * (1 - enableTeacherSet) === 0;
    component leafX = Poseidon(1); leafX.inputs[0] <== xxx;
    component mkX = MerkleRoot(setDepth);
    mkX.leaf <== leafX.out;
    for (var i = 0; i < setDepth; i++) {
        mkX.pathElements[i] <== teacherPathElements[i];
        mkX.pathIndices[i] <== teacherPathIndices[i];
    }
    enableTeacherSet * (mkX.root - teacherSetRoot) === 0;
    teacherRecognized <== enableTeacherSet;
}

// setDepth 16 => sets of up to 2^16 ≈ 65k accredited courses / recognized teachers.
component main {public [
    root, revealP, revealC, revealX, revealD,
    valueP, valueC, valueX, valueD, dateLowerBound,
    catalogRoot, enableCatalog, teacherSetRoot, enableTeacherSet
]} = AckDisclose(16);
