# AutoCode architecture

**Status:** MVP 1 target architecture; current implementation partially conforms

**Last updated:** 2026-09-15

## Goals and constraints

- Execute one canonical ordered workbook sequentially and durably.
- Keep workflow roles configurable without coupling orchestration to a provider or model.
- Ship Codex CLI as the first runner adapter and preserve current containment behavior.
- Prefer inspectable files and narrow adapters over hosted infrastructure.
- Protect repositories, durable evidence, and unrelated work; store secret references only, never raw credentials, and fail safely when persisted state is detected as corrupt.

## System context

```text
operator
  -> AutoCode CLI
      -> workbook scheduler / durable ownership
          -> task kernel / policy gates
              -> role resolver
                  -> planner assignment     -> runner adapter -> optional model
                  -> implementer assignment -> runner adapter -> optional model
                  -> reviewer assignment    -> runner adapter -> optional model
                  -> fixer assignment       -> runner adapter -> optional model
              -> deterministic validation and QA adapters
          -> evidence store / immutable summary / canonical state update
          -> recalculate next eligible task / continue or resume
```

## Core concepts

| Concept     | Responsibility                                                                                 | Must not own                                            |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Workbook    | Ordered task identity, dependencies, intended state, and next-work authority                   | Model prompts, process details, duplicate runtime state |
| Role        | Stable workflow responsibility and required capabilities                                       | Provider/model implementation details                   |
| Runner      | Executable adapter contract for preflight, invoke, reconcile, and bounded evidence             | Workbook sequencing or permission expansion             |
| Model       | Optional runner-specific selection retained as execution identity                              | Workflow control or authority                           |
| Task kernel | Ordered phases, evidence freshness, bounded recovery, and terminal outcome                     | Provider-specific event formats                         |
| Scheduler   | Eligibility, durable ownership, state reconciliation, and continuation                         | Task implementation details                             |
| Adapter     | Provider/tool-specific command, prompt, parsing, containment resources, and result translation | Core task/workbook semantics                            |

## Role contract

The required role names are `planner`, `implementer`, `reviewer`, and `fixer`. Each configuration entry selects a registered runner and may select a model understood by that runner. Before durable or model effects, resolution must validate:

- every required role is assigned exactly once;
- the runner exists and supports the role and required read/write authority;
- the model identifier is valid for that runner's declared rules;
- independent review uses a distinct execution identity from the implementation effect;
- adapter inputs, executable resources, time/output limits, and containment are valid; and
- configuration contains identifiers/references, never copied credentials.

Provider-specific prompts and event parsing stay inside the adapter. The core receives bounded immutable role results containing role, runner/model identity, execution identity, outcome, evidence references, workspace/effect identity, and a safe reason. Adapter prose cannot override deterministic gates.

## First adapter: Codex CLI

The existing `src/codex.ts` process path is the behavior to preserve while extracting the contract. Codex remains the default runner for all four roles until configuration says otherwise. Fresh scoped invocations are acceptable; native conversation continuation is not required. Planner/reviewer remain read-only, implementer/fixer receive bounded worktree-write access, and all roles retain existing Windows AppContainer/Job containment, redaction, output/time bounds, protected-state checks, and conservative interrupted-effect behavior.

Supporting another runner later should require registering an adapter and its capabilities, not adding runner-specific branches to the scheduler or task kernel.

## Workbook and state

`tasks/README.md` is the canonical human-readable MVP 1 workbook. Completed contracts in `tasks/completed/` retain history/evidence; only the single next JIT task is materialized at `tasks/AC-###.md`. The runtime scheduler must parse or consume a bounded machine-valid representation of that same authority without creating a second manually maintained board.

```text
.autocode/
  config.yaml
  runs/<workbook-run-id>/
    run.json
    events.jsonl
    tasks/<task-id>/
      ownership.json
      receipts/
      summary.json
```

Exact schema/layout is selected JIT. Required invariants are versioned state, append-before-snapshot transitions, atomic publication, stable effect identities, task/workbook/config/runner/model/Git/workspace binding, and safe reconciliation of stale locks or interrupted effects.

Canonical repository state changes only after the evidence summary is durable and applicable repository gates pass. A PR-required handoff remains non-complete; dependent work stays waiting.

## Task-kernel phases

The canonical execution-loop diagram is [the target execution loop in the MVP 1 workbook](../tasks/README.md#target-execution-loop). Architecturally, its task-kernel steps resolve planner, implementer, reviewer, and fixer assignments through the role contract above, while validation, QA, evidence, and state transitions remain core workflow responsibilities.

Successful existing receipts can reconcile without repeating their effect when every binding is current. Ambiguous effects block. Changes invalidate downstream evidence.

## Current implementation map

- `tasks.ts` loads task contracts and selects one ready task; it does not parse workbook order, detect dependency cycles, own work durably, or continue.
- `planning.ts` prepares commit/task-bound artifacts.
- `runner.ts` owns provider-neutral roles, capabilities, assignment resolution, invocation, and bounded result validation.
- `codex-runner.ts` maps those roles to the contained Codex process/session implementation in `codex.ts`.
- `workflow.ts` invokes resolved roles and executes one task through verification/review/fix/QA/completion phases.
- `verification.ts`, `qa.ts`, `pr-review.ts`, and `completion-gates.ts` provide bounded policy/evidence components.
- `durable-run.ts` provides locks, effect identity, reconciliation, retry/pacing, and persisted transitions for one phase list.
- `windows-sandbox.ts` provides the accepted Windows containment path; Linux/macOS fail closed.

AC-015 separates the role/runner/model contracts while retaining Codex as the only production adapter. Later canonical workbook rows add scheduling, ownership, QA recovery, summary/state continuation, compatibility, end-to-end acceptance, and release gates in that order.

## Failure and recovery

- Invalid workbook/configuration/capability → fail before runner effects.
- Interruption → validate identity, acquire/reconcile ownership, then resume from the first incomplete safe transition.
- Ambiguous effect → block for operator reconciliation; never replay blindly.
- Failed validation/review/QA → enter the same bounded recovery policy when safe.
- Changed code/config/runner/model/executable/evidence input → invalidate affected downstream receipts.
- External or human gate → persist an explicit handoff/blocker; do not mark done or advance dependents.

## Testing strategy

- Unit: workbook grammar/order/dependencies, role/config schemas, adapter result validation, eligibility, transitions, and retry policy.
- Integration: runner preflight/invocation, subprocess containment, worktrees, evidence freshness, ownership, state updates, and recovery.
- End to end: five-task local workbook success/block/resume plus PR-required handoff/reconciliation.
- Compatibility: authenticated live runner/model matrices on every declared OS/command set.
- Security: traversal, capability escalation, malicious task/model output, redaction, credentials, Git helpers, and forged/stale evidence.
- Package: clean install/upgrade/help/init/workbook/resume/uninstall preservation.

## Complexity gate

MVP 1 uses one executing task and local files. Do not add parallel tasks, a hosted queue/database, a web UI, or automatic remote merge/deploy to solve the sequential workbook proof.
