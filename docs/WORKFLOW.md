# AutoCode workflow

**Status:** Selected target workflow; not yet implemented

**Last updated:** 2026-09-02

## Planning hierarchy

AutoCode uses three planning horizons:

1. `docs/PRODUCT.md` defines the approved MVP outcome, requirements, non-goals, and release gates.
2. `tasks/README.md` holds a small ordered queue of outcomes, not speculative implementation detail.
3. The selected task is created/refined just in time, then a fresh implementation plan is generated against the current commit before coding.

Implementation must take place in an isolated feature branch and worktree. Direct implementation on `main` is prohibited.

Later tasks stay coarse until dependencies and current reality are known. The task is an implementation contract; its detailed plan is a run artifact.

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

## QA policy

QA is an explicit phase, not an implied part of unit tests. It is normally required for UI/interaction, auth, onboarding, payments, public APIs, external-provider journeys, migrations, deployment behavior, or regressions requiring observed behavior.

Pure internal changes may record QA as not applicable when deterministic tests cover the outcome. QA findings enter the bounded fix/reverify loop, and subsequent code changes invalidate affected QA evidence.

## Transition rules

- Persist required evidence before advancing.
- Agent prose cannot override failed deterministic checks.
- Implementation and critical review use distinct scoped sessions.
- Fix, dispute with evidence, explicitly authorize, or escalate every finding.
- Code changes invalidate stale verification, review, QA, and PR evidence.
- Optional phases require a recorded applicability decision.
- After deterministic verification, independent critical review, and applicable QA pass, push the feature branch and open a PR unless a genuine not-applicable exception is explicitly documented.
- A PR is genuinely not applicable only when the task contract records the reason and the configured policy permits proceeding without one.
- Merge only through configured gates; a successful local check or agent claim cannot replace required remote checks or approvals.
- Timeouts become waiting, paused, blocked, or failed—not success.
- Retry budgets and pacing survive restart.

## Pause, resume, and pacing

After each side effect and phase result, record a safe checkpoint. Resume validates state, locks the run, reconciles Git/external systems, invalidates stale evidence, and continues from the first incomplete safe transition.

Pacing may enforce cooldowns, quiet hours, attempt/time ceilings, stop-after-current-task, and polling backoff.

## Terminal outcomes

- `done`: every required gate passed.
- `paused`: deliberately stopped at a resumable boundary.
- `blocked`: input, authority, or an external condition is required.
- `failed`: recovery policy is exhausted.
- `canceled`: deliberately ended and safely reconciled.
