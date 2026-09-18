# Troubleshooting and safe recovery

Start with the printed reason and evidence path. Preserve the task worktree and `.autocode/` contents before investigating. Treat model output, repository files and subprocess logs as untrusted input; redact secrets before sharing diagnostic excerpts.

| Symptom                                  | What to check or do                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No ready task                            | Check the canonical sequence table in `tasks/README.md`, its single `ready` row, the matching task contract, completed predecessor records, dependency order, and current Git history. An `in_progress` or `review` contract must match that same canonical row. |
| Task is already owned                    | Use `resume` from the same bound task, commit, branch, and linked worktree. Do not delete or edit `.autocode/ownership`; changed or ambiguous bindings require preserving evidence and an explicit operator resolution.                                          |
| Template or contract error               | Fill all required sections, including `Scope` with `In` and `Out`; replace placeholders, explicit QA/deployment choices, and empty completion fields.                                                                                                            |
| Preparation rejects the worktree         | Use the linked feature worktree root on the contract's declared branch, with a clean Git status. Commit initialization's `.gitignore` change before preparation.                                                                                                 |
| Workflow needs checks                    | Initialization has an empty command list. Configure at least one actual deterministic check before `run`.                                                                                                                                                        |
| Executable/preflight failure             | Confirm the command resolves on the trusted PATH and its required resources are supported. Correct missing or invalid runtime/configuration before starting effects; preflight rejection does not create resumable model work.                                   |
| QA is missing or required adapter absent | Supply truthful operator policy. Required scenarios need a contained workflow API adapter; the CLI cannot supply one. Do not weaken required QA.                                                                                                                 |
| Check/review failure                     | Inspect retained evidence and the diff. Integrated fixes are bounded and must produce fresh checks/review; ceiling exhaustion is not success.                                                                                                                    |
| PR boundary is blocked                   | Confirm fresh checks, independent review and applicable QA passed, then perform operator publication/review/merge steps through repository policy. Exit code 1 is expected at this boundary.                                                                     |
| Resume says no matching run              | `resume` cannot create a run. Use `run` only for a new approved execution, after confirming there is no interrupted effect to reconcile.                                                                                                                         |
| Stale binding or workspace               | Compare task, Git head/branch, plan, policy, configuration, executable/resources and workspace with the recorded run. Preserve old evidence; changed inputs normally need a new prepared run on a new base commit.                                               |
| Protected-state tampering                | Stop and investigate the process and affected state. A receipt or transcript cannot turn a tampered run into passing evidence.                                                                                                                                   |

## Resume after interruption

Use the same matching worktree and inputs:

```powershell
node $autoCodeCli resume $taskWorktree
```

The PowerShell variables come from [getting started](getting-started.md). You can also supply both absolute paths directly.

Resume verifies the run and reconciles completed effects before continuing. Successful current receipts prevent repeated work, but an ambiguous in-flight model effect needs operator reconciliation. An interrupted QA or completion effect cannot be accepted merely because a receipt exists. There is no general CLI reconciliation/reset command; inspect the recorded effect and use the supported operator/API recovery boundary rather than replaying blindly.

Supplying a previously absent QA adapter through the API is safe only for its recorded preflight attempt that launched no callback. It does not authorize repeating an interrupted callback. Retry and elapsed-time budgets survive restart.

Do not delete locks, alter receipts or erase `.autocode/` to force a retry. Do not change the task to `done` or add local-only exceptions to bypass unresolved gates. Preserve implementation work and old evidence when preparing an explicitly new execution.

## Current compatibility limits

Contained subprocess execution currently fails closed on Linux and macOS. On Windows, verified Node/libuv execution cannot capture child-process pipes inside AppContainer; tools requiring that behavior can fail. Cross-volume batch execution and authenticated live Codex remain unaccepted. An executable may work in an ordinary terminal and still be unsupported in AutoCode.

Ignored files are private by default; known credentials and prior durable evidence remain private even with read grants. Sandbox profile/home locations and a minimal environment do not inherit operator tokens. Git configurations containing authentication or helper settings can also be unavailable inside containment. Do not copy credentials into tracked files or grant broad filesystem access as a workaround.

For authoritative implementation boundaries, see [WORKFLOW](../WORKFLOW.md), [SECURITY](../SECURITY.md) and [the acceptance audit](../MVP_AUDIT.md). Report a compatibility issue with the command name, relevant versions, sanitized reason and bounded logs; never include tokens, private keys or full private run directories.
