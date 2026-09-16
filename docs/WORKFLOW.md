# AutoCode workflow

**Status:** current one-task kernel implemented; ordered MVP 1 workbook target in progress

**Last updated:** 2026-09-15

## Authority and planning horizons

1. `docs/PRODUCT.md` owns MVP 1 acceptance and non-goals.
2. `tasks/README.md` is the canonical ordered workbook and state/sequence authority.
3. The single materialized `tasks/AC-###.md` owns immediate implementation scope.
4. A generated run plan is current only for that task, configuration, worktree, and commit.

Audits, `SYSTEM.md`, README files, and completed task prose report evidence; they do not select or reorder work. Unresolved conflicts follow the priority in `AGENTS.md` and must be surfaced.

## Target workbook loop

[The target execution loop in the MVP 1 workbook](../tasks/README.md#target-execution-loop) is canonical. This document defines how that loop derives state, assigns roles, executes the task kernel, and enforces repository handoff boundaries.

Workbook state derivation distinguishes the queue states `READY`, `WAITING`, `BLOCKED`, and `DONE`; the active execution states `RUNNING`, `REVIEWING`, and `FIXING`; and terminal `FAILED`. These derived runtime states do not create a second manual status ledger. They must reconcile from the canonical workbook, task records, durable ownership/effects, and repository evidence.

One task executes at a time. The same workbook run resumes after interruption. It does not repeat completed effects, treat a local handoff as repository completion, or start a dependent from an unmerged predecessor.

## Role assignment

The workflow uses four stable responsibilities:

| Role        | Authority                                                      | Required result                          |
| ----------- | -------------------------------------------------------------- | ---------------------------------------- |
| Planner     | Read-only repository/task context                              | Current bounded implementation plan      |
| Implementer | Selected worktree writes only                                  | Scoped changes and execution identity    |
| Reviewer    | Read-only, independent of implementation                       | Validated findings or pass/block verdict |
| Fixer       | Selected worktree writes limited to retained failures/findings | Scoped correction and execution identity |

Each role resolves through configuration to a runner and optional model. The adapter owns provider-specific invocation and translates output to provider-neutral evidence. Codex CLI is the first and currently only implemented production runner. Existing version-1 configuration without a `roles` map defaults all four roles to Codex; explicit maps must be complete and capability-compatible. Core workflow sequencing now consumes bounded runner results rather than Codex event/session types.

## Task kernel

| Phase                     | Exit evidence                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Intake and ownership      | Eligible task, dependency/repository identity, policy, exclusive durable owner      |
| JIT plan                  | Selected task/current commit binding, plan, risks, validation approach              |
| Implementation            | Diff/workspace digest, assumptions, runner/model/execution identity                 |
| Deterministic validation  | Commands, exits, duration, bounded output, executable and workspace identity        |
| Independent review        | Structured findings, severity/evidence, distinct reviewer identity                  |
| Fix and revalidate        | Finding/failure dispositions plus fresh validation and review                       |
| QA applicability          | Required scenarios or substantive not-applicable reason                             |
| QA and recovery           | Scenario evidence; changes re-enter bounded fix/validation/review/QA                |
| Immutable summary/handoff | Current task/config/runner/model/Git/workspace/evidence binding and remaining gates |
| State transition          | Canonical state update supported by applicable repository evidence                  |

Failures, review findings, and QA findings consume one bounded recovery policy. The fixer addresses only retained evidence. Any code change invalidates validation, review, QA, and later evidence that depended on the prior workspace.

## Current implementation

`autocode run <worktree>` and `autocode resume <worktree>` execute one already-materialized `ready` task. They prepare a plan, invoke fresh Codex planning/implementation/review/fix roles, run deterministic checks, retain receipts, evaluate explicit QA/completion policy, and conservatively resume successful current effects.

Important present limits:

- `select` scans task files by filename; it does not read a canonical workbook sequence or detect graph cycles.
- The runner does not claim/update task ownership, change task metadata, move completed records, or select a successor.
- Only the Codex production adapter is registered; additional runner compatibility is not yet accepted.
- Required QA needs an API-supplied contained adapter; the CLI does not configure scenarios.
- QA findings do not enter automatic bounded fix/revalidation/review/QA recovery.
- A PR-required task stops as `blocked` at the verified local boundary and has no immutable final handoff summary.
- Linux/macOS execution and authenticated live Codex compatibility remain unaccepted.

These are open workbook tasks, not hidden behavior or reasons to preserve the old AC sequence.

## Eligibility and state rules

- Parse every active/completed task identity, dependency, status, and workbook position before runner effects.
- Reject duplicates, missing references, cycles, illegal order/state combinations, and multiple active owners.
- `READY` means the task is materialized, its prerequisites are repository-complete, policy allows execution, and no task is active.
- `WAITING` means an ordered predecessor/dependency is incomplete or the future task is not yet JIT-materialized.
- `BLOCKED` names the external/policy/credential/safety condition preventing progress.
- `DONE` requires applicable repository gates and a completed historical record; local handoff alone is insufficient.
- Runtime state is derived from canonical workbook/task records, durable ownership/effects, and repository evidence. Do not maintain a second manual status ledger.

## Repository handoff boundary

Automated publication, hosted PR-review observation, merge, deployment, and production checks are outside the current local runner. D-005 permits an implementing agent to commit, push, and open a PR after required local gates; human/configured repository gates still control merge.

For a PR-required task, the workbook pauses after a verified local summary. The task remains incomplete and dependents remain waiting. Resume may advance only after current evidence proves applicable gates passed and the target branch contains the predecessor implementation. A fresh dependent worktree starts from that verified target branch.

Disposable local-only tasks may complete with explicit task and operator PR/production exceptions plus current completion evidence. Such exceptions cannot be inferred or reused for a PR-required task.

## Evidence and resume rules

- Persist an attempt/effect identity before invoking an adapter and persist evidence before advancing.
- Bind receipts to workbook/task/config/role/runner/model/Git/workspace and relevant executable/resource identity.
- Successful current receipts may reconcile without repeating an effect.
- Interrupted mutable/model/QA/completion effects remain ambiguous unless the adapter can prove the recorded identity's outcome.
- Stale or forged evidence never advances state.
- Attempts, elapsed budgets, backoff, pauses, blockers, completed tasks, and current ownership survive restart.
- The final per-task summary is immutable; later repository completion appends/references new evidence rather than rewriting history silently.

## Terminal outcomes

- `continued`: task completed under applicable gates and another task became eligible.
- `completed`: no selected workbook work remains and all selected tasks are repository-complete.
- `handoff`: local evidence is ready but an external/human gate owns the next transition.
- `paused`: stopped deliberately at a safe resumable boundary.
- `blocked`: named input, authority, credential, policy, or external state is required.
- `failed`: bounded recovery is exhausted or a terminal safety/correctness failure occurred.
- `canceled`: deliberately ended after effects were reconciled.

Current CLI outcomes remain `completed`, `paused`, `blocked`, or `failed`; the richer workbook outcomes are target behavior and must not be advertised as implemented before their tasks complete.
