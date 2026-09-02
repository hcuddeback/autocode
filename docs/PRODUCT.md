# AutoCode product requirements

**Status:** Approved for MVP 1

**Release:** MVP 1 — one-task durable workflow foundation

**Last updated:** 2026-09-02

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
- Which PR and production phases belong in MVP 1 versus the next release.
- Appropriate default pacing across subscription and machine constraints.

## Primary journey

1. Approve an MVP document and small ordered queue.
2. Select the next ready outcome and create/refine its task just in time.
3. Generate a fresh implementation plan against the current repository.
4. Implement in an isolated worktree through Codex CLI.
5. Run deterministic checks and independent critical review.
6. Perform bounded fixes and applicable QA.
7. Reach a safe completion, PR, or blocked state and support later resume.

## Functional requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| FR-001 | Initialize project-local configuration and state safely. | A fixture receives validated, gitignored configuration without overwrites. |
| FR-002 | Select one ready task with satisfied dependencies. | Tests cover ready, blocked, malformed, and completed tasks. |
| FR-003 | Create/refine task detail and plan just in time. | Artifacts reference the selected task/current commit and exclude later work. |
| FR-004 | Run role-separated Codex CLI sessions. | Implementation and review have distinct session identities and scoped inputs. |
| FR-005 | Run deterministic verification and retain evidence. | Commands, exits, duration, bounded output, and commit identity are persisted. |
| FR-006 | Apply bounded fix loops. | Retry ceilings and terminal outcomes have transition tests. |
| FR-007 | Run QA for applicable behavior. | QA evidence or a structured not-applicable decision is recorded. |
| FR-008 | Address applicable Codex PR-review findings. | Findings are resolved, disputed with evidence, or escalated. |
| FR-009 | Enforce configured merge and production gates. | Missing, stale, or failed required signals prevent completion. |
| FR-010 | Pause/resume without repeated side effects. | A forced-interruption integration test reconciles and resumes safely. |
| FR-011 | Persist pacing, waits, and retry policy. | Restarting does not reset budgets or backoff. |

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

- [ ] Finalize the boundary between JIT task refinement and JIT implementation planning during schema work.
- [ ] Select the public package/binary name after checking registry availability.
- [ ] Decide which PR/production phases enter MVP 1 after the local slice is proven.
