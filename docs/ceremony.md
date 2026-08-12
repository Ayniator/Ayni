# F44 — Multi-party phase-2 trusted-setup ceremony (runbook)

Tooling: `scripts/ceremony/` (plain node 18; snarkjs resolves from
`frontend/node_modules`, currently 0.7.6). All ceremony output lives in the
gitignored `ceremony/` directory. **Nothing here touches the live keys** —
swapping the embedded verifying keys is a separate, Sentinel-gated,
program-redeploy round (§7).

## 1. Why this exists (threat model)

Groth16 requires a per-circuit trusted setup. Whoever knows the phase-2
"toxic waste" (the secret behind `delta`) can **forge proofs that verify**
against the resulting key. For Ayni that means forging:

- **lineage grants** (`lineage_grant` → `verifying_key.rs`, also reused by
  `issue_acknowledgment`) — mint lineage/authority out of thin air;
- **member votes** (`member_vote` → `verifying_key_vote.rs`) — cast valid
  ballots (including Council-seat elections, F28) without membership;
- **acknowledgment disclosures** (`ack_disclose` → `verifying_key_ack.rs`).

Today all three final zkeys come from a **single contributor** — the
`ayni-2` contribution produced per `circuits/README.md` — and the phase-1
Powers of Tau (`pot16`) was also generated locally by a single party
(`ayni-1`). That party (or anyone who compromised that machine before the
toxic waste was destroyed) must be trusted absolutely. `circuits/README.md`
and `BACKLOG.md` F44 mark this a **mainnet blocker**.

**What a multi-party ceremony buys:** each participant applies their own
secret randomness to the key in sequence. The combined secret is unknowable
unless **every single participant** colludes or is compromised. One honest
participant who destroys their entropy makes the key sound — the trust
assumption drops from "trust this one machine" to "at least 1 of N
participants was honest", and N can include mutually distrusting Circles.

**What the beacon buys:** the *last* human contributor sees the final key
before anyone else and could grind/choose their contribution adaptively. A
final deterministic contribution derived from a **public value fixed in
advance but unknowable in advance** (a future blockhash) closes that window
(§5).

**What it does not buy:** the ceremony does not fix circuit bugs, and it
inherits phase 1 — see Mode A vs Mode B below.

## 2. What one honest participant guarantees — and the chain of custody

The zkey file itself carries the whole MPC transcript: each contribution's
public key, a hash chain over them, and the circuit hash. `verify.mjs`
checks it cryptographically, which is why the zkey can be passed between
participants **over any channel whatsoever** — email, USB stick, a shared
drive, in person. Integrity is not a property of the channel; it is verified
after the fact:

- a modified/substituted zkey fails verification against the chain;
- a participant's published **contribution hash** (printed by
  `contribute.mjs`, announced out-of-band, recorded in the transcript) pins
  their step — a coordinator who drops or reorders contributions is caught by
  comparing the chain against the published hashes;
- the beacon contribution is **reproduced from the public beacon value**
  during verification, so it cannot be faked.

The only thing verification cannot see is whether a participant's entropy
was honestly random and destroyed — that is exactly the 1-of-N honesty
assumption.

## 3. Two ceremony modes

`init.mjs` supports both; **the transcript must record which mode was used**.

- **Mode A (default) — extend the current chain.** The ceremony starts from
  the shipped `build/<circuit>_final.zkey` and appends contributions. Needs
  nothing beyond the repo. Limitations, stated honestly:
  - it inherits the **single-party phase 1** (`pot16` made locally, one
    contribution) — phase-1 toxic waste is a real, if smaller, risk
    (it is circuit-independent but still enables proof forgery if fully
    known);
  - independent full verification (tier 1) needs the **original**
    `build/pot16_final.ptau` and the r1cs, neither of which is in git; if
    the original ptau no longer exists, the baseline's provenance can never
    be fully re-verified — only the extension chain can (tier 2/3).
- **Mode B (`--fresh`) — recommended for the mainnet ceremony.** Restart
  phase 2 from `snarkjs groth16 setup` over the circuit's r1cs and a
  **well-attested public ptau** (e.g. the Hermez/iden3
  `powersOfTau28_hez_final_16.ptau`, whose multi-party provenance is
  publicly documented; ≥ 2^16 ≥ this repo's domain sizes — `member_vote` has
  8192). This removes the phase-1 single-party problem and makes tier-1
  verification possible for anyone. It requires compiling the circuits with
  circom 2.x (`circuits/README.md` §1) — **pin and record the exact circom
  version** in the transcript, because the r1cs (and hence the circuit hash)
  depends on it. Note the resulting key is unrelated to the shipped one, so
  the swap round (§7) is mandatory before any proof verifies.

## 4. Step-by-step for N participants

Roles: one **coordinator** (moves files, keeps the transcript, applies the
beacon — needs no trust: everything they do is verifiable), N
**participants** (ideally from different Circles / machines / jurisdictions),
any number of **verifiers**.

1. **Coordinator — announce the ceremony.** Publish: the circuit list, the
   mode (A/B), participant order, the beacon rule *including the exact
   future Solana slot number* (§5), and where contribution hashes will be
   posted. Then:

   ```
   node scripts/ceremony/init.mjs                         # Mode A, all 3 circuits
   # or, Mode B (per circuit, r1cs + public ptau in build/):
   node scripts/ceremony/init.mjs member_vote --fresh --ptau build/powersOfTau28_hez_final_16.ptau
   ```

   This writes `ceremony/<circuit>/0000_init.zkey` + `manifest.json` and the
   first `ceremony/TRANSCRIPT.md` entries. Publish the init zkey's sha256.

2. **Each participant, in order** (repeat per circuit):
   - receive `NNNN.zkey` (any channel), check its sha256 against the
     announced value, and (recommended) verify the chain so far:
     `node scripts/ceremony/verify.mjs <circuit> <NNNN.zkey>`;
   - contribute — entropy is always 64 CSPRNG bytes, plus anything typed:

     ```
     node scripts/ceremony/contribute.mjs ceremony/member_vote/0001.zkey \
       ceremony/member_vote/0002.zkey --name "Circle Lima — R.Q." \
       --entropy "dice rolls typed here, never reused, never saved"
     ```

   - **publish the printed contribution hash out-of-band** (the channel the
     coordinator announced — a signed message, a public post, …), and send
     the output zkey onward. Power off / wipe the machine state if the
     stakes warrant it; at minimum, never record the entropy.
   - a participant on an **air-gapped machine** can run plain
     `snarkjs zkey contribute` instead; the coordinator then records the
     step with `node scripts/ceremony/transcript.mjs --circuit … --action
     contribute --actor … --file … --hash …`.

3. **Coordinator — transcript.** `contribute.mjs` auto-appends transcript
   entries when the files are under `ceremony/<circuit>/`; reconcile them
   against the hashes participants published before proceeding.

4. **Coordinator — beacon + finalize** (only after the announced slot has
   passed, §5):

   ```
   node scripts/ceremony/finalize.mjs member_vote ceremony/member_vote/000N.zkey \
     --beacon <blockhash-hex> --iterations 10 \
     --source "Solana mainnet-beta blockhash of slot <S>, announced <date> in <where>"
   ```

   This produces `ceremony/<circuit>/<circuit>_final.zkey`,
   `<circuit>_vkey.json`, a candidate `verifying_key*.rs`, and **prints** the
   diff against the currently embedded key (it never writes to `programs/`).

5. **Everyone — verify** (§6) and publish the ceremony package: final zkeys,
   `TRANSCRIPT.md`, the init zkeys, and (Mode B) the ptau reference + circom
   version.

## 5. Beacon selection rule

The beacon must be **fixed by a rule announced before the last contribution**
and **unknowable until after it**. Rule for Ayni ceremonies:

> The beacon is the **blockhash of the first Solana *mainnet-beta* block at
> or after slot S**, where S is announced in the ceremony announcement (step
> 4.1) and lies comfortably after the expected last contribution (e.g. +2
> days of slots). Iterations: `2^10`. (Devnet is acceptable for devnet-only
> rehearsal ceremonies, but devnet can be reset — never use it for the real
> ceremony.)

Obtaining and converting the value once slot S has passed (blockhashes are
base58; snarkjs wants hex):

```
solana block <S> --url mainnet-beta --output json | jq -r .blockhash
node -e 'const bs58=require("bs58"); const d=(bs58.decode?bs58:bs58.default).decode(process.argv[1]); console.log(Buffer.from(d).toString("hex"))' <blockhash>
```

Record slot, blockhash (base58 + hex), and the announcement reference in the
`--source` string so any verifier can re-derive it. `verify.mjs` reproduces
the beacon contribution from the recorded hash, so a coordinator cannot
substitute a chosen "beacon".

## 6. Independent verification

`scripts/ceremony/verify.mjs` runs the strongest check the available
artifacts allow and *says what is missing* for the rest:

| tier | needs | proves |
|---|---|---|
| 1 | r1cs + ptau | everything: zkey belongs to this circuit + ptau, full chain, beacon |
| 2 | init zkey + ptau | full chain from the ceremony baseline |
| 3 | init zkey only | chain hashes, key pairings, beacon, delta chain, circuit-section equality — all but the ptau-dependent H-section check |
| 4 | final zkey only | nothing (unverified listing of the embedded chain for transcript cross-checks) |

A verifier machine needs: node ≥ 18, snarkjs 0.7.6, the published ceremony
package, and for tier 1 additionally the ptau file and the r1cs — the r1cs
is rebuilt from `circuits/<circuit>.circom` with the **circom version pinned
in the transcript** (`circom … --r1cs -l node_modules -o build/`,
`circuits/README.md` §1). The repo deliberately gitignores `build/*.r1cs`
and `build/*.ptau`, so the ceremony package must carry or reference them.

Cross-checks a verifier should also do: every contribution hash in the zkey
chain (tier 3/4 output) appears in `TRANSCRIPT.md` **and** matches what the
participant published out-of-band; the beacon source re-derives to the
recorded hex; the exported vkey matches `snarkjs zkey export
verificationkey` run locally.

## 7. Swap round — putting the new key live (SEPARATE round)

**This is not part of the ceremony.** It changes the proof layer of the live
program and therefore is its own implementation round: Sentinel-gated
(`CLAUDE.md` non-regression policy), with a program redeploy, done only
after the ceremony package is published and independently verified. Nothing
in `scripts/ceremony/` performs any of it.

The generation path mirrors how the current keys were made
(`circuits/README.md` §4 + `scripts/vk_to_rust.js`); the integrity checks at
the end are enforced by `tests/sentinel/zk-integrity.sh` (Sentinel Layer C).

Per circuit, in one commit:

1. **Proving artifacts** (provers must use the ceremony zkey, or their
   proofs will no longer verify):
   - `cp ceremony/<circuit>/<circuit>_final.zkey build/<circuit>_final.zkey`
   - `cp ceremony/<circuit>/<circuit>_vkey.json  build/<circuit>_vkey.json`
   - `member_vote` only: also
     `cp ceremony/member_vote/member_vote_final.zkey frontend/public/zk/member_vote_final.zkey`
     (the browser prover `frontend/lib/zk-vote.ts` loads `/zk/member_vote_final.zkey`).
   - The witness wasm (`build/<circuit>_js/`, `frontend/public/zk/member_vote.wasm`)
     is **unchanged** by a phase-2 ceremony — do not touch it (Mode B with a
     recompiled circuit is different: then wasm + r1cs artifacts must be
     regenerated and shipped together).
2. **Embedded verifying key** — regenerate via the repo's canonical path:

   ```
   node scripts/vk_to_rust.js build/lineage_grant_vkey.json > programs/ayni/src/verifying_key.rs
   node scripts/vk_to_rust.js build/ack_disclose_vkey.json  > programs/ayni/src/verifying_key_ack.rs
   node scripts/vk_to_rust.js build/member_vote_vkey.json   > programs/ayni/src/verifying_key_vote.rs
   ```

   then rename the const in the ack/vote files (`vk_to_rust.js` always emits
   `VERIFYING_KEY`; those files must declare `VERIFYING_KEY_ACK` /
   `VERIFYING_KEY_VOTE` — `sed -i 's/pub const VERIFYING_KEY:/pub const
   VERIFYING_KEY_ACK:/'` etc.). The result must equal the
   `ceremony/<circuit>/*.rs.candidate` file `finalize.mjs` produced —
   `diff` them.
3. **Build + prove/verify round-trip**: `anchor build`; run the ZK e2e tests
   (`tests/zk-e2e.test.mjs`) so a freshly generated proof verifies against
   the new embedded key.
4. **Integrity + non-regression**: `bash tests/sentinel/zk-integrity.sh`
   must pass (vkey↔zkey↔rs coherence, no placeholder keys); then run the
   full Sentinel round per `CLAUDE.md`.
5. **Deploy**: devnet first, exercise `grant_level` / `cast_vote` /
   acknowledgment flows, then mainnet. **Coordinate the cutover**: proofs
   generated with the old zkey are invalid the moment the program upgrade
   lands — announce a brief voting/granting freeze around the upgrade slot.
6. **Docs**: update `docs/zk-lineage.md` §6 (which still describes the VK as
   a placeholder — stale; F44 requires fixing it), `docs/shipped.md`, and
   the `BACKLOG.md` F44 row, in the same commit.

## 8. Current gap inventory (why a real ceremony isn't just "run the scripts")

- `build/pot16_final.ptau` — not in git; exists (if at all) only on the
  original build machine. Mode A tier-1 verification depends on preserving
  and publishing it; otherwise choose Mode B.
- `build/<circuit>.r1cs` — not in git; requires circom 2.x (not installed in
  this environment) with a pinned version to regenerate reproducibly.
- The exact circom version used for the shipped build was never recorded —
  record it (or fix it fresh) at ceremony time.
- Real participants, an announced beacon slot, and a publication channel for
  contribution hashes + the ceremony package.
