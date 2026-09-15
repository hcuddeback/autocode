# AutoCode MVP 1 workbook and task index

**Canonical sequencing/state source:** this file

**Last reconciled:** 2026-09-15 against `main` at `be5b144`

This workbook is the authoritative ordered plan for MVP 1. `docs/PRODUCT.md` owns product acceptance, completed task files retain historical evidence, and an active task file owns the immediate implementation contract. No other roadmap, audit, or prose list may silently reorder work or declare a different next task.

## State rules

| Workbook state | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `done`         | The historical task record and its applicable repository gates are complete.  |
| `ready`        | This is the single materialized task eligible for selection now.              |
| `waiting`      | Ordered MVP 1 work whose predecessor or JIT refinement is incomplete.         |
| `blocked`      | A named external, policy, credential, or safety condition prevents selection. |

Only one row may be `ready`, `in_progress`, or `review` at a time. A `waiting` row is not an active task file and is not visible to the current task loader. When the ready task is completed and reconciled, inspect current `main`, refine only the next row into `tasks/AC-###.md`, and change that row to `ready`. Runtime state must ultimately be derived from this order, task contracts, completed records, durable run evidence, and repository evidence—not copied into a second task board.

## Historical delivery record

AC-001 through AC-014 are completed implementation-history identifiers. They are not renumbered or retroactively redefined to fit the current MVP 1 acceptance sequence.

| Task                          | Historical delivered scope                                     | Reconciled status                                                      |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [AC-001](completed/AC-001.md) | Strict TypeScript CLI and safe local initialization            | `done`; foundation retained                                            |
| [AC-002](completed/AC-002.md) | Deterministic selection of one dependency-ready task           | `done`; selector is not yet a workbook scheduler                       |
| [AC-003](completed/AC-003.md) | Commit-bound JIT task preparation and plan artifacts           | `done`; operator still materializes task contracts                     |
| [AC-004](completed/AC-004.md) | Separate Codex planning/implementation/review session boundary | `done`; provider-specific implementation to be generalized by AC-015   |
| [AC-005](completed/AC-005.md) | Deterministic verification with retained evidence              | `done`; reusable kernel component                                      |
| [AC-006](completed/AC-006.md) | Bounded verification/review fix policy                         | `done`; QA findings are not yet in the same recovery loop              |
| [AC-007](completed/AC-007.md) | QA applicability and scenario evidence policy                  | `done`; required CLI QA and QA-fix recovery remain open                |
| [AC-008](completed/AC-008.md) | PR-review finding disposition policy                           | `done`; remote observation/repair remains deferred                     |
| [AC-009](completed/AC-009.md) | Merge/production gate evaluation policy                        | `done`; remote effects remain operator-managed                         |
| [AC-010](completed/AC-010.md) | Durable phase execution and interruption reconciliation        | `done`; workbook ownership/continuation is not implemented             |
| [AC-011](completed/AC-011.md) | Durable pacing, waits, retry ceilings, and backoff             | `done`; reusable kernel component                                      |
| [AC-012](completed/AC-012.md) | Integrated one-task local workflow fixture                     | `done`; it does not update task state or continue to another task      |
| [AC-013](completed/AC-013.md) | Local operator-handoff boundary                                | `done`; remote lifecycle remains outside current automation            |
| [AC-014](completed/AC-014.md) | Current source-checkout operator guide                         | `done`; it documents the one-task implementation, not MVP 1 completion |

See `docs/MVP_AUDIT.md` for code/evidence traceability and limitations.

## Canonical MVP 1 sequence

These tasks are derived from the current acceptance criteria in `docs/PRODUCT.md`. IDs after AC-014 describe new work only; they do not replace the completed history above.

| Order | Task                | Workbook outcome                                                                                                                           | Product criteria | State                                  |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------- |
| 1     | [AC-015](AC-015.md) | Configure role-to-runner/model assignments behind a provider-neutral execution contract; keep Codex as the first adapter                   | M1-02            | `ready`                                |
| 2     | AC-016              | Load the ordered workbook, derive the next eligible task, and acquire durable single-task ownership                                        | M1-01, M1-03     | `waiting` on AC-015 and JIT refinement |
| 3     | AC-017              | Complete the role-neutral task kernel, including required CLI QA and bounded QA fix/revalidate/review/QA recovery                          | M1-04            | `waiting` on AC-016 and JIT refinement |
| 4     | AC-018              | Retain an immutable task summary, update canonical state, recalculate eligibility, and continue/resume without repeating completed effects | M1-05            | `waiting` on AC-017 and JIT refinement |
| 5     | AC-019              | Prove supported-platform containment and authenticated live compatibility for declared runner/model combinations                           | M1-06            | `waiting` on AC-018 and JIT refinement |
| 6     | AC-020              | Prove the ordered workbook end to end, including blocker/waiting/resume and PR-required handoff behavior                                   | M1-01–M1-06      | `waiting` on AC-019 and JIT refinement |
| 7     | AC-021              | Close CI, dependency/secret checks, licensing, package identity, clean install/upgrade/uninstall, and release evidence                     | M1-07            | `waiting` on AC-020 and JIT refinement |

The single next task is AC-015. Do not materialize AC-016 until AC-015 is merged, its evidence is reconciled here, and current code is re-inspected.

**Note on AC-015 and a second runner adapter:** a second production runner/model integration remains explicitly out of MVP 1 scope. If, while implementing AC-015's runner-adapter boundary, exposing the existing test-only fake/stub Codex runner as a second minimally configured adapter is genuinely low-cost, it may be included to prove the abstraction is real rather than a single-implementation interface — but this is opportunistic, not a gate on AC-015 completion, and must not expand AC-015's scope, timeline, or require a second live model/provider.

## The dogfooding milestone

The most concrete proof that MVP 1 works is AutoCode executing its own remaining workbook: once AC-016 lands, point a workbook run at this repository's own `tasks/README.md` and let AutoCode select, implement, validate, and review AC-017 onward under its own supervised loop, stopping only at genuine blockers (for example, a PR-required handoff). This is a substantially more convincing demonstration than a synthetic fixture and should be treated as the milestone to aim for once AC-015–AC-017 are merged, alongside (not instead of) the deterministic disposable-fixture acceptance scenarios in `docs/PRODUCT.md`, which remain required for release certification because they are reproducible and do not depend on this repository's own remaining backlog.

## Target execution loop

```text
load canonical workbook and evidence
  -> select the next eligible task
  -> acquire durable ownership
  -> generate a current JIT plan
  -> implement with the configured implementer
  -> run deterministic validation
  -> independently review with the configured reviewer
  -> fix with the configured fixer and revalidate/re-review as needed
  -> run applicable QA and repeat bounded recovery when code changes
  -> retain immutable evidence and update canonical task state
  -> recalculate eligibility
  -> continue, pause, block, fail, or resume without repeated effects
```

Initial WIP remains one executing task. Parallel execution, a hosted control plane, a web dashboard, automatic vague-idea decomposition, cross-repository scheduling, automatic merge/deploy, and additional runner implementations are outside MVP 1. The architecture must permit later runner adapters without promising them now.

## JIT materialization process

1. Select only the first `ready` row in this workbook.
2. Inspect current code, completed evidence, dependencies, decisions, risk, and blockers.
3. Create or refine only that task from `TASK_TEMPLATE.md`; replace every placeholder.
4. Confirm acceptance, deterministic validation, QA, security, publication, and manual gates.
5. Implement from the declared feature branch and isolated worktree, never `main`.
6. Execute implementation, validation, independent review, bounded fixes, revalidation, and applicable QA.
7. Retain evidence before changing task/workbook state. Code changes invalidate stale downstream evidence.
8. Complete repository gates, move the task record to `tasks/completed/`, reconcile this workbook and `SYSTEM.md`, then materialize at most one successor.

## Task folders

- The one materialized non-completed task lives directly under `tasks/`.
- Completed records live under `tasks/completed/` and remain part of dependency/evidence resolution.
- `TASK_TEMPLATE.md` is the template, not a queue entry.

## Completion definition

A task is `done` only when its acceptance criteria, deterministic validation, independent review, applicable QA, configured repository gates, evidence retention, documentation/state updates, and manual dispositions are complete. A local handoff may stop a run safely, but it does not by itself make a PR-required repository task `done` or satisfy downstream dependencies.
