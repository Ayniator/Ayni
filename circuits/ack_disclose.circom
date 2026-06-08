pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Selective disclosure of an acknowledgment credential.
//
//   cF = Poseidon(fieldF, saltF)   for F in {P=portrait, C=course, X=teacher, D=date}
//   R  = Poseidon(cP, cC, cX, cD)  -- the on-chain credential root
//
// The holder proves the secret opening hashes to the on-chain `root`, reveals
// any subset of the four fields (revealF = 1 exposes valueF == fieldF; revealF =
// 0 keeps it hidden and forces valueF = 0), and may prove DDD >= dateLowerBound
// WITHOUT revealing DDD. The "is the teacher a real lineage holder?" guarantee
// is carried by the on-chain acknowledgment's issuer attestation (issued via the
// lineage tree), so it is not re-proved here. See docs/acknowledgments.md.
template AckDisclose() {
    // ---- public inputs ----
    signal input root;
    signal input revealP;
    signal input revealC;
    signal input revealX;
    signal input revealD;
    signal input valueP;
    signal input valueC;
    signal input valueX;
    signal input valueD;
    signal input dateLowerBound;   // 0 disables the predicate (dateOk trivially 1)

    // ---- public output ----
    signal output dateOk;          // 1 iff ddd >= dateLowerBound

    // ---- private witness (the full opening) ----
    signal input ppp;
    signal input ccc;
    signal input xxx;
    signal input ddd;
    signal input saltP;
    signal input saltC;
    signal input saltX;
    signal input saltD;

    // 1. per-field commitments
    component cp = Poseidon(2); cp.inputs[0] <== ppp; cp.inputs[1] <== saltP;
    component cc = Poseidon(2); cc.inputs[0] <== ccc; cc.inputs[1] <== saltC;
    component cx = Poseidon(2); cx.inputs[0] <== xxx; cx.inputs[1] <== saltX;
    component cd = Poseidon(2); cd.inputs[0] <== ddd; cd.inputs[1] <== saltD;

    // 2. credential root binds all four fields
    component r = Poseidon(4);
    r.inputs[0] <== cp.out;
    r.inputs[1] <== cc.out;
    r.inputs[2] <== cx.out;
    r.inputs[3] <== cd.out;
    root === r.out;

    // 3. selective reveal: revealF boolean; reveal => value==field; hide => value==0
    revealP * (1 - revealP) === 0;
    revealC * (1 - revealC) === 0;
    revealX * (1 - revealX) === 0;
    revealD * (1 - revealD) === 0;

    revealP * (ppp - valueP) === 0;
    (1 - revealP) * valueP === 0;
    revealC * (ccc - valueC) === 0;
    (1 - revealC) * valueC === 0;
    revealX * (xxx - valueX) === 0;
    (1 - revealX) * valueX === 0;
    revealD * (ddd - valueD) === 0;
    (1 - revealD) * valueD === 0;

    // 4. date predicate: prove freshness/age without revealing the exact date
    component ge = GreaterEqThan(32); // dates fit in 32 bits (unix seconds < 2^32)
    ge.in[0] <== ddd;
    ge.in[1] <== dateLowerBound;
    dateOk <== ge.out;
}

component main {public [
    root, revealP, revealC, revealX, revealD,
    valueP, valueC, valueX, valueD, dateLowerBound
]} = AckDisclose();
