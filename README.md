# AutoCode

AutoCode will be a local-first TypeScript CLI that runs durable software-engineering workflows through Codex CLI.

**Status:** MVP

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed; planned as a locally installed CLI

**Last updated:** 2026-09-02

> Current reality: this repository contains the approved product and workflow baseline. The CLI is not implemented yet.

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

```text
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Initialize a project without overwriting existing valid state:

```text
pnpm build
node dist/cli.js init path/to/project
```

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

Implement the workflow runtime and durable phase transitions in the next bounded task.

## Guardrail

Do not expand beyond MVP 1 without updating `docs/PRODUCT.md`, recording a durable decision when appropriate, and selecting a bounded task.

## License

License information must be added before the first public release.
