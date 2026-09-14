# Getting started from source

## Prerequisites

Use Node.js 24 or newer, Git, and the repository's declared pnpm version (`11.27.0`). Contained execution currently requires Windows; see the [compatibility limits](README.md). Codex CLI must be available on the operator's PATH for `run` and `sessions`. Existing host login credentials and tokens are not automatically inherited by sandboxed processes. A successful host login does not establish AutoCode compatibility.

Choose a disposable project first. Approve the task scope and source sharing before model execution. Keep secrets out of task text, command arguments and tracked files. Local evidence under `.autocode/` stays private and uncommitted.

## Build AutoCode

In PowerShell, clone and build the source:

```powershell
git clone https://github.com/hcuddeback/autocode.git D:\dev\autocode-source
Set-Location D:\dev\autocode-source
pnpm install --frozen-lockfile
pnpm build
node .\dist\cli.js --help
$autoCodeCli = 'D:\dev\autocode-source\dist\cli.js'
```

Use your own checkout path if these directories already exist. A public package installation command is not available. Building successfully does not verify authenticated execution or all project check commands.

## Write a task contract

In your target Git repository, create `tasks/AC-001.md` from [the task template](../../tasks/TASK_TEMPLATE.md). If AC-001 already exists, choose an unused three-digit ID and matching filename. Fill every section with the actual outcome, scope, checks, review criteria and operator gates. Remove template placeholders and unused empty completion fields. Decide `qa` and `deployment` explicitly; `auto` placeholders are rejected by preparation.

Example frontmatter for a documentation task:

```yaml
---
task_id: AC-001
title: Document the project's local setup
status: ready
priority: high
risk: low
depends_on: []
branch: feat/AC-001-local-setup
owner: operator
last_updated: 2026-09-14
qa: not_applicable
deployment: not_applicable
pull_request: required
---
```

This frontmatter is only part of the contract; the filled template body is also required. Explain why QA and deployment do not apply. For runtime behavior, choose required QA and define scenarios instead.

Commit the completed contract through your repository's normal contribution process before preparing execution. Dependencies must exist and be `done` in `tasks/completed/`. No task may be `in_progress` or `review` when selecting new work. The current integrated runner expects its selected contract to remain `ready`; it does not manage task ownership or statuses.

## Create and initialize the execution worktree

From the target repository, create a linked feature worktree from the commit containing the approved contract. Its branch must match the task's `branch` field:

```powershell
git worktree add D:\dev\example-task -b feat/AC-001-local-setup HEAD
$taskWorktree = 'D:\dev\example-task'
node $autoCodeCli init $taskWorktree
node $autoCodeCli select $taskWorktree
```

Preparation requires the worktree root, a clean Git status and an isolated linked branch other than `main`. Initialization creates `.autocode/config.yaml` and ensures `.autocode/` is ignored. If it changes `.gitignore`, commit that change before preparing. Repeating initialization preserves valid existing configuration.

## Configure checks and QA

Edit `.autocode/config.yaml` in the execution worktree with actual project checks, then create `.autocode/workflow.json`. Use the complete examples in [the reference](reference.md). Initialization supplies no check commands, and `run` requires at least one.

Commands must be executable names plus argument arrays. Their executables must resolve on PATH and work inside containment. Some package-manager commands need runtime resources that the CLI cannot automatically expose; see [troubleshooting](troubleshooting.md). Do not weaken isolation to make an unsupported command pass.

## Prepare or run

To inspect preparation without starting model execution:

```powershell
node $autoCodeCli prepare $taskWorktree
```

The command prints the artifact directory containing the task snapshot, metadata and `plan.md`. Repeating it for the same task and commit preserves that plan. `prepare` does not ask Codex to implement anything.

When the project commands and model runtime are compatible, start the integrated workflow:

```powershell
node $autoCodeCli run $taskWorktree
```

`run` prepares when needed, generates a scoped plan, implements, checks and reviews in separate phases, applies bounded fixes and evaluates QA. You do not need to run `sessions` or `verify` first. Those commands are separate tools, not prerequisite steps in the integrated workflow.

Current CLI execution cannot supply a required QA adapter. Such a task needs an operator integration using the contained QA API and will otherwise stop at QA. Do not relabel required QA as inapplicable to complete a run.

## Review the result and hand off

Read the printed outcome, reason and evidence path. For a PR-required task, expect `blocked` at the external boundary after passing local gates, with process exit code 1. Confirm checks, review and QA are current before treating this as a handoff. An immutable final handoff summary is still unimplemented; inspect retained evidence and your implementation diff.

You then commit and publish through repository policy, resolve remote review, satisfy merge gates and obtain merge authorization. After merge and any applicable production verification, update the task record, move it to `tasks/completed/`, and update the queue/system state. Local handoff alone does not authorize task `done`.

For interruption or stale evidence, follow [safe recovery](troubleshooting.md) before changing files or restarting.
