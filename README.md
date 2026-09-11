# AutoCode

AutoCode will be a local-first TypeScript CLI that runs durable software-engineering workflows through Codex CLI.

**Status:** MVP

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed; planned as a locally installed CLI

**Last updated:** 2026-09-11

> Current reality: initialization, task selection, commit-bound planning, role-separated Codex sessions, deterministic verification, reusable workflow policies, completion gates, and a durable pause/resume executor with effect reconciliation are implemented. End-to-end workflow wiring and pacing policy are not implemented yet.

## Who it is for

- User: developers who want controlled, inspectable autonomous implementation.
- Owner: an individual developer or small software team operating its own repositories.
- Recurring job: take the next approved MVP task from intent through implementation, evidence-backed review, and a safe stopping point.

## Current scope

### Included

- A TypeScript CLI that supervises Codex CLI sessions locally.
- MVP-driven, just-in-time task planning and deterministic verification.
- Independent critical review, applicable QA, PR-review repair, merge gates, production verification, pacing, and durable pause/resume.

### Explicitly excluded

- A hosted control plane or web dashboard.
- Direct model-provider API orchestration.
- Unbounded parallel task execution or support for every coding-agent CLI.

## Target workflow

```text
approved MVP → select next outcome → create/refine JIT task
→ JIT plan → implement → deterministic verification
→ independent critical review → bounded fixes → applicable QA
→ PR + Codex PR-review fixes → merge gate
→ applicable production verification → update state → next task
```

## Stack

- Runtime: Node.js 24+ with strict TypeScript.
- Package manager: pnpm.
- State: versioned project-local files under `.autocode/`.
- Agent runtime: Codex CLI subprocesses and resumable sessions.
- External systems: Git and optional GitHub/deployment/browser adapters.

## Local setup and validation

```shell
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Initialize an existing project directory without overwriting valid configuration:

```shell
pnpm build
node dist/cli.js init path/to/project
```

Select the first ready task whose dependencies are complete, provided no task is already in progress or review:

```shell
node dist/cli.js select path/to/project
```

From the selected task's non-`main` Git worktree, validate its contract and create an editable, commit-bound plan under `.autocode/runs/`:

```shell
node dist/cli.js prepare path/to/project
```

Repeating `prepare` for the same task and commit preserves the existing editable plan. A changed commit receives a distinct run directory, while conflicting task snapshots or metadata fail safely.

After filling the prepared plan, run a writable implementation session followed by a fresh read-only critical-review session:

```shell
node dist/cli.js sessions path/to/project
```

The command atomically reserves its session output, passes scoped prompts through stdin, captures distinct Codex thread IDs, and stores bounded, redacted JSONL, stderr, final-message, and session metadata artifacts below the prepared run. It protects ignored credential files from implementation changes and runs default Linux sessions in transient systemd user units so daemonized descendants remain contained. It stops on stale preparation, changed Git or protected local state, missing uncommitted implementation changes, existing evidence, timeout, output overflow, malformed events, failed exit, or reused session identity. Session resume, verification, and review-fix loops are not part of this command yet.

Configure deterministic checks in `.autocode/config.yaml` as executable and argument arrays:

```yaml
verification:
  commands:
    - name: format
      command: pnpm
      args: [format:check]
    - name: test
      command: pnpm
      args: [test]
  timeoutMs: 600000
  maxOutputBytes: 1048576
fixLoop:
  maxAttempts: 3
```

Then run them from the prepared task worktree:

```shell
node dist/cli.js verify path/to/project
```

`verify` runs each command directly without a shell and stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change. It atomically reserves `.autocode/runs/<run>/evidence/` and retains redacted stdout, stderr, command arguments, exit status, timing, and the exact branch and commit for every attempted check. Default Linux checks run in transient systemd user units so daemonized descendants remain contained; unsupported non-Windows containment fails closed. Existing evidence and stale preparation fail closed.

Workflow adapters can use `runBoundedFixLoop` from `fix-loop.js` with the validated `fixLoop.maxAttempts` policy. The initial check does not consume an attempt; each applied or attempted fix does. The runner stops on success, blocks immediately on a non-retryable result, and fails closed on ceiling exhaustion, callback errors, or malformed results while returning ordered immutable transitions. Wiring this policy into durable resumable workflow state remains a later task.

Workflow adapters can use `runQaPhase` from `qa.js` with an explicit `required` or `not-applicable` decision. A not-applicable decision requires a substantive reason of at least 16 UTF-8 bytes and does not accept an adapter. Required QA validates one to 32 uniquely named scenarios, runs them in order, and returns immutable structured evidence with timing, outcomes, reasons, and bounded artifact references. Failed, blocked, malformed, or throwing scenarios stop later work and fail closed without retaining exception details. Provider-specific browser tooling and durable QA artifact persistence remain later integration work.

Workflow adapters can use `runPrReviewPhase` from `pr-review.js` to disposition up to 64 applicable Codex PR-review findings. Findings are copied and validated before an adapter sees them, then processed in order as resolved, disputed with at least one evidence reference, or escalated. A clean review passes without invoking an adapter, any escalation blocks passage, and callback or malformed-result failures fail closed. The returned finding evidence, timing, reasons, and references are deeply immutable. GitHub polling, review-comment mutation, durable persistence, and merge-gate integration remain later work.

Workflow adapters can use `evaluateCompletionGates` from `completion-gates.js` to enforce configured merge and production gates without performing external side effects. Merge signals must be bound to the exact expected head commit. Production requires either a substantive not-applicable reason or one to 64 configured gates whose signals match both the exact deployment identity and source commit. Missing, pending, or stale signals block completion; current failed signals fail it; malformed, duplicate, unexpected, accessor-backed, and proxy-backed evidence is rejected. Every configured gate receives ordered, deeply immutable evidence, including its observed subject identity, and failed outcomes take precedence over blocked outcomes. GitHub, CI, deployment, merge, rollback, and durable-state adapters remain later integration work.

Workflow adapters can use `runDurableRun` from `durable-run.js` to execute one to 64 ordered effect phases under a per-run lock. Run and phase IDs use canonical lowercase path-safe identifiers, and every invocation verifies that its run path remains untracked and gitignored before writing. The executor appends and syncs a transition event before atomically replacing its versioned snapshot, persists a deterministic effect identity before invoking an adapter, rejects credential-bearing definitions, and redacts known workspace credentials from adapter reasons before persistence. `pauseAfterPhase` stops only after a completed phase. If execution is interrupted while an effect is in flight, the next invocation must reconcile that same identity as `applied`, `not-applied`, or `ambiguous`; only a confirmed `not-applied` result permits execution, while ambiguity blocks. Completed runs are idempotent, definition drift and corrupt state fail closed, and a subprocess integration test covers termination after the effect but before its completion checkpoint. Provider-specific adapters, end-to-end phase wiring, and AC-011 pacing remain later work.

## Documentation

- [Product and MVP requirements](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Workflow](docs/WORKFLOW.md)
- [Decisions](docs/DECISIONS.md)
- [Security](docs/SECURITY.md)
- [Release runbook](docs/RELEASE.md)
- [Current system state](SYSTEM.md)
- [Task queue](tasks/README.md)
- [Contributing](CONTRIBUTING.md)

## Current next step

Complete AC-010 review and PR gates, then select AC-011 for durable pacing and retry policy.

## Guardrail

Do not expand beyond MVP 1 without updating `docs/PRODUCT.md`, recording a durable decision when appropriate, and selecting a bounded task.

## License

License information must be added before the first public release.
