# AutoCode system state

**Last verified:** 2026-09-02

**Stage:** AC-002 task selection implemented

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- A strict TypeScript CLI initializes local state and deterministically selects dependency-ready tasks; the orchestration runtime does not.

## Evidence level

| Claim                         | Evidence                                        | Confidence                                 |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Documentation baseline exists | Repository files and internal-link validation   | High                                       |
| CLI is usable                 | Build, initialization, and selection tests      | High                                       |
| Task selection is implemented | Ready/blocked/malformed/completed fixture tests | High                                       |
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

- `autocode select` validates the task catalog and selects the first ready task only when every dependency is `done`.
- Twenty tests cover initialization plus ready, blocked, malformed, completed, deterministic-ordering, and symlink-boundary behavior.
- Independent critical review findings on malformed filenames and symlink races were corrected; the fresh review found no actionable defects.

## Next task

Merge AC-002, then select AC-003 for just-in-time task refinement and implementation planning.

## Recently completed

- 2026-09-02 — Established the clean repository and documentation baseline.
- 2026-09-02 — Implemented the AC-001 CLI foundation on its feature branch.
- 2026-09-02 — Merged AC-001 through PR #1 and implemented AC-002 task selection on its feature branch.

Update this file when a major capability, blocker, milestone, or release fact changes.
