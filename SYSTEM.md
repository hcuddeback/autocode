# AutoCode system state

**Last verified:** 2026-09-11

**Stage:** AC-010 durable pause/resume implemented on its feature branch

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- A strict TypeScript foundation initializes local state, selects dependency-ready tasks, prepares commit-bound planning artifacts, invokes scoped role-separated Codex sessions, runs configured deterministic checks with retained evidence, applies reusable review/QA/fix policies, enforces configured completion gates, and executes bounded ordered effect phases through durable pause/resume checkpoints with reconciliation.

## Evidence level

| Claim                          | Evidence                                        | Confidence                                 |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------ |
| Documentation baseline exists  | Repository files and internal-link validation   | High                                       |
| CLI is usable                  | Build, initialization, and selection tests      | High                                       |
| Task selection is implemented  | Ready/blocked/malformed/completed fixture tests | High                                       |
| JIT planning is implemented    | Commit/task binding and artifact safety tests   | High                                       |
| Codex session roles exist      | Fake-Codex subprocess and failure-path tests    | High                                       |
| Verification evidence exists   | Deterministic subprocess and artifact fixtures  | High                                       |
| Bounded fix policy exists      | Deterministic transition and ceiling tests      | High                                       |
| QA applicability policy exists | Deterministic decision and scenario tests       | High                                       |
| PR-review disposition exists   | Deterministic finding/disposition tests         | High                                       |
| Completion gates exist         | Deterministic merge/production gate tests       | High                                       |
| Durable pause/resume exists    | Unit and forced-interruption subprocess tests   | High                                       |
| End-to-end workflow is wired   | Individual boundaries only                      | High confidence that it is not implemented |

## Known gaps and blockers

- CI, integrated workflow phase wiring, Codex session continuation, and durable pacing/retry budgets are absent.
- License has not been selected and added.

## Current milestone

**Outcome:** Execute one low-risk task locally through persisted phase transitions and deterministic verification, including interruption-safe resume.

**Evidence expected:** A fixture repository completes a recorded run; terminating and resuming does not repeat completed side effects.

**Stop condition:** Pause scope expansion if the vertical slice requires a hosted service, direct provider API, or broad multi-agent runtime.

## AC-001 evidence

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- `autocode init` creates `.autocode/config.yaml`, state directories, and a `.gitignore` rule without overwriting valid configuration.

## AC-002 evidence

- `autocode select` validates the task catalog and selects the first ready task only when every dependency is `done` and no task is already active.
- Tests cover initialization plus ready, active-work, blocked, malformed, completed, deterministic-ordering, untrusted-title, and symlink-boundary behavior.
- Independent and Codex PR-review findings on malformed filenames, filesystem replacement races, single-task WIP enforcement, and terminal-safe titles were corrected and reverified.

## AC-003 evidence

- `autocode prepare` validates the selected task contract and rejects template placeholders or missing required sections.
- Planning metadata and the task snapshot are bound to the selected task digest, source path, branch, and current commit.
- Repeated preparation preserves an edited plan; conflicting or symlinked artifacts fail safely.
- Preparation rejects dirty worktrees and branches that differ from the selected task contract.
- Preparation requires a linked worktree, validates declared Git branch names, and rechecks Git/task identity immediately before publishing artifacts.
- Planning-directory identities are revalidated around artifact creation, inspection, cleanup, and publication.
- Task validation rejects the editable placeholder prompts from `tasks/TASK_TEMPLATE.md`.
- Plan context contains only the selected task snapshot, leaving Codex execution to AC-004.

## AC-004 evidence

- `autocode sessions` consumes the commit-bound preparation and starts fresh implementation and independent-review Codex CLI sessions.
- The sessions directory is reserved atomically before Codex starts, so concurrent invocations cannot share or overwrite a run.
- Implementation uses the cross-version Codex workspace-write interface; review uses a read-only sandbox against uncommitted changes.
- Valid distinct thread identities and bounded JSONL, stderr, final message, and metadata are retained per role.
- Review starts only while the prepared branch and commit remain unchanged, implementation changes remain uncommitted, and protected `.autocode` plus ignored credential state remains identical; captured output and arguments are redacted using environment values, dotenv/JSON/YAML credential values, and known secret formats before persistence.
- Timeout and output-limit termination escalate to forceful process-tree shutdown and return within a fixed grace period. Default Linux Codex sessions run in a transient systemd user unit, providing kernel-enforced cgroup containment for daemonized descendants; unsupported non-Windows platforms fail closed.
- Non-`EPIPE` prompt-delivery failures terminate the subprocess before reporting failure, and successful sessions require a non-empty final
  agent message.
- Deterministic fake-Codex tests cover scoped prompts plus malformed events, missing final messages, duplicate identity, Git-state, protected-state and credential-state drift, timeout, output overflow, concurrent reservation, multi-format credential redaction, stale preparation, existing artifacts, and failed exits.

## AC-005 evidence

- `autocode verify` validates configured executable-and-argument arrays and runs them sequentially without a shell from the prepared worktree.
- The evidence directory is reserved before execution; each attempted check retains bounded redacted output, command identity, timing, exit status, and the prepared Git branch and commit.
- Verification stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change, retaining partial evidence and refusing to overwrite an existing run.
- Default Linux verification runs in a transient systemd user unit so detached descendants remain contained; unsupported non-Windows containment fails closed.
- Fixture tests cover successful sequences, partial failure, timeout, overflow, stale preparation, artifact collision, and unsafe configuration.

## AC-006 evidence

- Configuration validates a finite `fixLoop.maxAttempts` ceiling from 1 through 20 and defaults to three fix attempts.
- `runBoundedFixLoop` performs an initial check without consuming an attempt, then alternates fixes and checks without exceeding the ceiling.
- Passing checks succeed, blocking checks or fixes stop immediately as blocked, and exhaustion, callback failures, or malformed results fail closed.
- Ordered immutable transitions record each check/fix action, attempt number, outcome, and human-readable reason; callback exception details are not copied into evidence.
- Transition tests cover initial and eventual success, check/fix blockers, exact ceiling exhaustion, invalid results, callback failures, invalid policy, and immutable returned evidence.

## AC-007 evidence

- `runQaPhase` requires an explicit required or not-applicable decision; not-applicable reasons must contain at least 16 UTF-8 bytes.
- Not-applicable QA returns structured immutable evidence without running an adapter; required QA validates one through 32 uniquely named scenarios and runs them in order.
- Scenario evidence records sequence, identity, description, timing, outcome, reason, and bounded artifact references.
- Failed and blocked scenarios stop later work; callback failures and malformed or accessor-backed untrusted results fail closed without retaining exception details.
- Deterministic tests cover applicability decisions, ordered success, failed and blocked stopping, bounds and duplicates, invalid results, callback failures, stateful adapters, and deep immutability.

## AC-008 evidence

- `runPrReviewPhase` validates and snapshots zero through 64 uniquely identified findings with bounded severity, summary, and source evidence.
- Findings are processed in order and recorded as resolved, disputed with required evidence, or escalated; any escalation blocks passage after every finding receives a disposition.
- Empty reviews pass without invoking an adapter, while callback failures and malformed or accessor-backed untrusted results fail closed without leaking exception details.
- Deterministic tests cover clean reviews, mixed dispositions, escalation, bounds and duplicates, evidence requirements, callback failures, hostile data, ordered timing, stateful adapters, mutation isolation, and deep immutability.

## AC-009 evidence

- `evaluateCompletionGates` validates one through 64 uniquely configured gates per applicable phase and rejects duplicate or unconfigured observed signals.
- Merge evidence is fresh only when bound to the exact expected head commit; required production evidence is fresh only when bound to both the exact deployment identity and source commit.
- Production applicability is explicit: a bounded substantive not-applicable reason bypasses deployment evidence, while required production must configure and evaluate gates.
- Missing, pending, and stale signals block completion; current failed signals fail it and take precedence over blocked signals across phases.
- Deterministic tests cover passing merge/production and not-applicable paths, missing, pending, stale and failed signals, ordering, bounds, duplicates, unexpected signals, malformed and hostile data, caller mutation, and deep immutability.
- Codex PR-review findings about unsupported intermediate commit-identity lengths and prompt rejection of oversized untrusted text were corrected and reverified.

## AC-010 evidence

- `runDurableRun` validates one through 64 uniquely identified ordered phases and stores each run beneath the initialized project's `.autocode/runs/` boundary.
- Run and phase identifiers are canonical lowercase path segments, and known environment/workspace credentials are redacted from untrusted adapter reasons before durable persistence.
- Each transition is appended and synced before an atomic versioned snapshot replacement; newly published directory entries are synced where the runtime supports it, and a stable effect identity is durable before its adapter is invoked.
- Deliberate pause occurs only after phase completion, and repeated invocation resumes from the first incomplete phase while completed runs perform no additional effects.
- In-flight effects must reconcile as applied, not applied, or ambiguous. Applied effects are checkpointed without execution, confirmed absent effects reuse the original identity, and ambiguity blocks without invoking the effect.
- A child-process integration test writes an effect marker and terminates before completion is checkpointed; resume reclaims the dead local lock, reconciles the marker, and does not repeat the write.
- Deterministic tests also cover event-before-snapshot recovery, empty initial event-log recovery, interruption during lock release, reused process identifiers, pause-checkpoint recovery, definition drift, credential redaction, corrupt state, concurrent ownership, path traversal, hostile definitions/results, partial event tails, and deep immutability.

## Next task

Complete AC-010 review and PR gates, then select AC-011 for durable pacing, waits, and retry policy.

## Recently completed

- 2026-09-02 — Established the clean repository and documentation baseline.
- 2026-09-02 — Implemented the AC-001 CLI foundation on its feature branch.
- 2026-09-02 — Merged AC-001 through PR #1 and implemented AC-002 task selection on its feature branch.
- 2026-09-02 — Merged AC-002 through PR #2 and implemented AC-003 JIT planning preparation on its feature branch.
- 2026-09-02 — Merged AC-003 through PR #3 and selected AC-004 for role-separated Codex CLI sessions.
- 2026-09-02 — Implemented the AC-004 Codex session boundary on its isolated feature worktree.
- 2026-09-03 — Merged AC-004 through PR #4 and implemented AC-005 deterministic verification on its isolated feature worktree.
- 2026-09-03 — Merged AC-005 through PR #5 and implemented the AC-006 bounded fix-loop policy on its isolated feature worktree.
- 2026-09-09 — Merged AC-006 through PR #6 and selected AC-007 for QA applicability and evidence.
- 2026-09-09 — Merged AC-007 through PR #7 and selected AC-008 for Codex PR-review finding disposition.
- 2026-09-10 — Merged AC-008 through PR #9 and selected AC-009 for merge and production completion gates.
- 2026-09-11 — Merged AC-009 through PR #10 and selected AC-010 for interruption-safe pause and resume.

Update this file when a major capability, blocker, milestone, or release fact changes.
