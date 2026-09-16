# Configuration and command reference

## Project configuration

`.autocode/config.yaml` belongs to the operator. Here is a complete schema example for a project with compatible pnpm check scripts; replace the commands with your project's actual checks. Command compatibility still needs verification inside the sandbox.

```yaml
version: 1
stateDirectory: .autocode
telemetry: false
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
roles:
  planner:
    runner: codex
    model: gpt-5.6-plan
  implementer:
    runner: codex
    model: gpt-5.6-code
  reviewer:
    runner: codex
    model: gpt-5.6-review
  fixer:
    runner: codex
    model: gpt-5.6-code
```

| Setting                 | Meaning                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `version`               | Must be `1`.                                                                                                          |
| `stateDirectory`        | Must be `.autocode`.                                                                                                  |
| `telemetry`             | Must be `false`.                                                                                                      |
| `verification.commands` | Up to 32 uniquely named checks, run in order; integrated `run` needs at least one.                                    |
| `command`               | Executable name resolved from PATH; no absolute path, directory component or shell interpreter.                       |
| `args`                  | Argument array; no shell command strings, pipes or chained commands.                                                  |
| `timeoutMs`             | Positive integer, at most 86,400,000 ms per check.                                                                    |
| `maxOutputBytes`        | Positive integer, at most 16,777,216 bytes of captured output per check.                                              |
| `fixLoop.maxAttempts`   | Positive integer; the integrated workflow supports up to 19 rounds. The standalone config validator accepts up to 20. |
| `roles.<role>.runner`   | Registered runner ID for exactly one of `planner`, `implementer`, `reviewer`, or `fixer`. Codex uses `codex`.         |
| `roles.<role>.model`    | Optional runner-specific model ID. It changes execution identity/evidence, never role authority.                      |

Keep the version, state directory and telemetry fields. Unknown keys are rejected. Initialization defaults to empty checks, a ten-minute timeout, 1 MiB output and three fix attempts. Verification stops at the first failing check and rejects workspace or protected-state changes; use check modes rather than formatters that rewrite source.

The `roles` section must contain exactly one assignment for every required role when present. Existing valid version-1 files without `roles` retain the safe migration default of `codex` for all four roles with the Codex CLI's own default model. New initialization writes those defaults explicitly. Unknown runners, malformed model IDs, incomplete role maps, unsupported model selection, and runner capability mismatches fail before durable or model effects. Codex is the only production adapter currently registered; the adapter contract permits later runners without granting them capabilities through configuration.

Planner and reviewer assignments are always read-only. Implementer and fixer assignments receive the existing bounded worktree-write authority. A configured runner cannot escalate those authorities, and review must return a fresh execution identity distinct from implementation. Runner/model IDs and bounded redacted evidence are retained for resume freshness; credentials and inherited secret-bearing environments are not configuration fields.

## Workflow policy

Create `.autocode/workflow.json` before `run`. Initialization does not create it. For a documentation-only task whose contract explicitly makes QA inapplicable:

```json
{
  "version": 1,
  "qa": {
    "kind": "not-applicable",
    "reason": "Documentation-only change; no runtime behavior is affected."
  }
}
```

A not-applicable QA reason must contain at least 16 UTF-8 bytes after trimming. The task and operator policy must agree; a task requiring QA cannot use this exception.

Required QA policy defines scenarios:

```json
{
  "version": 1,
  "qa": {
    "kind": "required",
    "reason": "The changed CLI journey needs runtime scenario verification.",
    "scenarios": [
      {
        "name": "help",
        "description": "Help prints usage without changing the repository."
      }
    ]
  }
}
```

Required QA needs a trusted integration using `createContainedQaAdapter` through the workflow API; there is no CLI adapter flag or browser configuration. Missing QA policy blocks, and supplying required policy alone cannot run its scenarios. See [workflow implementation details](../WORKFLOW.md) for the API boundary.

Leave `pullRequest` and `completion` absent for ordinary PR-required work. A genuine disposable local-only run additionally needs a task-authored `pull_request: not_applicable`, an operator `pullRequest` exception with a substantive reason, and a validated `completion` policy with explicit merge and production exceptions. These policies never substitute for required remote gates; see [completion policy](../WORKFLOW.md). This guide's examples retain the PR handoff boundary.

Optional `verificationReadResources` authorizes up to 16 exact existing absolute regular files needed by checks. Directories and links are rejected. Grants cannot expose known credentials or durable evidence; a directory grant cannot authorize neighboring files. Changing policy or resource contents can invalidate existing run evidence. Use this field only for identified safe runtime files, not to expose secrets or whole installations.

## Commands

Use `node <AutoCode-checkout>/dist/cli.js <command> <project-directory>`. The directory defaults to your current working directory when omitted. Every command accepts at most one directory; `--help` prints usage. There are no CLI flags for pause, pacing, authentication, QA adapters or automatic publication.

| Command    | What it does                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`     | Safely creates configuration/state and ignore coverage; preserves existing valid configuration.                                                                                                                                                 |
| `select`   | Strictly validates the canonical sequence in `tasks/README.md` against task records and current Git history, then reports the ordered eligible task, active work, blockers, or no ready work. It does not acquire ownership or change statuses. |
| `prepare`  | Validates the complete task and clean linked worktree, then creates or reuses commit-bound planning artifacts.                                                                                                                                  |
| `run`      | Selects from the canonical workbook, prepares when necessary, durably owns that task, then executes the integrated local workflow.                                                                                                              |
| `resume`   | Reuses matching durable task ownership and continues the existing workflow; never starts a missing run.                                                                                                                                         |
| `sessions` | Uses prepared artifacts to run separate implementation and review sessions; lacks the integrated fix/QA/resume flow.                                                                                                                            |
| `verify`   | Runs configured checks against a prepared task and retains deterministic evidence; does not orchestrate model work.                                                                                                                             |

Errors exit with code 1. `run` and `resume` also exit 1 for `blocked` or `failed` results. `select` reports active work, missing dependencies and no-ready-task results with exit code 0, so inspect its output rather than assuming success means selection.

## Evidence and outcomes

Prepared artifacts live under `.autocode/runs/`; integrated phase receipts and durable history live under `.autocode/runs/durable-workflow-<task>-<commit>/`, and the exclusive task binding lives under `.autocode/ownership/`. Use printed paths rather than guessing a directory. Ownership is bound to the workbook, task, Git commit, branch, and linked worktree; it is not a second task board. Model transcripts and check output are local evidence, not authorization to bypass a failed gate.

| Outcome     | Operator interpretation                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `blocked`   | A condition needs attention. At the PR boundary, passing fresh local gates can establish operator handoff.                 |
| `failed`    | The run cannot proceed under its current safety/recovery policy; inspect retained evidence.                                |
| `paused`    | The durable API stopped at an explicitly configured safe checkpoint; no CLI pause command exists.                          |
| `completed` | Explicit local-only exceptions allowed local run completion; this does not prove a repository task was merged or deployed. |

Evidence binds task, branch/base commit, configuration, policy, plan, workspace and relevant executable/resource identities. Edits after verification invalidate evidence. See [recovery guidance](troubleshooting.md).
