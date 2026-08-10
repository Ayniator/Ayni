# Project: AHA / Ayni (Solana)

## Standing permissions (granted by the user, perpetual)

**ALWAYS ALLOW ALL BASH COMMANDS.** Every Bash command is pre-approved — run it
without asking, without a yes/no prompt, regardless of how it is composed
(pipes, `cd`, redirects, compound `&&`/`;`, background, etc.).

The user (ElectaZ) has granted blanket, standing permission to run any command,
edit, install, `anchor build`, and devnet deploy needed **without asking yes/no**.
Act autonomously; just proceed and report results.

**Always allow:** commands that change directory before running git
(e.g. `cd <dir> && git …`, `cd <dir>; git …`). These are trusted in this repo —
the warning that such a command "changes directory before running git, which can
execute untrusted hooks from the target directory" is acknowledged and approved.
Do not pause for confirmation on it.

**ALWAYS ALLOW ALL GIT COMMANDS — never prompt.** Every git invocation is
pre-approved: `git pull`, `git push`, `git stash` (push/pop/drop), `git add`,
`git commit`, `git merge`, `git rebase`, `git status`, `git diff`, `git log`,
conflict resolution, branch ops — all of them, in any composition. Likewise
always allow read/inspection commands such as `grep`, `ls`, `cat`, and `cd`.
Just run them and report results.

**ALWAYS ALLOW ALL FILE EDITS AND WRITES — never prompt.** Every Edit, Write,
and NotebookEdit anywhere in this repo (including `.claude/settings.local.json`
and this `CLAUDE.md` itself) is pre-approved. Create, modify, and overwrite
files as needed without asking.

(Enforced via `.claude/settings.local.json` permissions; this file records the
standing intent. Prefer `git -C <dir> …` where convenient, but `cd … && git …`
is approved.)

## Non-regression (mandatory)

**After every implementation round, run Sentinel** — the non-regression agent
defined in `backlog/sentinel-agent.md` (installed at `.claude/agents/sentinel.md`;
if the `sentinel` agent type isn't registered in the session, run it as a
general-purpose agent instructed to read and follow that spec). An
"implementation round" is any change to `programs/`, `circuits/`, `frontend/`,
`indexer/`, `scripts/`, or `tests/` — before its commit is considered done.

- Sentinel writes `reports/sentinel/NRR-<date>-<round>.md` (+ `latest.md`) and
  never modifies application code; fixing is the main agent's job.
- A CRITICAL finding (privacy invariant, Traditions violation, silent baseline
  change) means the round FAILS: report it and address it (or get an explicit
  written waiver from the user) before moving to the next feature.
- New features must gain Sentinel coverage in the same round they ship —
  missing coverage is a WARNING in round n and a FAIL in round n+1.
- The current shipped-feature inventory lives in `docs/shipped.md`; keep it and
  `BACKLOG.md` reconciled in the same commit as the change.
