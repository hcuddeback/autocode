# AutoCode task queue

Tasks are JIT implementation contracts, not a wishlist. Product scope belongs in `docs/PRODUCT.md`; later ideas remain coarse until selected.

## Status

| Status | Meaning |
|---|---|
| `ready` | Dependencies resolved; may be selected/refined JIT |
| `in_progress` | Owned by an active run |
| `review` | Implementation complete; gates still running |
| `done` | Acceptance and all applicable gates passed |
| `blocked` | Named blocker prevents progress |
| `later` | Outside the immediate queue/current release |
| `canceled` | Rejected or superseded |

## Current milestone

**Outcome:** One low-risk task runs through persisted phases and deterministic verification, then resumes safely after interruption.

**Evidence:** Fixture integration run and forced-interruption resume test.

**WIP limit:** One active task.

## Immediate queue

`AC-001` is the active foundation task: bootstrap the strict TypeScript CLI foundation and real quality commands.

## JIT task process

1. Select the next MVP outcome—not an unrelated attractive feature.
2. Inspect current code, state, decisions, and dependencies.
3. Copy `TASK_TEMPLATE.md` to `tasks/AC-###.md`.
4. Replace every placeholder and reference only needed documents.
5. Confirm scope, risk, validation, QA/deployment applicability, and blockers.
6. Mark ready only when independently executable.
7. Generate the detailed plan during the run immediately before coding.
8. After gates pass, update the task, queue, and `SYSTEM.md`.

## Completion definition

A task is done only after acceptance, deterministic validation, independent review, applicable QA, configured PR/merge gates, applicable production verification, documentation/current state, and manual steps are handled explicitly.
