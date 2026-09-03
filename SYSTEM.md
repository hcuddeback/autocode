# AutoCode system state

**Last verified:** 2026-09-02

**Stage:** AC-003 JIT planning preparation implemented

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- A strict TypeScript CLI initializes local state, deterministically selects dependency-ready tasks, validates selected task contracts, and prepares commit-bound planning artifacts; the orchestration runtime does not.

## Evidence level

| Claim                         | Evidence                                        | Confidence                                 |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Documentation baseline exists | Repository files and internal-link validation   | High                                       |
| CLI is usable                 | Build, initialization, and selection tests      | High                                       |
| Task selection is implemented | Ready/blocked/malformed/completed fixture tests | High                                       |
| JIT planning is implemented   | Commit/task binding and artifact safety tests   | High                                       |
| Workflow is implemented       | Design contract only                            | High confidence that it is not implemented |

## Known gaps and blockers

- CI, workflow phases, durable run state, and the Codex adapter are absent.
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
- Plan context contains only the selected task snapshot, leaving Codex execution to AC-004.

## Next task

Complete AC-003 gates, then select AC-004 for role-separated Codex CLI sessions.

## Recently completed

- 2026-09-02 — Established the clean repository and documentation baseline.
- 2026-09-02 — Implemented the AC-001 CLI foundation on its feature branch.
- 2026-09-02 — Merged AC-001 through PR #1 and implemented AC-002 task selection on its feature branch.
- 2026-09-02 — Merged AC-002 through PR #2 and implemented AC-003 JIT planning preparation on its feature branch.

Update this file when a major capability, blocker, milestone, or release fact changes.
