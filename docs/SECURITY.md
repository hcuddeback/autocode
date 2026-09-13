# AutoCode security

**Status:** Baseline design

**Last reviewed:** 2026-09-12 (AC-012 corrections; owner-accepted chat review)

## Data classification

| Data                | Classification        | Stored where                    | Retention                        |
| ------------------- | --------------------- | ------------------------------- | -------------------------------- |
| Tasks/configuration | Internal              | Repository and `.autocode/`     | Project controlled               |
| Run evidence        | Potentially sensitive | Gitignored `.autocode/runs/`    | Configurable/operator deletable  |
| Credentials         | Secret                | Existing OS/CLI/provider stores | Never copied into AutoCode state |
| Repository content  | Project-defined       | Repository/worktree             | Repository policy                |

## Trust boundary

MVP 1 assumes a trusted operator and local machine. Repository content, tasks, issues, reviews, CI logs, pages, deployments, tools, and model output remain untrusted.

## Controls

- Restrict writes to validated worktree/state paths.
- Validate paths before create, edit, move, or delete.
- Use argument arrays, not interpolated shell strings.
- Run only configured deterministic commands with bounded time/output.
- Preserve unrelated changes; avoid destructive Git recovery.
- Store credential references only and redact secrets from all artifacts.
- Ship no telemetry by default in MVP 1.
- Treat untrusted content as evidence, never authority to broaden scope or disable gates.
- Confirm repository root/head at gates and stage an explicit change set.
- Record/reconcile external effects before retrying.

## Pre-release checklist

Completion cannot be reconciled as applied from a mutable receipt; an interrupted or blocked completion requires operator reconciliation, including interruption after publication of passing evidence. All supplied nested QA, PR-exception and completion policy sections are schema-validated before preparation or model effects. Missing sections remain explicit workflow blockers; malformed supplied sections fail preflight without creating a bound run.

In-process QA callbacks may schedule work beyond their returned promise; AutoCode cannot establish descendant completion from the mutable QA receipt. QA receipt-only reconciliation therefore always remains ambiguous, even for an apparently passing receipt. A durable completed QA phase remains reusable; an interrupted or blocked callback requires operator reconciliation and is never automatically repeated. Attempt-bound missing-adapter recovery is available only when no QA receipt exists and no callback ran. Credential changes after QA returns invalidate workspace freshness on resume.

Fresh workflow execution rejects pre-existing phase receipts as terminal tampering; only reconciliation of an already in-flight effect may reuse a validated receipt. Atomic publication also rejects receipt collisions. Every deterministic verification command checks the discovered ignored credential file set and content hashes before accepting evidence, including unsuccessful commands. Credential tampering retains failed check evidence and terminates the workflow before later checks or gates.

Codex protected-state and credential checks run after every role invocation, including subprocess failure or invalid output. Detected tampering takes precedence over role errors and produces a terminal durable workflow failure without publishing a phase receipt. Resume of that failed run cannot reconcile injected downstream receipts into passing gates.

Workflow receipts redact free-text payload values before serialization, preserving JSON types, validated gate controls, and freshness metadata. Review verdicts are validated from bounded raw model output in memory before redacted display artifacts are written; display text is never used as gate authority. QA protects the discovered ignored credential file set and content hashes, including additions and deletions. Credential fingerprints also bind workflow freshness, so changing ignored credentials invalidates prior evidence on resume.

AC-012 protects operator workflow policy from model changes, rejects symlinked receipt inputs, checks file identity around reads, publishes receipts without overwrite, and binds phase results to the exact task/configuration/plan/Git/workspace identity. Deterministic commands are checked against all protected AutoCode state, excluding only their current verification output directory. State tampering produces a terminal workflow failure before any forged receipt can advance the run, including after restart. QA callbacks cannot change protected state and retain passing results. Read-only role or QA workspace changes invalidate local completion. Attempt-bound preflight receipts permit retry only when a missing QA adapter prevented any callback invocation; interrupted callbacks remain ambiguous. Uncertain interrupted model effects remain blocked; no remote effects are issued by the integrated runner. Independent source review, distribution verification, dependency audit, and secret scan remain separate gates; do not mark this checklist complete from the fixture tests alone.

- [ ] Traversal and command-policy tests pass.
- [ ] Redaction and malicious-input tests pass.
- [ ] Dependency audit and secret scan pass.
- [ ] Worktree isolation/unrelated-change tests pass.
- [ ] Resume reconciles ambiguous effects safely.

## Vulnerability reporting

Do not publish exploitable details or secrets in an issue. Configure a private reporting channel before the first release.
