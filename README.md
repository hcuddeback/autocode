# AutoCode

AutoCode will be a local-first TypeScript CLI that runs durable software-engineering workflows through Codex CLI.

**Status:** MVP

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed; planned as a locally installed CLI

**Last updated:** 2026-09-11

> Current reality: AC-012 connects initialization/selection/preparation boundaries to scoped planning, implementation, deterministic checks, independent review, bounded fixes, explicit QA, and durable run/resume. Required remote phases block pending integrations. MVP release acceptance is still open; see [the code audit](docs/MVP_AUDIT.md).

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
- Agent runtime: fresh scoped Codex CLI subprocesses with durable workflow resume.
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

The command atomically reserves its session output, passes scoped prompts through stdin, captures distinct Codex thread IDs, and stores bounded, redacted JSONL, stderr, final-message, and session metadata artifacts below the prepared run. It protects ignored credential files from implementation changes and runs Windows sessions inside AppContainers and kill-on-close Job Objects. Linux and macOS execution fail closed pending accepted containment. It stops on stale preparation, changed Git or protected local state, missing uncommitted implementation changes, existing evidence, timeout, output overflow, malformed events, failed exit, or reused session identity. Session resume, verification, and review-fix loops are not part of this command yet.

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

`verify` runs native executables without a shell and Windows CMD/BAT shims through a contained cmd.exe interpreter with escaped arguments and stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change. It atomically reserves `.autocode/runs/<run>/evidence/` and retains redacted stdout, stderr, command arguments, exit status, timing, and the exact branch and commit for every attempted check. Windows AppContainers deny user-service broker access, and Job Objects terminate detached descendants before evidence is accepted; Linux and macOS execution fail closed pending accepted containment. NUL and raw line-break arguments are rejected for batch shims. Existing evidence and stale preparation fail closed.

Workflow adapters can use `runBoundedFixLoop` from `fix-loop.js` with the validated `fixLoop.maxAttempts` policy. The initial check does not consume an attempt; each applied or attempted fix does. The runner stops on success, blocks immediately on a non-retryable result, and fails closed on ceiling exhaustion, callback errors, or malformed results while returning ordered immutable transitions. The integrated workflow uses finite durable fix/check/review rounds with the same configured ceiling; the reusable in-memory loop remains available to adapters.

Workflow adapters can use `runQaPhase` from `qa.js` with an explicit `required` or `not-applicable` decision. A not-applicable decision requires a substantive reason of at least 16 UTF-8 bytes and does not accept an adapter. Required QA validates one to 32 uniquely named scenarios, runs them in order, and returns immutable structured evidence with timing, outcomes, reasons, and bounded artifact references. Failed, blocked, malformed, or throwing scenarios stop later work and fail closed without retaining exception details. The integrated workflow persists QA evidence; provider-specific browser tooling and automatic QA-fix rounds remain later integration work.

Workflow adapters can use `runPrReviewPhase` from `pr-review.js` to disposition up to 64 applicable Codex PR-review findings. Findings are copied and validated before an adapter sees them, then processed in order as resolved, disputed with at least one evidence reference, or escalated. A clean review passes without invoking an adapter, any escalation blocks passage, and callback or malformed-result failures fail closed. The returned finding evidence, timing, reasons, and references are deeply immutable. GitHub polling, review-comment mutation, durable persistence, and merge-gate integration remain later work.

Workflow adapters can use `evaluateCompletionGates` from `completion-gates.js` to enforce configured merge and production gates without performing external side effects. Merge signals must be bound to the exact expected head commit. Production requires either a substantive not-applicable reason or one to 64 configured gates whose signals match both the exact deployment identity and source commit. Missing, pending, or stale signals block completion; current failed signals fail it; malformed, duplicate, unexpected, accessor-backed, and proxy-backed evidence is rejected. Every configured gate receives ordered, deeply immutable evidence, including its observed subject identity, and failed outcomes take precedence over blocked outcomes. The integrated local workflow persists gate evaluations for explicit exceptions; GitHub, CI, deployment, merge, and rollback adapters remain later integration work.

Workflow adapters can use `runDurableRun` from `durable-run.js` to execute one to 64 ordered effect phases under a per-run lock. Run and phase IDs use canonical lowercase path-safe identifiers, and every invocation verifies that its run path remains untracked and gitignored before writing. The executor appends and syncs a transition event before atomically replacing its versioned snapshot, persists a deterministic effect identity before invoking an adapter, rejects credential-bearing definitions, and redacts known workspace credentials from adapter reasons before persistence. `pauseAfterPhase` stops only after a completed phase. If execution is interrupted while an effect is in flight, the next invocation must reconcile that same identity as `applied`, `not-applied`, or `ambiguous`; only a confirmed `not-applied` result permits another counted attempt, while ambiguity blocks.

An optional `retryPolicy` on the durable definition configures `maxAttempts`, `maxElapsedMs`, `minimumIntervalMs`, `initialBackoffMs`, `backoffMultiplier`, and `maxBackoffMs`. An effect adapter may return `retryable` with a bounded optional `retryAfterMs`. Attempt starts and absolute next-eligible timestamps are written to the event log before execution or waiting, so restart cannot reset a ceiling or recompute a shorter delay. Exhausted attempt/time budgets end as `failed`; wait or clock failures leave recoverable durable state and fail closed. Definitions without a policy receive bounded defaults, and compatible AC-010 snapshots are upgraded from snapshot version 1 to version 2 during replay. Injectable clocks and waiters exist for deterministic adapter tests; production callers should use the defaults. The local workflow now composes durable phases; provider-specific external adapters remain later work.

## Integrated local run

From a clean linked worktree on the ready task's declared feature branch, configure verification commands and an explicit QA decision in the gitignored `.autocode/workflow.json`, then execute:

```shell
node dist/cli.js run path/to/worktree
node dist/cli.js resume path/to/worktree
```

Both commands use the same persisted run. The workflow generates a scoped plan before implementation and runs deterministic checks before structured independent review. It allows bounded fix rounds and retains fresh phase evidence. A task requiring a PR stops as blocked until an external integration is implemented. The CLI cannot execute required QA without an API scenario adapter. Local-only completion requires both a task-authored PR exception and substantive operator policy plus configured completion evidence. See [implemented workflow and policy details](docs/WORKFLOW.md).

Existing `sessions`, `verify`, and policy APIs remain individual boundaries; their descriptions above do not imply remote lifecycle automation. Required QA fixes, remote PR/review/merge/deployment adapters, task completion updates, and release packaging remain gaps documented in the audit.

## Documentation map

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

Complete AC-012 remote PR review and merge gates in [PR #14](https://github.com/hcuddeback/autocode/pull/14). Local verification, fixture QA, and the owner-accepted chat review are recorded in the task. Then select the next audited MVP gap.

## Guardrail

Do not expand beyond MVP 1 without updating `docs/PRODUCT.md`, recording a durable decision when appropriate, and selecting a bounded task.

## License

License information must be added before the first public release.

Windows command compatibility remains bounded: the verified Node/libuv runtime cannot capture child-process pipes inside AppContainer, so commands requiring that behavior fail closed. Batch commands on another volume and authenticated live Codex compatibility remain unaccepted. The verified CMD fixture does not establish full package-manager compatibility. See docs/SECURITY.md and docs/MVP_AUDIT.md.

Windows sandbox commands cannot read discovered ignored credential files and receive a minimal environment that omits operator tokens. Profile/home variables point to the private sandbox. Explicit credential-reference authentication remains unaccepted; existing CLI authentication is not implicitly inherited.
