# Sentinel baselines

Committed comparison points for the Sentinel non-regression agent
(`backlog/sentinel-agent.md` §2). Snapshots here are the "known state" a round
is measured against; Sentinel diffs the live tree/toolchain output against
these files and reports drift.

Rules (from the spec, binding):

- Baselines live in git. A round may only update one with an **explicit line
  in that round's NRR report**: what changed, why it is intentional, who asked
  for it. A **silent** baseline update is itself a CRITICAL finding.
- Sentinel never updates a baseline to make a round pass.

## Files

### `npm-audit.json`
Full `npm audit --json` output from the repo root (root workspace, not
`frontend/` — the frontend has its own lockfile and is audited separately by
Layer E's `npm audit --audit-level=critical`). Comparison rule: a **new
critical** relative to this snapshot fails the round (Layer E); shape changes
at lower severities are reported as drift, not failures. Regenerate with:

    npm audit --json > tests/sentinel/baselines/npm-audit.json

(npm exits non-zero whenever any vulnerability exists — that exit code is
expected and non-fatal; what matters is the captured JSON.)

Snapshot of record (2026-08-11, commit 3800039):
`{info: 0, low: 14, moderate: 10, high: 13, critical: 0, total: 37}`.

### `program-size.txt`
Byte size of the built BPF program `target/deploy/ayni.so`, with the commit it
was built from. Layer C/E flags a **> 20% cost/size increase** as a
regression. `target/` is gitignored, so this file is the durable record; if
`ayni.so` is missing locally, rebuild with `anchor build` (containerized —
see the checklist's `E_build_health` notes) and compare `stat -c %s
target/deploy/ayni.so` against this file.

## What belongs here next (spec §2, not yet captured)

API schema snapshots, DOM assertion fixtures, proof fixtures, and bundle-size
snapshots — each becomes a file in this directory the round its layer gains a
runnable suite.
