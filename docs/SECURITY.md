# AutoCode security

**Status:** Baseline design

**Last reviewed:** 2026-09-13 (AC-012 corrections; owner-accepted chat review)

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

The integrated workflow accepts only fixed callbacks created by createContainedQaAdapter, which invokes a bounded subprocess on the trusted PATH. Arbitrary in-process callbacks are rejected before model effects. Windows batch shims use a trusted cmd.exe interpreter with escaped arguments and delayed expansion disabled; batch NUL/line-break arguments fail preflight. The interpreter is contained just like native binaries. Windows creates a per-launch AppContainer with only the internetClient capability, grants worktree access and explicitly authorized host resources, and starts the subprocess suspended in a kill-on-close Job Object before execution; the host waits for descendant termination before returning and kills the job if the operator process dies. Linux execution fails closed before process launch or workflow-history acceptance: user cgroups do not isolate the user manager, which can launch surviving sibling units. Linux requires verified manager isolation; macOS acceptance also remains open. Protected-state and credential snapshots are checked only after process containment finishes. The standalone runQaPhase policy helper accepts trusted host callbacks and is not a process containment boundary. QA receipt-only reconciliation therefore always remains ambiguous, even for an apparently passing receipt. A durable completed QA phase remains reusable; an interrupted or blocked callback requires operator reconciliation and is never automatically repeated. Attempt-bound missing-adapter recovery is available only when no QA receipt exists and no callback ran. Credential changes after QA returns invalidate workspace freshness on resume.

Fresh workflow execution rejects pre-existing phase receipts as terminal tampering; only reconciliation of an already in-flight effect may reuse a validated receipt. Atomic publication also rejects receipt collisions. Every deterministic verification command checks the discovered ignored credential file set and content hashes before accepting evidence, including unsuccessful commands. Credential tampering retains failed check evidence and terminates the workflow before later checks or gates.

Integrated Codex planning, implementation, review and fix roles, plus deterministic verification commands, use the same contained subprocess boundary as QA before protected-state checks. Windows standalone Codex sessions also use the AppContainer and Job Object path. Codex prompts are supplied as UTF-8 input through the trusted host. Codex protected-state and credential checks run after every role invocation, including subprocess failure or invalid output. Detected tampering takes precedence over role errors and produces a terminal durable workflow failure without publishing a phase receipt. Resume of that failed run cannot reconcile injected downstream receipts into passing gates.

Workflow receipts redact free-text payload values before serialization, preserving JSON types, validated gate controls, and freshness metadata. Review verdicts are validated from bounded raw model output in memory before redacted display artifacts are written; display text is never used as gate authority. QA protects the discovered ignored credential file set and content hashes, including additions and deletions. Credential fingerprints also bind workflow freshness, so changing ignored credentials invalidates prior evidence on resume.

AC-012 protects operator workflow policy from model changes, rejects symlinked receipt inputs, checks file identity around reads, publishes receipts without overwrite, and binds phase results to the exact task/configuration/plan/Git/workspace identity. Deterministic commands are checked against all protected AutoCode state, excluding only their current verification output directory. State tampering produces a terminal workflow failure before any forged receipt can advance the run, including after restart. QA callbacks cannot change protected state and retain passing results. Read-only role or QA workspace changes invalidate local completion. Attempt-bound preflight receipts permit retry only when a missing QA adapter prevented any callback invocation; interrupted callbacks remain ambiguous. Uncertain interrupted model effects remain blocked; no remote effects are issued by the integrated runner. Independent source review, distribution verification, dependency audit, and secret scan remain separate gates; do not mark this checklist complete from the fixture tests alone.

- [ ] Traversal and command-policy tests pass.
- [ ] Redaction and malicious-input tests pass.
- [ ] Dependency audit and secret scan pass.
- [ ] Worktree isolation/unrelated-change tests pass.
- [ ] Resume reconciles ambiguous effects safely.

## Vulnerability reporting

Do not publish exploitable details or secrets in an issue. Configure a private reporting channel before the first release.

AppContainer resources are copied from trusted host options, never inferred from model output or arbitrary command arguments. Additional writable directories and readable resources require explicit host authorization. Codex command-prefix paths are explicit operator read resources. Writable grants exclude `.autocode`, `.git` and common Git metadata; those resources receive read access only, including when a trusted writable directory contains them. Directory grants omit delete-child and ACL-changing rights. The boundary prevents metadata mutation before a parent-side check, including during operator interruption. Metadata boundaries temporarily stop ACL inheritance and remove this launch’s inherited write grants while retaining operator permissions; cleanup restores unchanged temporary inheritance and preserves unrelated explicit entries. Discovered ignored credentials receive no sandbox package/capability access during execution. Existing package/capability allows block launch without changing those entries. Credential boundaries retain operator access; cleanup removes only launch-specific grants and restores unchanged temporary inheritance without reconstructing prior package entries. A containment-version binding rejects legacy Job-only and credential-exposing AppContainer receipts on resume. The helper script and I/O directory must be outside every writable resource. Per-launch profiles, ACL entries and I/O files are removed after descendant termination, including parent-side cleanup after timeout using a protected ACL-target manifest; profile removal retries transient teardown errors without changing other ACL entries. Private runtime copies avoid changing system-installed executable permissions. No raw-process fallback is permitted.

The verified Node.js 24.19.0/libuv 1.52.1 runtime cannot create captured child-process pipes inside AppContainer; those commands fail closed at their configured limits. Node script loading uses preserve-symlinks flags to avoid requiring filesystem-ancestor grants. Batch commands on a different volume and live authenticated Codex compatibility remain unaccepted. The contained CMD fixture validates the interpreter boundary, not every package-manager operation. These are command/platform acceptance gaps, not passing workflow evidence.

Sandbox commands receive an explicit Unicode environment containing system/runtime variables and private temporary/profile/home directories. Operator tokens, provider keys, proxy credentials and unrelated variables are omitted. Implicit CLI authentication is unavailable; explicit credential-reference integration and authenticated live compatibility remain acceptance gaps. Raw-process or inherited-environment fallbacks are forbidden. Artifact redaction and credential fingerprints remain independent protections for synthetic output and privileged concurrent changes.

Credential discovery uses one shared path classifier for workflow freshness and process launches. It covers dotenv, npm/netrc/pypirc/Git authentication, auth JSON/YAML, private-key formats, and sensitive credential/cloud/SSH/Kubernetes/Docker directories. Before granting access, launches inspect every writable root, including parent/sibling resources, nested repositories and linked common Git directories. Case aliases and covered roots are deduplicated. Git repositories discover ignored files; generic resources use a 10,000-entry ceiling, with a 100,000-entry ceiling for the complete resource walk. Overflow and credential links fail closed. Directly authorized cloud credential directories remain credential boundaries. Fingerprints hash raw file bytes, including binary keys. INI assignments, netrc tokens, Git URL credentials, structured scalars and private-key bodies supply bounded redaction values.

Credential isolation no longer removes and reconstructs existing package/capability allow entries. A credential with preexisting application-package access blocks launch and requires operator hardening; its permissions are left unchanged. Existing deny entries are retained. Temporary boundaries remove only the unique launch SID and preserve operator access. Normal and fallback cleanup restore inheritance only when the current access descriptor still matches the recorded applied boundary after launch-SID removal. Concurrent access-rule changes leave the current boundary authoritative. Containment version 4 rejects receipts from earlier credential-discovery, writable-root and ACL-restoration behavior.

All trusted-host Git inspection calls disable filesystem-monitor hooks and configured clean/smudge/process filters; diff inspection also disables external diff drivers and text-conversion helpers. Repository-controlled helpers must not escape through the parent's evidence/freshness checks. Workspace fingerprints include edits even when a configured text-conversion driver would conceal them. A regression reproduces text-conversion, clean-filter, process-filter and filesystem-monitor executions as positive controls and verifies inspection neither runs the helpers nor accepts masked changes.

Protected metadata ACLs are inspected recursively before launch. Preexisting package/capability write, append, delete, permission-changing or ownership access blocks launch without rewriting those entries, including grants on descendant files. Safe package read access remains available. Inspection fails closed on null ACLs, metadata links or a 100,000-entry ceiling; launch-specific inherited grants remain governed by the temporary boundary.

Every `.git` and `.autocode` descendant of an authorized writable resource, plus nested repositories' common Git metadata, receives the same protected boundary. Writable roots inside protected metadata are rejected before launch. Linked feature worktrees remain supported. Public Git object/ref/reflog names and worktree identifiers are data labels; known private stores elsewhere in metadata remain credential boundaries.
