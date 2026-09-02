# AutoCode security

**Status:** Baseline design

**Last reviewed:** 2026-09-02

## Data classification

| Data | Classification | Stored where | Retention |
|---|---|---|---|
| Tasks/configuration | Internal | Repository and `.autocode/` | Project controlled |
| Run evidence | Potentially sensitive | Gitignored `.autocode/runs/` | Configurable/operator deletable |
| Credentials | Secret | Existing OS/CLI/provider stores | Never copied into AutoCode state |
| Repository content | Project-defined | Repository/worktree | Repository policy |

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

- [ ] Traversal and command-policy tests pass.
- [ ] Redaction and malicious-input tests pass.
- [ ] Dependency audit and secret scan pass.
- [ ] Worktree isolation/unrelated-change tests pass.
- [ ] Resume reconciles ambiguous effects safely.

## Vulnerability reporting

Do not publish exploitable details or secrets in an issue. Configure a private reporting channel before the first release.
