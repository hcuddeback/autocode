# AutoCode product requirements

**Status:** MVP 1 execution kernel implemented/in acceptance; next product milestone approved

**Current release:** MVP 1 — one-task durable workflow foundation

**Next milestone:** MVP 2 — autonomous task pipeline

**Last updated:** 2026-09-14

## Product statement

AutoCode turns a structured engineering plan into a controlled, resumable software-delivery pipeline. It determines runnable work, delegates implementation and independent review to coding agents, enforces project policy and acceptance criteria, preserves execution evidence, and advances the project until human judgment or an external gate is required.

Codex CLI is the first execution backend. AutoCode is not intended to duplicate Codex chat or become another coding model interface; its product value is orchestration above the coding agent.

## Product boundary

### Codex owns

- Repository-aware implementation work.
- Code edits and bounded fixes.
- Model-assisted planning and critical review within supplied scope.

### AutoCode owns

- Structured task contracts and task state.
- Dependency/readiness resolution.
- Selection of the next legal unit of work.
- Durable execution phases and resume behavior.
- Deterministic validation and QA policy.
- Independent-review and bounded-fix loops.
- Evidence retention and auditability.
- Repository lifecycle orchestration as later milestones admit it.
- Stopping and escalating when human judgment, credentials, policy, or external gates are required.

## Evidence and assumptions

### Verified

- Earlier prototypes demonstrated useful task parsing, dependency readiness, worktree, validation, state, GitHub, and policy concepts.
- The current MVP 1 implementation demonstrates a durable single-task local execution kernel with isolated work, deterministic verification, review/fix phases, evidence and interruption-safe resume in fixtures.
- A hosted control plane and direct provider APIs are unnecessary for the first CLI milestones.

### Assumptions to test next

- The single-task kernel can be composed into a reliable sequential task pipeline without weakening task isolation or evidence guarantees.
- AutoCode can calculate READY work from repository task contracts and completed records without requiring the operator to choose every next task.
- Several tasks can execute unattended until a legitimate blocker or configured human gate is reached.
- Codex CLI remains useful as the first worker backend while orchestration contracts stay backend-neutral.

### Unknown

- Appropriate unattended batch size and pacing across subscription and machine constraints.
- When parallel execution provides enough value to justify concurrency complexity.
- Which remote GitHub lifecycle actions belong in the first public product release versus a later milestone.
- When additional coding/review backends are justified.

## Operating levels

AutoCode should converge on three operating levels using the same task contracts and execution kernel:

1. **Task** — execute one explicitly selected task.
2. **Batch** — execute a selected set/range of tasks in dependency-safe order until complete or blocked.
3. **Project** — repeatedly select READY work from the project task graph and continue until no legal work remains or human intervention is required.

MVP 1 proves Task mode. MVP 2 proves Batch mode. Project mode follows only after Batch mode is trustworthy.

## MVP 1 — execution kernel

### Primary journey

1. Approve an MVP document and small ordered queue.
2. Select the next ready outcome and create/refine its task just in time.
3. Generate a fresh implementation plan against the current repository.
4. Implement in an isolated worktree through Codex CLI.
5. Run deterministic checks and independent critical review.
6. Perform bounded fixes and applicable QA.
7. Retain a verified local handoff or an explicit local-only completion, or stop safely as blocked/failed/paused; support later resume.
8. The operator handles publication, PR review, merge and applicable production verification through repository policy before declaring the repository task done.

### Functional requirements

| ID                        | Requirement                                              | Acceptance evidence                                                           |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| AC-001                    | Initialize project-local configuration and state safely. | A fixture receives validated, gitignored configuration without overwrites.    |
| AC-002                    | Select one ready task with satisfied dependencies.       | Tests cover ready, blocked, malformed, and completed tasks.                   |
| AC-003                    | Create/refine task detail and plan just in time.         | Artifacts reference the selected task/current commit and exclude later work.  |
| AC-004                    | Run role-separated Codex CLI sessions.                   | Implementation and review have distinct session identities and scoped inputs. |
| AC-005                    | Run deterministic verification and retain evidence.      | Commands, exits, duration, bounded output, and commit identity are persisted. |
| AC-006                    | Apply bounded fix loops.                                 | Retry ceilings and terminal outcomes have transition tests.                   |
| AC-007                    | Run QA for applicable behavior.                          | QA evidence or a structured not-applicable decision is recorded.              |
| AC-008 (later automation) | Address applicable Codex PR-review findings.             | Findings are resolved, disputed with evidence, or escalated.                  |
| AC-009 (later automation) | Enforce configured merge and production gates.           | Missing, stale, or failed required signals prevent completion.                |
| AC-010                    | Pause/resume without repeated side effects.              | A forced-interruption integration test reconciles and resumes safely.         |
| AC-011                    | Persist pacing, waits, and retry policy.                 | Restarting does not reset budgets or backoff.                                 |

### MVP 1 lifecycle boundary

D-007 in [DECISIONS.md](DECISIONS.md) settles MVP 1 as one local task through intake, JIT planning, isolated implementation, deterministic verification, independent critical review, bounded fixes, applicable QA and durable evidence-backed operator handoff. Required QA and fresh evidence remain mandatory.

AC-008 remote PR-review orchestration and AC-009 automated remote merge/production orchestration remain outside MVP 1. A verified handoff requires current local check, review and applicable QA evidence, task/worktree identity, the implementation workspace digest and an explanation of remaining operator gates.

MVP 1 is now explicitly treated as the **execution kernel**, not the final product boundary.

Before MVP 2 implementation begins, MVP 1 acceptance must close durable task ownership, immutable final handoff summaries, required CLI QA adapters and bounded QA recovery, supported-platform containment/live Codex compatibility, and release/security acceptance. AC-014 documents the current kernel; closing it alone does not accept MVP 1. Select these remaining outcomes JIT using [the MVP audit](MVP_AUDIT.md) and current code evidence.

## MVP 2 — autonomous task pipeline

### Outcome

An operator can select a bounded set of repository tasks once and AutoCode will execute every legally runnable task in dependency-safe order, using the MVP 1 kernel for each task, until the selected batch is complete or a legitimate blocker/human gate prevents further progress.

### Core loop

```text
load task contracts
  -> build dependency graph
  -> calculate READY tasks
  -> select next task deterministically
  -> execute MVP 1 task kernel
  -> validate + independent review + bounded fix loop
  -> reach configured repository handoff/finalization boundary
  -> persist task/run outcome
  -> recalculate READY tasks
  -> continue or stop with an explicit reason
```

### Required capabilities

- Parse task identity, status, `depends_on`, blockers and completion records into a project task graph.
- Detect malformed dependencies and cycles before model execution.
- Calculate READY/WAITING/BLOCKED/DONE state deterministically.
- Accept a bounded batch target; initial UX may be an explicit task list or `--through <task>` over an ordered queue.
- Reuse the existing single-task execution kernel rather than creating a second execution path.
- Persist batch/run identity, current task, completed tasks, blockers and remaining tasks so interruption can resume safely.
- Recalculate readiness only from durable repository/run evidence.
- Stop rather than guess when credentials, architecture/product decisions, unsafe permissions or configured human gates are required.
- Produce a final run summary showing completed, blocked, waiting, failed and not-started work with evidence locations.

### Publication, completion and branch-base boundary

MVP 2 initially retains D-007's operator-managed publication and merge boundary. The batch runner does not commit, push, create PRs, merge or deploy. For a PR-required task it persists a verified local handoff and stops for the operator to publish, address remote review, obtain human-authorized merge through configured gates, perform applicable production verification and update the completed task record. Handoff, a published PR and passing local checks do not satisfy a dependency.

On batch resume, reconcile the completed record with durable evidence of all applicable repository gates, including the merged implementation identity. Fetch and verify the current target branch contains that implementation before preparing a dependent task's fresh isolated feature worktree from that target branch. Never base dependent work on an unmerged predecessor branch or reuse the predecessor's prepared run. Missing, stale or contradictory evidence blocks advancement. Reconcile the batch checkpoint without repeating completed task effects; prepare a new task run when task/base identity changes, preserving the kernel's existing resume rules.

Automatic dependent advancement is initially proven only in a disposable local fixture whose task contracts and trusted operator policy explicitly permit PR and production exceptions and whose local completion evidence passes the configured gates. Such run completion may satisfy fixture dependencies; it cannot mark PR-required repository tasks done. Remote publication/merge automation requires a separately selected lifecycle milestone and policy decision before unattended PR-required chains are promised.

### Initial acceptance scenarios

Given a disposable five-task dependency chain with genuine explicit local-only exceptions as defined above, one AutoCode invocation must:

1. execute the first READY task;
2. pass it through deterministic validation, independent review and bounded fixes;
3. advance to newly READY work without another operator prompt;
4. repeat for subsequent tasks;
5. stop correctly if a task encounters a declared human/credential/policy blocker;
6. leave downstream dependent tasks WAITING rather than attempting them; and
7. resume the same batch without repeating already-completed side effects.

The local proof is successful if the operator does not manually launch each Codex task or determine what comes next. It demonstrates scheduling and durable batch execution, not remote repository acceptance.

A separate PR-required chain scenario must stop at the first verified handoff and leave dependents WAITING. After the operator completes the repository gates, resume must reconcile the merged predecessor and start the next READY task from the verified current target branch without repeating predecessor effects. Before merge, absent authorization, failed gates or a target branch missing the merged implementation must prevent advancement.

### Deliberate non-goals for MVP 2

- Parallel task execution.
- Hosted scheduler/control plane.
- Web dashboard.
- Automatic decomposition of a vague product idea into an entire project plan.
- Multiple model/provider backends.
- Cross-repository orchestration.
- Automated publication, PR-review observation, merge and deployment.
- Unbounded autonomous merging/deployment.
- Jira/Slack/project-management integrations.

## JIT task strategy

JIT remains part of AutoCode, but it has two distinct meanings:

- **JIT implementation planning:** generate the detailed coding plan immediately before executing an already-defined task. This remains required.
- **JIT task materialization:** refine/create a future task from a coarse project outcome only when it is about to become actionable. This is valuable for Project mode but is not required to prove MVP 2 Batch mode.

MVP 2 should begin with pre-authored executable task contracts. Automatic JIT task materialization follows after dependency-safe batch execution is proven.

## Longer-term project runner

After MVP 2, AutoCode may operate continuously over a project queue: materialize or select READY work, execute it, verify it, advance repository state, and repeat. Coding and review backends should remain replaceable behind stable AutoCode contracts; Codex is the first backend, not the product identity.

## Non-functional requirements

- Reliable idempotent/reconciled transitions.
- Constrained commands/paths and untrusted-input handling.
- Human-readable reasons for every transition.
- Windows, macOS and Linux support where the selected worker backend and Git are supported.
- No required hosted infrastructure for the local MVPs.
- Orchestration state must survive process interruption.
- Task graph decisions must be deterministic and inspectable.

## Explicit non-goals

- Competing with coding-agent chat/IDE interfaces.
- Building a proprietary coding model.
- Direct OpenAI/Anthropic API integration as an MVP requirement.
- Multi-user billing or organization management.
- Unbounded parallel agents/tasks.
- Autonomous high-risk merges without explicit approval policy.

## Product success test

AutoCode is useful when a developer can define several bounded engineering outcomes, start one run, leave, and return to multiple independently reviewed task results plus a precise explanation of anything that stopped. If the developer still has to launch every Codex task, choose every next task, relay every review/fix cycle and reconstruct execution state manually, AutoCode has not yet delivered its product-level value.

## Open questions

- Select the public package/binary name after checking registry availability.
- Select a later remote lifecycle milestone and its exact-head publication, authorized merge and deployment reconciliation policy.
- Define the first batch-selection CLI contract.
