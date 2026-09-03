# AutoCode system state

**Last verified:** 2026-09-03

**Stage:** AC-005 deterministic verification implemented on its feature branch

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- A strict TypeScript CLI initializes local state, selects dependency-ready tasks, prepares commit-bound planning artifacts, invokes scoped role-separated Codex sessions, and runs configured deterministic checks with retained evidence; durable phase orchestration does not exist yet.

## Evidence level

| Claim                         | Evidence                                        | Confidence                                 |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Documentation baseline exists | Repository files and internal-link validation   | High                                       |
| CLI is usable                 | Build, initialization, and selection tests      | High                                       |
| Task selection is implemented | Ready/blocked/malformed/completed fixture tests | High                                       |
| JIT planning is implemented   | Commit/task binding and artifact safety tests   | High                                       |
| Codex session roles exist     | Fake-Codex subprocess and failure-path tests    | High                                       |
| Verification evidence exists  | Deterministic subprocess and artifact fixtures  | High                                       |
| Workflow is implemented       | Design contract only                            | High confidence that it is not implemented |

## Known gaps and blockers

- CI, workflow phases, bounded fix loops, durable run state, and session resume are absent.
- License has not been selected and added.

## Current milestone

**Outcome:** Execute one low-risk task locally through persisted phase transitions and deterministic verification, including interruption-safe resume.

**Evidence expected:** A fixture repository completes a recorded run; terminating and resuming does not repeat completed side effects.

**Stop condition:** Pause scope expansion if the vertical slice requires a hosted service, direct provider API, or broad multi-agent runtime.

## AC-001 evidence

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `autocode init` creates `.autocode/config.yaml`, state directories, and a `.gitignore` rule without overwriting valid configuration.

## AC-002 evidence

- `autocode select` validates the task catalog and selects the first ready task only when every dependency is `done` and no task is already active.
- Tests cover initialization plus ready, active-work, blocked, malformed, completed, deterministic-ordering, untrusted-title, and symlink-boundary behavior.
- Independent and Codex PR-review findings on malformed filenames, filesystem replacement races, single-task WIP enforcement, and terminal-safe titles were corrected and reverified.

## AC-003 evidence

- `autocode prepare` validates the selected task contract and rejects template placeholders or missing required sections.
- Planning metadata and the task snapshot are bound to the selected task digest, source path, branch, and current commit.
- Repeated preparation preserves an edited plan; conflicting or symlinked artifacts fail safely.
- Preparation rejects dirty worktrees and branches that differ from the selected task contract.
- Preparation requires a linked worktree, validates declared Git branch names, and rechecks Git/task identity immediately before publishing artifacts.
- Planning-directory identities are revalidated around artifact creation, inspection, cleanup, and publication.
- Task validation rejects the editable placeholder prompts from `tasks/TASK_TEMPLATE.md`.
- Plan context contains only the selected task snapshot, leaving Codex execution to AC-004.

## AC-004 evidence

- `autocode sessions` consumes the commit-bound preparation and starts fresh implementation and independent-review Codex CLI sessions.
- The sessions directory is reserved atomically before Codex starts, so concurrent invocations cannot share or overwrite a run.
- Implementation uses the cross-version Codex workspace-write interface; review uses a read-only sandbox against uncommitted changes.
- Valid distinct thread identities and bounded JSONL, stderr, final message, and metadata are retained per role.
- Review starts only while the prepared branch and commit remain unchanged, implementation changes remain uncommitted, and protected `.autocode` plus ignored credential state remains identical; captured output and arguments are redacted using environment values, dotenv/JSON/YAML credential values, and known secret formats before persistence.
- Timeout and output-limit termination escalate to forceful process-tree shutdown and return within a fixed grace period. Default Linux Codex sessions run in a transient systemd user unit, providing kernel-enforced cgroup containment for daemonized descendants; unsupported non-Windows platforms fail closed.
- Non-`EPIPE` prompt-delivery failures terminate the subprocess before reporting failure, and successful sessions require a non-empty final
  agent message.
- Deterministic fake-Codex tests cover scoped prompts plus malformed events, missing final messages, duplicate identity, Git-state, protected-state and credential-state drift, timeout, output overflow, concurrent reservation, multi-format credential redaction, stale preparation, existing artifacts, and failed exits.

## AC-005 evidence

- `autocode verify` validates configured executable-and-argument arrays and runs them sequentially without a shell from the prepared worktree.
- The evidence directory is reserved before execution; each attempted check retains bounded redacted output, command identity, timing, exit status, and the prepared Git branch and commit.
- Verification stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change, retaining partial evidence and refusing to overwrite an existing run.
- Fixture tests cover successful sequences, partial failure, timeout, overflow, stale preparation, artifact collision, and unsafe configuration.

## Next task

Complete AC-005 review and PR gates, then select AC-006 for bounded fix loops.

## Recently completed

- 2026-09-02 — Established the clean repository and documentation baseline.
- 2026-09-02 — Implemented the AC-001 CLI foundation on its feature branch.
- 2026-09-02 — Merged AC-001 through PR #1 and implemented AC-002 task selection on its feature branch.
- 2026-09-02 — Merged AC-002 through PR #2 and implemented AC-003 JIT planning preparation on its feature branch.
- 2026-09-02 — Merged AC-003 through PR #3 and selected AC-004 for role-separated Codex CLI sessions.
- 2026-09-02 — Implemented the AC-004 Codex session boundary on its isolated feature worktree.
- 2026-09-03 — Merged AC-004 through PR #4 and implemented AC-005 deterministic verification on its isolated feature worktree.

Update this file when a major capability, blocker, milestone, or release fact changes.
