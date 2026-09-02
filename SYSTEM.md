# AutoCode system state

**Last verified:** 2026-09-02

**Stage:** AC-001 foundation implemented

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- No executable AutoCode CLI or orchestration runtime exists in this repository yet.

## Evidence level

| Claim | Evidence | Confidence |
|---|---|---|
| Documentation baseline exists | Repository files and internal-link validation | High |
| CLI is usable | `pnpm build` and CLI initialization smoke test | High |
| Workflow is implemented | Design contract only | High confidence that it is not implemented |

## Known gaps and blockers

- CI, workflow phases, durable run state, and Codex adapter are absent.
- No workflow phase, durable state, or Codex adapter is implemented.
- License has not been selected and added.

## Current milestone

**Outcome:** Execute one low-risk task locally through persisted phase transitions and deterministic verification, including interruption-safe resume.

**Evidence expected:** A fixture repository completes a recorded run; terminating and resuming does not repeat completed side effects.

**Stop condition:** Pause scope expansion if the vertical slice requires a hosted service, direct provider API, or broad multi-agent runtime.

## AC-001 evidence

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `autocode init` creates `.autocode/config.yaml`, state directories, and a `.gitignore` rule without overwriting valid configuration.

## Next task

Complete AC-001 gates, then select the workflow runtime task.

## Recently completed

- 2026-09-02 — Established the clean repository and documentation baseline.

Update this file when a major capability, blocker, milestone, or release fact changes.
