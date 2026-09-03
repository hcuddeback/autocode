# AutoCode

AutoCode will be a local-first TypeScript CLI that runs durable software-engineering workflows through Codex CLI.

**Status:** MVP

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed; planned as a locally installed CLI

**Last updated:** 2026-09-02

> Current reality: `autocode init`, deterministic ready-task selection, commit-bound JIT planning preparation, and role-separated Codex sessions are implemented. Durable workflow orchestration is not implemented yet.

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
```

Then run them from the prepared task worktree:

```shell
node dist/cli.js verify path/to/project
```

`verify` runs each command directly without a shell and stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change. It atomically reserves `.autocode/runs/<run>/evidence/` and retains redacted stdout, stderr, command arguments, exit status, timing, and the exact branch and commit for every attempted check. Default Linux checks run in transient systemd user units so daemonized descendants remain contained; unsupported non-Windows containment fails closed. Existing evidence and stale preparation fail closed. Automatic fix loops and resumable phase orchestration remain later tasks.

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

Complete AC-005 review and PR gates, then select AC-006 for bounded fix loops.

## Guardrail

Do not expand beyond MVP 1 without updating `docs/PRODUCT.md`, recording a durable decision when appropriate, and selecting a bounded task.

## License

License information must be added before the first public release.
