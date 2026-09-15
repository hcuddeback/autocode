# AutoCode

AutoCode is a local-first TypeScript CLI for executing an ordered workbook of software tasks through configurable planning, implementation, independent review, fixing, validation, QA, evidence, and resume boundaries.

**Status:** MVP 1 in development and acceptance

**Current implementation:** durable one-task kernel using Codex CLI

**MVP 1 target:** ordered JIT task workbook with configurable role/runner/model assignments

**Production:** not deployed or publicly packaged

**Last updated:** 2026-09-15

Codex CLI is the first supported runner adapter. The target architecture assigns `planner`, `implementer`, `reviewer`, and `fixer` roles to configured runners and optional models; it does not hard-code the product to one provider. The current source still invokes Codex-specific session types, and [AC-015](tasks/AC-015.md) is the single next task that begins this separation.

## Product workflow

```text
select next eligible workbook task
  -> JIT plan
  -> implement
  -> deterministic validation
  -> independent review
  -> bounded fix and revalidation/re-review
  -> applicable QA and recovery
  -> retain immutable evidence and update task state
  -> continue or resume
```

The initial workbook executes one task at a time. PR-required work stops at a verified local handoff until operator-managed repository gates are complete; a handoff does not mark the task done or unblock dependents.

## Current commands

```text
autocode init [project]
autocode select [project]
autocode prepare [project]
autocode sessions [project]
autocode verify [project]
autocode run [worktree]
autocode resume [worktree]
```

Today, `run` and `resume` operate one already-materialized `ready` task in its declared linked feature worktree. They use fresh Codex planning, implementation, review, and fix invocations, deterministic checks, explicit QA/completion policy, durable receipts, and conservative interruption recovery. They do not yet own/update task state or continue to a successor.

## Source setup and validation

Use Node.js 24+ and the repository-declared pnpm version:

```shell
corepack prepare pnpm@12.4.1 --activate
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node dist/cli.js --help
```

This is development-checkout guidance, not clean-distribution evidence. See the [operator guide](docs/user/README.md) for task preparation, configuration, current command behavior, and recovery.

## Canonical sources

- [Product acceptance](docs/PRODUCT.md)
- [Canonical MVP 1 workbook and task state](tasks/README.md)
- [Current implementation/evidence audit](docs/MVP_AUDIT.md)
- [Workflow](docs/WORKFLOW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Durable decisions](docs/DECISIONS.md)
- [Security](docs/SECURITY.md)
- [Release gates](docs/RELEASE.md)
- [Verified system state](SYSTEM.md)
- [User guide](docs/user/README.md)
- [Contributing](CONTRIBUTING.md)

## Current limits

- Roles/runners/models are not configurable yet; current execution is Codex-specific.
- The CLI does not schedule the ordered workbook, retain workbook ownership, update task state, or continue between tasks.
- Required CLI QA configuration and automatic QA-fix recovery are absent.
- Windows containment fixtures are verified, but some captured-pipe commands and authenticated live Codex remain unaccepted.
- Linux and macOS contained execution fail closed.
- CI/release security, license, package identity, clean install/upgrade, and public release evidence are incomplete.
- Remote PR review, merge, deployment, and production automation are deferred.

The [canonical workbook](tasks/README.md) derives AC-015–AC-021 from current MVP 1 acceptance. Only AC-015 is ready; AC-001–AC-014 remain completed historical records.

## License

License selection is an open MVP 1 release gate.
