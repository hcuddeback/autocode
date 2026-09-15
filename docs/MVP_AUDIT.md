# MVP 1 repository and acceptance audit

**Audit date:** 2026-09-15

**Baseline:** `main` at `be5b144` (AC-001–AC-014 plus merged pnpm/setup follow-up)

**Scope:** product, architecture, workflow, CLI/source/tests, JIT task contracts, completed evidence, task index, security/release documents, and operator guides

## Conclusion

The repository contains a heavily tested, durable one-task execution kernel, not the ordered workbook product now defined for MVP 1. AC-001–AC-014 are valid completed historical slices and their evidence remains intact. They do not collectively prove configurable runners/models, workbook-level ownership/continuation, QA-finding recovery, supported live/platform compatibility, or release readiness.

The prior documents contradicted one another by calling the autonomous sequential pipeline “MVP 2” while also saying MVP 1 was incomplete, using an audit/coarse outcome list rather than the task index to choose next work, and hard-coding Codex as both product boundary and implementation. The reconciliation makes `tasks/README.md` canonical, defines stable MVP 1 criteria in `PRODUCT.md`, records the target role/runner/model architecture, and derives AC-015–AC-021 without rewriting history. Only AC-015 is materialized and ready.

No runtime capability or release acceptance is claimed by this documentation reconciliation.

## AC-001–AC-014 reconciliation

| Historical task | Actual code/evidence                                                                                                                                                                                               | Reconciled meaning and remaining gap                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001          | `config.ts` and tests safely initialize validated gitignored local state; quality commands exist.                                                                                                                  | Complete foundation. Config has no role/runner/model assignments; distribution install/upgrade is open.                                                         |
| AC-002          | `tasks.ts` validates active/completed task files and selects the first filename-ordered `ready` task with done dependencies, blocking on active work.                                                              | Complete bounded selector. It does not consume canonical workbook order, detect cycles, persist ownership, or continue.                                         |
| AC-003          | `planning.ts` validates a complete selected contract and creates idempotent commit/task/branch-bound planning artifacts in a linked non-main worktree.                                                             | Complete JIT plan-preparation slice. Task materialization remains operator-authored and future rows must stay coarse.                                           |
| AC-004          | `codex.ts` invokes fresh role strings (`planning`, `implementation`, `review`, `fix`) with distinct session identity, permissions, bounded output, redaction, and containment tests.                               | Complete Codex-specific session slice. Core types/options/prompts remain provider-specific and roles/models are not configurable.                               |
| AC-005          | `verification.ts` runs configured executable/argument arrays and retains bounded fresh evidence tied to Git/workspace/executable identity.                                                                         | Complete reusable validation component. It is not a workbook scheduler or a release certificate.                                                                |
| AC-006          | `fix-loop.ts` and workflow rounds enforce bounded attempts; verification/review changes require fresh evidence.                                                                                                    | Complete policy/component. Integrated QA findings do not feed the same recovery cycle; workflow supports 19 rather than config's reusable 20-round maximum.     |
| AC-007          | `qa.ts` validates applicability and ordered scenarios; integrated workflow persists QA and rejects workspace-changing QA as stale.                                                                                 | Complete QA policy. CLI cannot supply required scenario adapters and QA failure/change requires operator/new-run recovery.                                      |
| AC-008          | `pr-review.ts` validates and dispositions copied findings as resolved/disputed/escalated.                                                                                                                          | Complete policy helper. No hosted PR observation, durable remote repair, or workflow integration; remote automation remains deferred.                           |
| AC-009          | `completion-gates.ts` evaluates exact-head merge and deployment/source-bound production signals; workflow fails closed on missing remote adapters.                                                                 | Complete policy helper. It performs no publication, merge, deploy, or remote observation.                                                                       |
| AC-010          | `durable-run.ts` persists locks, event-before-snapshot transitions, effect identity, pause/resume, and conservative reconciliation; forced-interruption tests prevent duplicate effects.                           | Complete one-run primitive. It does not own a task in the workbook or resume across completed tasks.                                                            |
| AC-011          | Durable retries retain attempts, elapsed budgets, waits, and exponential backoff across restart.                                                                                                                   | Complete reusable policy. CLI quiet hours/configurable pacing are absent but not required for the initial workbook proof.                                       |
| AC-012          | `workflow.ts` composes planning, implementation, validation, independent review, fixes, QA, completion policy, receipts, and resume for one task; extensive fixture/security evidence is retained in the contract. | Complete one-task integration slice. It leaves task status unchanged, emits no immutable final summary, never selects another task, and is coupled to Codex.    |
| AC-013          | D-007 and docs distinguish verified local handoff from repository completion and defer remote automation.                                                                                                          | Complete lifecycle decision. Its former “MVP 1 equals one task” scope is superseded by the current explicit workbook target; the safe handoff boundary remains. |
| AC-014          | User docs accurately describe source setup, current commands, one-task preparation, policy, and conservative recovery; setup follow-up is merged.                                                                  | Complete current-behavior guide. It is not workbook/product/release acceptance and will need updates as AC-015+ land.                                           |

## Current implementation behavior

The CLI exposes `init`, `select`, `prepare`, `sessions`, `verify`, `run`, and `resume`. `run` expects one materialized `ready` task in its declared feature worktree. The integrated phase list is planning, implementation, up to 19 fix rounds interleaved with verification/review, QA, and completion. Existing deterministic and fake-Codex evidence is strong for this boundary.

The implementation does not:

- parse the canonical workbook as an ordered execution plan;
- distinguish future workbook `waiting` state from active task metadata;
- persist exclusive task/workbook ownership;
- resolve roles through configurable runner/model assignments;
- configure required QA through the CLI or recover QA findings automatically;
- produce immutable final handoff/completion summaries;
- update task/workbook state and select/execute a successor;
- prove authenticated live Codex or Linux/macOS execution; or
- satisfy CI, package, license, vulnerability-reporting, dependency/secret-scan, and clean-distribution gates.

## Canonical acceptance/workflow model

`PRODUCT.md` now defines M1-01 through M1-07. `tasks/README.md` is the only sequencing/state authority and maps them to AC-015–AC-021. The ordered control loop is:

[The target execution loop in the MVP 1 workbook](../tasks/README.md#target-execution-loop) is canonical. This audit reports implementation evidence and gaps against that loop; it does not maintain a separate version.

Repository-completion evidence, not a local success claim, controls dependencies. PR-required tasks stop at handoff until operator-managed gates and merged-base reconciliation permit advancement.

## Resolved contradictions and stale guidance

- Removed “MVP 2” as the sequential workbook destination; it is now the MVP 1 product target.
- Replaced audit/coarse-outcome next-task selection with one canonical workbook.
- Separated historical task IDs from current stable product criteria and derived future sequence.
- Reframed Codex as the first adapter, not the architectural owner of workflow responsibilities.
- Distinguished target architecture from the currently Codex-coupled implementation.
- Replaced stale `SYSTEM.md` next-task text that still asked to finish already-merged AC-012.
- Preserved D-007's safe local handoff while superseding its obsolete one-task MVP product boundary.
- Kept remote PR/merge/deploy automation out of scope without allowing local handoff to satisfy dependencies.

## Single next task

AC-015, “Configure provider-neutral workflow roles with a Codex adapter,” is the only ready task. Its executable contract is `tasks/AC-015.md`. Acceptance requires validated planner/implementer/reviewer/fixer assignments, a provider-neutral runner result/capability boundary, preserved Codex containment/default behavior, fail-closed invalid assignments, distinct independent review, receipt freshness/resume, deterministic tests, and disposable fake-runner CLI QA.

## Verification limits for this audit

This reconciliation inspected current source, tests, configuration, documentation, Git history, and all completed task metadata/evidence records. Documentation validation performed for the change is reported in the new task's eventual PR evidence; historical runtime counts are not rerun or promoted here. Authenticated model execution, unsupported operating systems, remote lifecycle behavior, clean package installation, and production remain unverified.
