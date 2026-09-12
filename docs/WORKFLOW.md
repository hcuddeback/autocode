# AutoCode workflow

**Status:** Local workflow integrated in AC-012; external lifecycle remains adapter work

**Last updated:** 2026-09-12

## Planning hierarchy

AutoCode uses three planning horizons:

1. `docs/PRODUCT.md` defines the approved MVP outcome, requirements, non-goals, and release gates.
2. `tasks/README.md` holds a small ordered queue of outcomes, not speculative implementation detail.
3. The selected task is created/refined just in time, then a fresh implementation plan is generated against the current commit before coding.

For MVP 1, task refinement remains an operator-authored repository contract. AutoCode validates that selected contract and prepares a deterministic task snapshot, commit-bound metadata, and editable plan template. Model-authored plan content begins only after role-separated Codex sessions are available.

Implementation must take place in an isolated feature branch and worktree. Direct implementation on `main` is prohibited.

Later tasks stay coarse until dependencies and current reality are known. The task is an implementation contract; its detailed plan is a run artifact.

Before implementation begins, create the task's feature branch from current `main`, attach it to an isolated worktree, and verify that worktree is not on `main`. After deterministic verification and applicable QA pass, agents may commit scoped changes, push the feature branch, and open the required PR without a separate manual review or permission request. Independent critical review remains required for task completion and may be recorded in the current review chat when accepted by the owner; a separate external review session is not a publication prerequisite. See D-005 in `DECISIONS.md`.

## Lifecycle

| Phase                       | Purpose                                                          | Required exit evidence                                                      |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Intake                      | Validate task, dependencies, repository, and authority           | Ready task and policy decision                                              |
| JIT task refinement         | Turn the next outcome into an executable contract                | Scope, criteria, risk, relevant docs, validation                            |
| JIT implementation plan     | Plan against the current commit                                  | Intended changes, sequence, risks, verification plan                        |
| Implementation              | Change an isolated feature-branch worktree                       | Diff, summary, assumptions, session identity                                |
| Deterministic verification  | Run configured checks                                            | Commands, exits, duration, bounded output, commit                           |
| Independent critical review | Challenge correctness in a separate session                      | Structured findings with severity/evidence                                  |
| Fix and re-verify           | Address actionable failures/findings                             | Updated diff, dispositions, fresh verification                              |
| QA applicability            | Decide whether runtime/browser QA is needed                      | Required scenarios or recorded not-applicable reason                        |
| QA                          | Exercise applicable user-visible behavior                        | Scenario evidence, screenshots/logs, findings                               |
| Pull request                | Push the verified feature branch and publish a PR                | PR identity and exact head commit, or a documented not-applicable exception |
| Codex PR review             | Observe and address actionable review                            | Resolved findings, evidenced disputes, or escalation                        |
| Merge gate                  | Evaluate configured CI, approvals, risk, findings, and freshness | Recorded authorization; merge is prohibited outside configured gates        |
| Production applicability    | Decide whether deployment verification applies                   | Target/checks or recorded not-applicable reason                             |
| Production verification     | Confirm deployed behavior                                        | Deployment identity, smoke results, rollback signal                         |
| Complete                    | Update task/system state and select next work                    | Immutable run summary                                                       |

## Implemented local execution

`autocode run <worktree>` and `autocode resume <worktree>` invoke the same durable workflow; resume requires an existing matching run and cannot start new model work. The operator supplies a complete `ready` task, its declared linked feature worktree, and configured deterministic commands. The runner prepares a task/commit snapshot when absent, starts a read-only planning session, passes its retained plan to implementation, and checkpoints verification and structured independent review separately. Failed checks defer review until a fixed round passes checks. Actionable review findings require another bounded fix round with fresh checks and review. Unused rounds retain explicit skip receipts. Verification binds explicitly to the selected task even when other tasks are ready.

`.autocode/workflow.json` is protected operator policy: version 1, an explicit `qa` decision accepted by `runQaPhase`, and optional `pullRequest`/`completion` policy. Missing QA blocks. Required QA needs the workflow API's scenario adapter; the CLI has no browser/runtime adapter. A scenario that changes the workspace blocks because checks and review are stale. QA failures currently require operator disposition rather than automatic QA-fix rounds.

PR-required tasks stop as blocked at the external boundary. This runner does not commit, push, publish, poll reviews, merge, deploy, mark task contracts done, or advance the queue. Disposable local workflows may complete only when the task explicitly declares `pull_request: not_applicable`, operator policy records a substantive `pullRequest: {kind: "not-applicable", reason: "..."}` exception, and `completion` passes `evaluateCompletionGates` for the prepared commit with explicit production applicability. Such completion is local run completion, not proof of a published or merged task.

Required production verification also blocks until a deployment adapter can bind observed behavior to committed implementation. Passing static signals for the prepared base commit cannot prove the uncommitted implementation was deployed. Local-only completion therefore requires production to be explicitly not applicable.

Phase receipts and the durable event log live under `.autocode/runs/durable-workflow-<task>-<commit>/`; subprocess output remains in the prepared task run. Receipts bind task/configuration/policy/prepared plan and Git identity, plus the workspace digest after the phase. Resume rejects changed task, base commit, branch, configuration, plan, or workspace. Successful current receipts reconcile without repeating their effect. Interrupted model work without a successful receipt, malformed review, and blocked callback results require operator reconciliation. Changing policy or workspace requires a fresh prepared run (normally a new base commit); there is no unsafe automatic state reset.

Each deterministic command is checked against a snapshot of all AutoCode state, excluding only its current verification output directory. Creating, changing, or deleting workflow receipts or other protected state fails the run permanently; restart cannot reconcile those subprocess-written receipts into success. QA callbacks are also checked against protected state before their results are accepted.

When required QA stops because its adapter is absent, the runner retains a separate `qa-awaiting-adapter-<attempt>.json` preflight receipt instead of a QA result. Supplying the adapter through the workflow API permits resume only when that receipt matches the current effect, attempt, binding, and workspace. The durable retry policy still applies. Once a new attempt starts, an earlier preflight receipt cannot authorize repeating an interrupted QA callback. Existing blocked QA result receipts without this attempt-bound preflight evidence remain conservative.

The integrated runner supports up to 19 fix rounds within the durable engine's 64-phase ceiling. Durable attempt, elapsed, and pacing defaults remain persisted; quiet hours and operator-configured workflow pacing are not CLI features. Native model-session continuation is deliberately unnecessary: each scoped role starts a fresh session.

## Target QA policy

QA is an explicit phase, not an implied part of unit tests. It is normally required for UI/interaction, auth, onboarding, payments, public APIs, external-provider journeys, migrations, deployment behavior, or regressions requiring observed behavior.

Pure internal changes may record QA as not applicable when deterministic tests cover the outcome. QA findings enter the bounded fix/reverify loop, and subsequent code changes invalidate affected QA evidence.

## Transition rules

- Persist required evidence before advancing.
- Agent prose cannot override failed deterministic checks.
- Implementation and critical review use distinct scoped sessions.
- Fix, dispute with evidence, explicitly authorize, or escalate every finding.
- Code changes invalidate stale verification, review, QA, and PR evidence.
- Optional phases require a recorded applicability decision.
- After deterministic verification and applicable QA pass, autonomously commit scoped changes, push the feature branch, and open a PR unless a genuine not-applicable exception is explicitly documented. No separate manual review or permission request is required for these publication actions.
- A PR is genuinely not applicable only when the task contract records the reason and the configured policy permits proceeding without one.
- Merge only through configured gates; a successful local check or agent claim cannot replace required remote checks or approvals.
- After merge gates pass, mark the task `done` and move its record from `tasks/` to `tasks/completed/`; completed records remain available for dependency resolution.
- Timeouts become waiting, paused, blocked, or failed—not success.
- Retry budgets and pacing survive restart.

## Pause, resume, and pacing

Local workflow receipts preserve typed control fields and redact free-text payloads before JSON serialization. Independent review parses bounded raw output in memory and retains a validated structured verdict separately from redacted display artifacts. Freshness includes discovered ignored credential paths and content hashes; QA cannot modify, remove, or add these files and retain passing evidence. Receipts from the earlier AC-012 worktree-only fingerprint are conservatively stale under the credential-aware fingerprint and require a new run.

After each side effect and phase result, record a safe checkpoint. Resume validates state, locks the run, reconciles Git/external systems, invalidates stale evidence, and continues from the first incomplete safe transition.

Pacing may enforce cooldowns, quiet hours, attempt/time ceilings, stop-after-current-task, and polling backoff.

## Terminal outcomes

- `done`: every required gate passed.
- `paused`: deliberately stopped at a resumable boundary.
- `blocked`: input, authority, or an external condition is required.
- `failed`: recovery policy is exhausted.
- `canceled`: deliberately ended and safely reconciled.
