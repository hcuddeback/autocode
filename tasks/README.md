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

`AC-010`, `AC-011`, and the AC-010 corrections in PR #13 are merged. `AC-012.md` is the active integration contract on `feat/AC-012-integrated-workflow`, based on main `63e8a49`. Current boundary corrections, verification, fixture QA, and the owner-accepted chat review are recorded in the task. The branch is published as [PR #14](https://github.com/hcuddeback/autocode/pull/14). Existing PR findings must be dispositioned and configured merge gates and human-authorized merge must pass before marking it done. The owner ended further continuous bot-review requests on 2026-09-14; D-005 permits the accepted critical review chat as review evidence. The MVP code audit lives in `docs/MVP_AUDIT.md`; remaining release or external-integration outcomes must be selected JIT after this task rather than implemented on this branch.

## Later review follow-up

After AC-012, consider one bounded maintainability audit of the integrated workflow and Windows containment code. Produce a prioritized list of concrete problems, impacts and verification criteria; select small fixes as separate JIT tasks. Do not repeatedly review PR #14 or make this audit a merge gate. No known security exposure or correctness bug is deferred by this entry; the two latest PR findings are fixed and verified in AC-012.

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
11. After deterministic verification and applicable QA pass, autonomously commit the scoped changes, push the feature branch, and open its required PR. A separate manual or external review is not a publication gate; owner-accepted review chats may supply independent review evidence for completion.
12. Merge only through configured gates and human authorization.
13. After merge gates pass, mark the task `done`, move it to `tasks/completed/`, and update the queue and `SYSTEM.md`.

## Task folders

- Non-completed tasks live directly under `tasks/`.
- Tasks move to `tasks/completed/` only after they reach `done`; completed records remain part of dependency resolution.
- `TASK_TEMPLATE.md` remains at the root of `tasks/`.

## Completion definition

A task is done only after acceptance, deterministic validation, independent review, applicable QA, configured PR/merge gates, applicable production verification, documentation/current state, and manual steps are handled explicitly.
