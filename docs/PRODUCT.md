# AutoCode product requirements

**Status:** Approved for MVP 1

**Release:** MVP 1 — one-task durable workflow foundation

**Last updated:** 2026-09-14

## Product statement

A developer needs to hand an approved MVP task to a local orchestrator so Codex can implement it through evidence-backed gates, pause safely, and resume without losing or repeating work.

## Evidence and assumptions

### Verified

- Earlier prototypes demonstrated useful task parsing, dependency readiness, worktree, validation, state, GitHub, and policy concepts.
- They also showed that a hosted control plane and direct provider APIs are unnecessary for the first CLI MVP.

### Assumptions to test

- Codex CLI sessions can be supervised and reconciled reliably enough for a durable local workflow.
- Independent review improves results compared with one continuing implementation session.
- File-based local state is sufficient before a database or hosted scheduler is justified.

### Unknown

- The best stable Codex CLI session/event interface for pause and resume.
- Remote lifecycle adapter design for a later release; MVP 1 scope is settled by D-007.
- Appropriate default pacing across subscription and machine constraints.

## Primary journey

1. Approve an MVP document and small ordered queue.
2. Select the next ready outcome and create/refine its task just in time.
3. Generate a fresh implementation plan against the current repository.
4. Implement in an isolated worktree through Codex CLI.
5. Run deterministic checks and independent critical review.
6. Perform bounded fixes and applicable QA.
7. Retain a verified local handoff or an explicit local-only completion, or stop safely as blocked/failed/paused; support later resume.
8. The operator handles publication, PR review, merge and applicable production verification through repository policy before declaring the repository task done.

## Functional requirements

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

## MVP 1 lifecycle boundary

D-007 in [DECISIONS.md](DECISIONS.md) settles MVP 1 as one local task through intake, JIT planning, isolated implementation, deterministic verification, independent critical review, bounded fixes, applicable QA and durable evidence-backed operator handoff. Required QA and fresh evidence remain mandatory. A final immutable local summary and durable ownership/resume handling remain acceptance work; scope selection does not claim these are implemented.

AC-001 through AC-007 and AC-010/AC-011 remain MVP requirements. AC-008 remote PR-review orchestration and AC-009 automated remote merge/production orchestration are deferred to a later release. Their existing reusable policies remain supported safety boundaries; required external gates must still block local completion. MVP 1 must prove a safe PR-required handoff without publishing or declaring task completion, and explicit local-only exceptions without pretending they prove remote acceptance.

A verified handoff requires current local check, review and applicable QA evidence, task/worktree identity, the implementation workspace digest and an explanation of remaining operator gates. The current runner uses `blocked` at the PR boundary; this decision adds no CLI outcome. Other blocked runs are not verified handoffs. Commit/push/PR creation, remote review observation/disposition, merge, deployment and production smoke are operator responsibilities for MVP 1. Repository tasks become `done` only after their applicable repository gates pass. A local-only fixture may complete its run under explicit task and operator exceptions; this does not complete a PR-required repository task.

D-005 still authorizes contributors implementing AutoCode tasks to commit, push and open PRs after checks and applicable QA. Contribution authority is separate from the MVP CLI capability. No merge or deployment authority is expanded.

## Non-functional requirements

- Reliable idempotent/reconciled transitions.
- Constrained commands/paths and untrusted-input handling.
- Human-readable reasons for every transition.
- Windows, macOS, and Linux support where Codex CLI and Git are supported.
- No required hosted infrastructure for MVP 1.

## Explicit non-goals

- Web dashboard, Supabase queue, or hosted control plane.
- Direct OpenAI/Anthropic API integration.
- Multi-user billing or organization management.
- Unbounded parallel agents/tasks.
- Autonomous high-risk merges without explicit approval policy.

## MVP completion gates

- Continue when the vertical slice proves deterministic transitions and interruption-safe resume.
- Narrow if session continuation is unstable; persist artifacts and start fresh scoped sessions.
- Stop/pause if the slice requires hosted infrastructure or unsafe shell/filesystem authority.

## Open questions

The AC-012 code assessment is in `MVP_AUDIT.md`. It demonstrates the local fixture slice while identifying QA recovery, external lifecycle, task ownership/completion, platform, and release gaps. D-007 resolves the external-phase scope question; QA recovery, ownership/summary, supported platforms/live compatibility and release gates remain open. Neither completed foundation tasks nor local run completion satisfy the release checklist.

- [x] Finalize the boundary between JIT task refinement and JIT implementation planning during schema work: operators author task contracts; AutoCode validates and snapshots them before model-authored planning begins.
- [ ] Select the public package/binary name after checking registry availability.
- [x] Decide which PR/production phases enter MVP 1: verified local operator handoff is required; remote automation is deferred under D-007.
