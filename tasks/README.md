# AutoCode task queue

Tasks are JIT implementation contracts, not a wishlist. Product scope belongs in `docs/PRODUCT.md`; later ideas remain coarse until selected.

## Status

| Status        | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `ready`       | Dependencies resolved; may be selected/refined JIT |
| `in_progress` | Owned by an active run                             |
| `review`      | Implementation complete; gates still running       |
| `done`        | Acceptance and all applicable gates passed         |
| `blocked`     | Named blocker prevents progress                    |
| `later`       | Outside the immediate queue/current release        |
| `canceled`    | Rejected or superseded                             |

## Current milestone

**Outcome:** One low-risk task runs through persisted phases and deterministic verification, then resumes safely after interruption.

**Evidence:** Fixture integration run and forced-interruption resume test.

**WIP limit:** One active task.

## Immediate queue

`AC-004` is in review on `feat/AC-004-codex-sessions`: implementation and local gates pass; independent Codex review, PR, Codex PR review, and human merge authorization remain.

## JIT task process

1. Select the next MVP outcome—not an unrelated attractive feature.
2. Inspect current code, state, decisions, and dependencies.
3. Copy `TASK_TEMPLATE.md` to `tasks/AC-###.md`.
4. Replace every placeholder and reference only needed documents.
5. Confirm scope, risk, validation, QA/deployment applicability, and blockers.
6. Mark ready only when independently executable.
7. Create `feat/AC-###-slug` from current `main` and attach it to a separate worktree.
8. Confirm implementation is running from that feature branch/worktree; stop if the current branch is `main`.
9. Generate the detailed plan immediately before coding.
10. Implement and run deterministic verification, independent critical review, fixes, and applicable QA.
11. Only after those implementation gates pass, push the feature branch and open its required PR.
12. Merge only through configured gates and human authorization.
13. After merge gates pass, mark the task `done`, move it to `tasks/completed/`, and update the queue and `SYSTEM.md`.

## Task folders

- Non-completed tasks live directly under `tasks/`.
- Tasks move to `tasks/completed/` only after they reach `done`; completed records remain part of dependency resolution.
- `TASK_TEMPLATE.md` remains at the root of `tasks/`.

## Completion definition

A task is done only after acceptance, deterministic validation, independent review, applicable QA, configured PR/merge gates, applicable production verification, documentation/current state, and manual steps are handled explicitly.
