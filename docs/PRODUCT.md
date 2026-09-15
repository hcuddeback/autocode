# AutoCode product requirements

**Status:** MVP 1 in development and acceptance

**Current release target:** MVP 1 — ordered JIT task workbook

**Last updated:** 2026-09-15

## Product statement

AutoCode executes an ordered workbook of bounded software tasks through a controlled, resumable delivery loop. It selects the next eligible task, assigns each workflow responsibility to a configured runner/model, enforces deterministic validation and independent review, retains evidence, updates task state, and continues until the workbook completes or a legitimate blocker requires an operator.

Codex CLI is the first supported runner adapter. AutoCode's product identity is the orchestration, evidence, and recovery contract—not Codex, a particular model, or a coding-agent chat interface.

## Product boundary

### AutoCode owns

- The canonical ordered workbook and deterministic task eligibility.
- Durable single-task ownership and dependency-safe continuation.
- JIT planning against the selected task and current repository state.
- Role assignment, runner/model resolution, capability checks, and adapter boundaries.
- Deterministic validation, applicable QA, independent review, and bounded recovery.
- Evidence freshness, immutable task summaries, state updates, auditability, and resume.
- Safe stopping when authority, credentials, policy, or external gates are required.

### Configurable roles own

- `planner`: produce a current implementation plan without changing the worktree.
- `implementer`: make only the selected task's changes in its isolated worktree.
- `reviewer`: independently challenge the result without modifying it.
- `fixer`: address only retained failures/findings before fresh downstream evidence.

A role is a workflow responsibility. A runner is an executable adapter that can perform one or more roles. A model is an optional runner-specific selection. Configuration maps roles to runners/models; it must not grant capabilities the adapter or role does not have.

## Canonical MVP 1 journey

```text
load ordered workbook and retained evidence
  -> select next eligible task and acquire ownership
  -> generate a current JIT plan
  -> implement
  -> deterministically validate
  -> independently review
  -> fix and revalidate/re-review within bounded policy
  -> run applicable QA and repeat bounded recovery after changes
  -> retain immutable evidence and update canonical state
  -> recalculate eligibility
  -> continue, pause, block, fail, or resume without repeating completed effects
```

Initial execution is sequential: one task at a time. The operator may start a bounded workbook run once; AutoCode, not the operator, determines each subsequent eligible task.

## MVP 1 acceptance criteria

| ID    | Criterion                             | Acceptance evidence                                                                                                                                                                                                         |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1-01 | Canonical workbook                    | `tasks/README.md` is the single ordered sequencing/state source; malformed order, dependencies, duplicate IDs, cycles, and contradictory state fail before runner effects.                                                  |
| M1-02 | Configurable roles                    | Planner, implementer, reviewer, and fixer resolve through validated runner/model assignments. Codex is the first adapter; core orchestration and evidence are provider-neutral.                                             |
| M1-03 | Eligible selection and ownership      | The next legal task is selected deterministically, owned durably by one run, and reconciled after interruption without competing execution.                                                                                 |
| M1-04 | Complete task kernel                  | Each task follows JIT plan → implement → validate → independent review → bounded fix/revalidate/re-review → applicable QA. QA findings re-enter bounded recovery and invalidate stale evidence.                             |
| M1-05 | Evidence, state, continuation, resume | A completed/handoff task has an immutable evidence-backed summary; canonical state changes only after applicable gates; readiness is recalculated and the workbook continues or resumes without repeated completed effects. |
| M1-06 | Declared compatibility                | Every supported runner/model/OS/command combination has retained containment and live compatibility evidence; unsupported combinations fail closed and are documented.                                                      |
| M1-07 | Release/security readiness            | CI, dependency/secret checks, license, package identity, private vulnerability reporting, clean install/upgrade/uninstall, help/init, workbook/resume, and artifact verification are complete and recorded.                 |

The canonical derivation and current state of AC-015+ live only in `tasks/README.md`. `docs/MVP_AUDIT.md` reports evidence and gaps but cannot reorder work.

## Historical task IDs

AC-001 through AC-014 are completed delivery records. They established initialization, one-task selection/JIT planning, Codex-specific sessions, verification, review/QA/gate policies, durable execution, the integrated one-task kernel, lifecycle scope, and operator documentation. Their original contracts and evidence remain under `tasks/completed/`.

Those IDs are history, not the current product acceptance numbering. In particular:

- AC-004 proves a Codex-specific session boundary; it does not prove configurable runners/models.
- AC-006 and AC-007 provide fix and QA policies; they do not prove QA-finding recovery through the integrated loop.
- AC-010 and AC-011 prove durable phases and retries; they do not prove workbook-level ownership and continuation.
- AC-012 proves one integrated task in fixtures; it does not update canonical task state or execute the next task.
- AC-013 defers automated remote lifecycle effects; it does not reduce the current MVP 1 workbook target to one task.
- AC-014 documents the current one-task operator experience; it does not accept or release MVP 1.

## Repository lifecycle boundary

MVP 1 automates the local workbook through a verified evidence-backed handoff or a genuine local-only completion. Publication, hosted PR-review observation, merge, deployment, and production verification remain operator-managed unless a later accepted decision adds an adapter and authority.

A PR-required task at verified local handoff is not `done` and cannot satisfy a dependent task. On resume, repository evidence must prove applicable gates and that the target branch contains the predecessor implementation before a dependent task is prepared from that branch. Missing, stale, failed, or contradictory evidence blocks advancement.

Local-only fixtures may advance only with explicit task and operator exceptions plus passing configured completion evidence. Such fixtures prove scheduling/recovery, not remote repository completion.

## JIT planning model

- Product criteria remain stable in this document.
- The canonical workbook contains the ordered outcomes and their derived state.
- Only the single next eligible outcome is materialized into a detailed task contract.
- A fresh implementation plan is generated against that contract and current commit immediately before coding.

Do not pre-author all future task contracts. Reconcile the workbook after each merge and refine only the next row against current reality.

## Non-functional requirements

- Deterministic, inspectable selection and transitions.
- Idempotent or conservatively reconciled effects.
- Bounded inputs, subprocesses, outputs, attempts, and retained evidence.
- Role capability separation and genuinely independent review.
- Secret-safe configuration and evidence; no inherited credential environment.
- Versioned local state that survives interruption.
- Windows, macOS, and Linux only where declared runner containment is accepted.
- No required hosted infrastructure.

## Explicit non-goals for MVP 1

- Parallel task execution or parallel role execution.
- A hosted scheduler, database, or web dashboard.
- Automatic decomposition of a vague idea into a complete project.
- A second production runner/provider implementation.
- Direct provider APIs as a requirement.
- Cross-repository orchestration.
- Automatic remote PR/merge/deploy effects.
- Unbounded autonomous merging or deployment.

## Product success test

Given an ordered disposable workbook with at least five dependent tasks and genuine local-only exceptions, one invocation advances every eligible task through the complete kernel, stops correctly on an inserted blocker, leaves dependents waiting, and resumes without repeating completed effects. A separate PR-required scenario stops at verified handoff and advances a dependent only after current repository evidence proves the predecessor is complete and present in the target branch.

The developer should not have to launch every role, decide what task comes next, relay findings to the fixer, or reconstruct state after interruption.

Release certification uses the reproducible disposable-fixture scenarios above because they do not depend on this repository's own backlog. Once AC-015–AC-017 are merged, the most convincing informal demonstration of the same success test is AutoCode executing its own remaining workbook end to end — see "The dogfooding milestone" in `tasks/README.md`.

## Open decisions

- Public package/binary name and license.
- Exact supported MVP 1 platform matrix if safe containment cannot be accepted on all three desktop platforms.
- Whether model selection is a portable hint or strictly runner-adapter-specific configuration after the Codex adapter is generalized.
