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

AC-001 through AC-013 are complete and merged. [AC-012](completed/AC-012.md) completed the integrated local fixture outcome in [PR #14](https://github.com/hcuddeback/autocode/pull/14), merged as 6d72cfd on 2026-09-14. [AC-013](completed/AC-013.md) settled the MVP 1 lifecycle boundary under D-007 in [PR #16](https://github.com/hcuddeback/autocode/pull/16), merged as 38fa030 on 2026-09-14: verified local operator handoff, with remote automation deferred. [AC-014](AC-014.md) is in `review` for the operator guide; runtime scope is unchanged. Later outcomes must be selected and refined JIT against current main; [the MVP audit](../docs/MVP_AUDIT.md), refreshed against merge 6d72cfd on 2026-09-14, records remaining release and external-integration gaps. Recheck current code and dependencies when selecting each outcome.

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
