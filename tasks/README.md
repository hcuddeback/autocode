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

## Product direction

MVP 1 is the durable **single-task execution kernel**. It is not the final product boundary.

The next product milestone is **MVP 2 — autonomous task pipeline**: one operator invocation selects a bounded batch, AutoCode calculates legal READY work, executes tasks through the existing implementation/validation/review/fix kernel, persists outcomes, recalculates readiness and continues until the batch completes or a legitimate blocker/human gate stops progress.

The product differentiator is orchestration above coding agents. Codex CLI is the first worker backend; AutoCode should not duplicate Codex chat/IDE functionality.

## Current milestone

**Outcome:** Finish acceptance/documentation of the single-task kernel, then begin the smallest dependency-safe multi-task pipeline.

**MVP 2 proof:** A five-task dependency chain can be started once, advance automatically through runnable tasks, stop correctly on a blocker, leave downstream tasks waiting and resume without repeating completed work.

**Initial WIP:** One task executing at a time. Parallel task execution is explicitly deferred.

## Immediate queue

AC-001 through AC-013 are complete and merged. AC-014 is in `review` for the current operator guide; finish its existing gates without expanding its runtime scope.

After AC-014 closes, select/refine the next JIT tasks against current `main` for MVP 2 in this order of outcomes:

1. **Task graph/readiness model** — load active + completed task contracts, validate dependency references/cycles and derive deterministic READY/WAITING/BLOCKED/DONE state.
2. **Bounded batch selection** — define and implement the smallest explicit batch contract (for example task list or `--through <task>` over an ordered queue).
3. **Sequential pipeline loop** — reuse the existing single-task kernel, finalize/persist each task outcome, recalculate readiness and advance without another operator prompt.
4. **Durable batch resume** — persist batch identity/current task/completed work/blockers/remaining work and reconcile after interruption without repeating completed side effects.
5. **Five-task dogfood acceptance** — run a controlled dependency chain end-to-end, including at least one legitimate blocker/resume scenario, and retain evidence.

Do not pre-number or over-specify all five implementation contracts now. Create each task JIT after inspecting the merged state from the preceding outcome. The outcome sequence above is the task board until those contracts materialize.

## Deferred until the pipeline proof passes

- Parallel workers/tasks.
- Hosted scheduler or control plane.
- Web dashboard.
- Automatic vague-idea-to-project decomposition.
- Multiple model/provider backends.
- Cross-repository orchestration.
- Jira/Slack integrations.
- Unbounded autonomous merge/deploy.
- Automatic JIT task materialization from coarse project outcomes.

These may become later milestones; they must not distract from proving unattended sequential advancement first.

## JIT task process

1. Select the next approved milestone outcome—not an unrelated attractive feature.
2. Inspect current code, state, decisions, dependencies and the latest merged task evidence.
3. Copy `TASK_TEMPLATE.md` to `tasks/AC-###.md`.
4. Replace every placeholder and reference only needed documents.
5. Confirm scope, risk, validation, QA/deployment applicability and blockers.
6. Mark ready only when independently executable.
7. Create `feat/AC-###-slug` from current `main` and attach it to a separate worktree.
8. Confirm implementation is running from that feature branch/worktree; stop if the current branch is `main`.
9. Generate the detailed implementation plan immediately before coding.
10. Implement and run deterministic verification, independent critical review, fixes and applicable QA.
11. After deterministic verification and applicable QA pass, autonomously commit the scoped changes, push the feature branch and open its required PR under standing contribution authority.
12. Merge only through configured gates and human authorization unless a later explicit repository policy changes that boundary.
13. After merge gates pass, mark the task `done`, move it to `tasks/completed/`, update this queue and update `SYSTEM.md` where current system reality changed.
14. For MVP 2 pipeline tasks, preserve task-graph and resume semantics so the same contracts can later be consumed automatically rather than only by an operator.

## MVP 2 execution-state target

The pipeline should be able to distinguish at least:

- `READY` — legal to execute now.
- `WAITING` — dependency not complete.
- `BLOCKED` — explicit blocker/human action prevents progress.
- `RUNNING` — owned by the active pipeline run.
- `REVIEWING` / `FIXING` — current task is inside existing kernel phases.
- `DONE` — applicable repository completion evidence is satisfied.
- `FAILED` — terminal execution failure requiring intervention.

Do not create a second competing task-status source merely to obtain these labels. Derive runtime state from task contracts, durable run state and repository evidence with explicit reconciliation rules.

## Task folders

- Non-completed tasks live directly under `tasks/`.
- Tasks move to `tasks/completed/` only after they reach `done`; completed records remain part of dependency resolution.
- `TASK_TEMPLATE.md` remains at the root of `tasks/`.

## Completion definition

A repository task is done only after acceptance, deterministic validation, independent review, applicable QA, configured PR/merge gates, applicable production verification, documentation/current state and manual steps are handled explicitly.

A pipeline run may stop before repository tasks are `done` when a configured human/external gate owns the next transition. Such a stop must be explicit and must not cause dependent work to be treated as complete.
