# AutoCode system state

**Last verified:** 2026-09-14

**Stage:** AC-001 through AC-011 and PR #13 merged; AC-012 local workflow integration is published in PR #14 and unmerged

**Current release:** MVP 1 — one-task durable workflow foundation

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- The product, architecture, workflow, security, release, and task contracts are documented.
- A strict TypeScript foundation initializes local state, selects dependency-ready tasks, prepares commit-bound planning artifacts, invokes scoped role-separated Codex sessions, runs configured deterministic checks with retained evidence, applies reusable review/QA/fix policies, enforces configured completion gates, and executes bounded ordered effect phases through durable pause/resume checkpoints, reconciliation, and persisted pacing/retry budgets.

## Evidence level

| Claim                          | Evidence                                              | Confidence                                    |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------- |
| Documentation baseline exists  | Repository files and internal-link validation         | High                                          |
| CLI is usable                  | Build, initialization, and selection tests            | High                                          |
| Task selection is implemented  | Ready/blocked/malformed/completed fixture tests       | High                                          |
| JIT planning is implemented    | Commit/task binding and artifact safety tests         | High                                          |
| Codex session roles exist      | Fake-Codex subprocess and failure-path tests          | High                                          |
| Verification evidence exists   | Deterministic subprocess and artifact fixtures        | High                                          |
| Bounded fix policy exists      | Deterministic transition and ceiling tests            | High                                          |
| QA applicability policy exists | Deterministic decision and scenario tests             | High                                          |
| PR-review disposition exists   | Deterministic finding/disposition tests               | High                                          |
| Completion gates exist         | Deterministic merge/production gate tests             | High                                          |
| Durable pause/resume exists    | Unit and forced-interruption subprocess tests         | High                                          |
| Durable pacing/retry exists    | Restart, budget, cooldown, and backoff tests          | High                                          |
| Local workflow is integrated   | AC-012 phase fixtures, including process interruption | See latest AC-012 boundary verification below |

## Known gaps and blockers

- CI, required CLI QA adapters/QA-fix rounds, remote lifecycle adapters, and task completion updates are absent. Native Codex continuation is unused; fresh scoped roles provide the documented fallback.
- PR #13 merged as `63e8a49`. AC-012 is published in PR #14 from its isolated feature worktree. Integrated Codex, QA and verification share Windows AppContainer/Job containment; protected metadata writes and credential access are denied before execution, sanitized environments omit operator tokens, and tampering durably terminates runs. Fresh receipts cannot be pre-created; interrupted QA/completion require operator reconciliation. The latest boundary corrections below preserve concurrent ACL hardening and prevent trusted-host Git helpers from escaping containment. AC-012 remains in review under the required current-head remote review and human merge gates. Node captured-child pipes, cross-volume batch execution and live authenticated compatibility remain unaccepted; unsupported commands fail closed.
- The owner accepts the current chat as AC-012 independent review and authorizes commit, push, and PR creation without a separate manual review (D-005). Exact-head remote PR review and human merge authorization remain merge gates.
- Linux and macOS subprocess execution fail closed; PRODUCT's three-platform acceptance remains open.
- License has not been selected and added.

See `docs/MVP_AUDIT.md` for requirement-by-requirement code evidence and the remaining acceptance/release gaps. The complete MVP is not yet accepted or released.

## Latest AC-012 boundary checkpoint

### NuGet credentials and QA resource preflight, 2026-09-14

Security finding 4003589540 additionally identifies an ignored opaque SSH signing-key path. Git user.signingKey now participates in existing bounded, authorized private-file reference isolation, and its containing config is private. Current-head code findings 4003539351 and 4003539357 identify ignored NuGet.Config credentials and deterministic QA resource failures deferred until after model effects. Shared discovery now recognizes case-insensitive NuGet.Config, collects literal XML attribute values with standard entity decoding, and rejects unsupported DTD/entity/CDATA or NUL layouts before launch. Existing isolation and raw-byte freshness apply. Required contained QA adapters retain copied host configuration and preflight executable resolution, read-resource access and the existing sandbox resource inspection before planning or model effects, without launching QA or changing ACLs. Invalid resources leave no model effects and can be corrected on the same task/head. Containment version 11 rejects v10 and earlier receipts.

Fresh complete frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 source files and 33 workflow roots are covered exactly once. Other files run serialized, forced interruption runs alone, then three disjoint workflow groups run. An initial unchanged-source attempt hit one Windows EPERM during atomic verification-evidence directory rename; the isolated affected test and complete unchanged-source rerun pass. The original failure and isolated pass are retained explicitly in AC-012-pr14-nuget-final-base-initial-eperm.log and AC-012-pr14-nuget-final-rename-isolated.log. Hash-identical production-JavaScript boundary QA passes 56 tests, built pnpm CMD/CLI run-resume QA passes two, and the compiled QA-resource preflight/same-head correction regression passes one. Disposable production controls reproduce NuGet and opaque RSA signing-key exposure on the prior build; the corrected build protects both, plus Classic/pip credentials and nested prior evidence. Configured formatting, lint, typecheck, clean build and built CLI help pass with frozen source hashes matching. Ignored final proof is retained under .autocode/implementation-plans/AC-012-pr14-nuget-final-*. Exact-head remote reviews and human merge gates remain required; AC-012 stays in review and broader MVP acceptance is unclaimed.

### Yarn Classic and pip credential coverage, 2026-09-14

Security finding 4003280205 also identifies ignored virtualenv pip.ini credentials. Shared discovery now isolates pip.ini/pip.conf and applies existing INI scalar redaction and raw-byte freshness. Code-review finding 4003178000 identifies the distinct ignored Yarn Classic .yarnrc filename. Shared discovery now recognizes Classic and modern Yarn files. Literal Classic key/value and assignment syntax, quoted values and comments participate in scalar redaction; raw-byte hashing detects changes. Unsupported quoted syntax fails before launch with a generic error. Existing native credential isolation coverage includes Classic. Containment version 10 rejects v9 and earlier receipts.

Fresh frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 source files and 33 workflow roots are covered exactly once. The other 12 files run serialized, forced interruption runs alone, then three disjoint workflow groups run. Every final process exits zero without retry. Hash-identical production-JavaScript Windows boundary QA passes 56 tests; built pnpm CMD and CLI run/resume QA passes two. Disposable production controls reproduce Classic and pip credential reads; the corrected build denies both and still denies nested prior-run evidence. Configured formatting, lint, typecheck, clean build and built CLI help pass. Frozen source hashes match. Ignored proof is retained under .autocode/implementation-plans/AC-012-pr14-classic-final-*. AC-012 remains in review; exact-head remote reviews and human merge gates remain required. Broader MVP acceptance is unclaimed.

### Yarn credentials and private durable evidence, 2026-09-14

Security findings 4002943864 and 4002943867 identify ignored Yarn registry tokens and prior durable evidence exposed to sandboxed commands. Shared credential classification now recognizes .yarnrc.yml/.yaml; existing YAML scalar redaction and raw-byte freshness hashing apply, with explicit token/redaction/freshness and native denied-read coverage. Durable AutoCode metadata and every descendant are private to the trusted host, with credential ACL preflight and exact restoration. The driver supplies phase prompts/inputs directly; sandboxed commands cannot read earlier run transcripts. Public common Git metadata keeps its explicit role even when named .autocode. Existing read-only package grants on actual state refuse launch unchanged. The metadata-drift fixture uses an ordinary operator signal rather than reading private configuration. Containment version 9 covers these changes and literal SSH refusal, invalidating v8 and earlier receipts. Disposable controls reproduce both Yarn-token and nested prior-run evidence exposure on the earlier build.

Fresh combined frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations, all 13 source files/33 workflow roots exactly once. Other files run serialized; forced interruption runs alone, followed by three disjoint workflow groups. All final commands exit zero without retry. Production-JavaScript Windows boundary QA passes 56 tests; built pnpm CMD and CLI run/resume QA passes two. Disposable production proofs deny the Yarn token and nested prior-run evidence, and refuse the glob-based RSA-key reference preflight. Configured formatting, lint, typecheck, clean build and built CLI help pass with matching frozen source hashes. Superseded/failing controls remain explicitly historical. Exact-head remote reviews and human merge remain gates.

### Literal SSH syntax enforcement, 2026-09-14

PR finding 4002881520 demonstrates escaped-space and glob identity references that bypass literal-only isolation. SSH config commands now receive a single-pass conservative literal-character and balanced-quote check. Escaping, expansion, shell metacharacters, nonliteral paths and unbalanced quotes fail before launch; separate/joined literal -i and IdentityFile forms remain covered. Backslash/Unicode command layouts are unsupported and fail closed. No shell is interpreted or expanded by discovery. Private reference inspection also skips out-of-scope paths before lstat and refuses links before canonical resolution. Containment version 9 invalidates v8 and earlier receipts. Native regressions exercise escaped spaces, globs, environment substitutions, tilde/command substitution, operators and unbalanced quotes, preserving ACLs/contents and proving no process ran. A disposable generated RSA-key glob control reproduces the prior exposure.

Superseded pre-publication verification was stopped after the final security review identified the Yarn and durable-evidence findings. The latest checkpoint above supplies fresh combined-source proof; prior results are not reused.

### SSH identities and executable resource privacy, 2026-09-14

PR finding 4002683253 demonstrates that core.sshCommand can reference opaque private keys through -o IdentityFile= or joined -oIdentityFile= forms. Literal argument inspection now handles these forms alongside separate/joined -i, option quoting, value quoting and case-insensitive IdentityFile keys without executing or expanding commands. Native regressions protect every referenced target in current/additional repositories, preserve public config reads and ordinary writes, and restore original ACLs/contents. Containment version 8 invalidates v7 and earlier receipts.

Security finding 4002714550 confirms the same SSH-option gap. Unsupported SSH -F configuration indirection now fails before launch. Distinct finding 4002714553 identifies implicit executable/shim parent-directory read grants; selection now grants only the selected file, with no recursive parent grant or automatic DLL copying. Additional runtime files require explicit host authorization and unsupported layouts fail closed. Native executable/shim controls reproduce colocated credential exposure on the earlier build; fixed cases preserve credential privacy, ACLs, contents and ordinary writes. The pnpm fixture keeps its helper inside the authorized package/worktree scope.

Fresh final frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations, all 13 files and 33 workflow roots exactly once. Other files run serialized, the forced-interruption fixture runs alone, and the remaining workflow roots run in three disjoint processes. All final commands exit zero without retry. Production-JavaScript Windows boundary QA passes 56 tests; built pnpm CMD and CLI run/resume QA passes two. The generated RSA SSH-option reference is protected by the final build. Configured formatting, lint, typecheck, clean build and built CLI help pass with matching frozen hashes. Earlier failing controls and superseded verification remain explicitly historical; exact-head remote reviews and human merge remain gates.

### Private Git file references and explicit metadata roles, 2026-09-14

Independent critical review reproduced an opaque generated RSA private key exposed through http.sslKey despite isolating its config. Known Git TLS key/certificate, cookie, credential-file, literal askpass, SSH identity and credential-store references now receive bounded canonical discovery and credential isolation inside authorized resources. References do not execute helpers, read private file contents or authorize external resources. PR finding 4002440974 additionally showed a custom common directory named .autocode; discovery now carries its explicit Git metadata role independently of the basename, including recursive module privacy. New regressions preserve public parent config/refs, ordinary writes, original contents and ACL restoration. Containment version 7 invalidates v6 and earlier receipts.

Fresh frozen-source verification covers all 306 cases: 302 pass, four platform skips, zero failures/cancellations and every one of 13 source files/33 workflow roots exactly once. The forced-interruption fixture runs alone; other files are serialized and the remaining workflow roots run in three disjoint processes. Every command exits zero, with no retry required. Fresh production-JavaScript boundary QA passes 52 tests; built pnpm CMD and CLI run/resume QA passes two. The real disposable RSA-key regression now reports PRIVATE_REFERENCE_PROTECTED. Configured formatting, lint, typecheck, clean build and built CLI help pass; source hashes match. Current-head remote review and human merge remain gates.

### Submodule metadata privacy, 2026-09-13

PR #14 security finding 4002215127 on 216c1a4 identifies credentials in standard submodule configs and included fragments under common Git modules metadata. The complete modules namespace is now private by default, including nested submodules, opaque filenames and nested reserved metadata. Every descendant receives credential ACL preflight/isolation; a preexisting package-read grant on an included fragment blocks launch unchanged. No filename or config-include inference authorizes private submodule reads. Git commands requiring submodule metadata can therefore be unavailable; no private-data fallback exists.

Native regressions cover current/additional repositories and registered linked worktrees, included config fragments, nested module URL credentials, opaque files, denied reads, ordinary authorized writes, readable parent Git configs/refs and exact ACL/content restoration. Published-source controls reproduce all four cases; the fixed five-test group passes. Containment version 6 invalidates v5 and earlier receipts. The owner-accepted chat supplies scoped independent critical review.

Referenced includes are isolated even when they leave the modules subtree. The guarded Git reader uses --no-includes; a separate bounded, deduplicated walk parses only regular referenced files inside resources authorized for sandbox access, including chained and conditional includes. Includes do not authorize external host reads or grants. Every existing in-scope referenced file remains private, cycles terminate through canonical inspection caching, and more than 1,000 include targets or unsafe inspection fails closed without raw config values. A module-only control reproduces outside-fragment exposure; the complete fixed config/include group passes 12 native tests.

Fresh final-source coverage verifies all 304 cases: 300 passed and four platform skips, covering all 13 source test files and all 33 workflow registrations. Other files run serialized and workflow tests run in three isolated, disjoint Node processes. The initial parallel run passed 299 cases with four skips and one forced-interruption-fixture failure at its 30-second outer process budget. With all competing QA finished, that sole failed fixture passes in isolation; source, assertions and timeouts are unchanged. The original failed attempt remains intact. `.autocode/implementation-plans/AC-012-pr14-modules-verified-coverage.json` maps every workflow root to its successful evidence and records the failed attempt plus retry explicitly; raw suite/manifest/process logs and `AC-012-pr14-modules-interruption-retry.log` are retained. Compiled Windows boundary QA passes 50 tests and compiled pnpm CMD/CLI run-resume QA passes two, using hash-identical production JavaScript. Configured formatting, lint, typecheck, clean production build and built CLI help pass. Frozen source hashes match. Earlier aborted/module-only runs do not support this checkpoint.

AC-012 remains in review under exact-head external review and human merge gates; this does not claim broader MVP acceptance.

### Historical Git metadata authorization and config isolation, 2026-09-13

PR #14's P1 findings (4001840321 and 4001840327) on e951cce are corrected. An external common Git directory requires original explicit directory read authorization or a registered linked worktree whose canonical back-pointer resolves to this workspace's .git file. Derived read grants do not authorize another repository. Unrelated pointers, including pointers to another registered worktree, fail before launch grants. Actual registered feature worktrees remain supported.

Bounded Git config parsing does not follow includes. Config/config.worktree files with URL user information, auth headers, credential settings, private references, includes or embedded helper commands receive credential isolation; public configs and valueless booleans remain readable. Git inspection errors retain no raw output that could include secrets. Credential-bearing configs may prevent commands that require those files; no secret-bearing config or authentication fallback is exposed. Containment version 5 invalidates v4 and earlier receipts.

Positive controls on e951cce reproduce both bypasses in disposable fixtures. Native regressions reject unregistered/wrong-worktree pointers with no child launch and unchanged ACLs, permit explicitly authorized reads, deny private config reads in current/additional repositories, preserve exact config contents/ACLs and retain public config reads. The owner-accepted chat supplies independent critical review.

Native Codex fixture defaults now allow Windows host startup while retaining explicit short-timeout tests and production limits. Detailed failure reproduction showed the prior two-second fixture budget expired before artifact/duplicate/orphan/overflow assertions; all five focused assertions pass after this correction. Public refs and worktree identifiers named config are regression-covered as data labels; only actual Git config locations are parsed.

Final root review also protects directly authorized .credentials/.secrets directories and their opaque files, includes core.askPass authentication helpers in config isolation, and limits writable .autocode enclaves to registered worktrees under .autocode/worktrees with external common metadata. Plain Git markers cannot reclassify cache/run state. Native old-source controls reproduce these gaps; fixed cases retain registered infrastructure and preserve original ACLs/content.

Fresh verification on the frozen final source: all 13 source test files and all 33 workflow test registrations are covered exactly once. The complete source suite passes 295 tests with four platform skips and zero failures/cancellations; other files run serialized and workflow tests run in three isolated, disjoint Node-process shards. Compiled Windows boundary QA passes 45 tests, and compiled pnpm CMD/CLI run-resume QA passes two. Configured formatting, lint, typecheck, clean production build and built CLI help pass. Source hashes match the frozen snapshot. Ignored evidence is retained in `.autocode/implementation-plans/AC-012-pr14-git-suite-results.json`, its manifest and per-process logs, and `AC-012-pr14-final-built-host.log` / `AC-012-pr14-final-built-workflow.log`. One earlier unchanged-source attempt encountered a Windows EBUSY fixture-cleanup error; the complete same-source rerun passes. Earlier aborted or superseded runs do not support this checkpoint.

This checkpoint supersedes earlier metadata read authorization and config coverage. AC-012 remains in review under exact-head remote review and human merge gates; broader MVP acceptance remains unclaimed.

### Historical additional writable-root boundary corrections, 2026-09-13

PR #14's P1 credential-root finding (4001625111) and P2 metadata-root finding (4001625113) on c76db07 exposed additional paths to the same isolation boundary. Before any launch grants, discovery now covers every writable root, including sibling/parent resources, nested repositories and linked common Git metadata. Case aliases and covering roots are deduplicated. Shared credential classification protects direct cloud credential directories and private metadata stores; all reserved .git/.autocode descendants receive protected metadata boundaries. Roots inside protected metadata fail closed before launch. Public Git data labels remain readable and ordinary authorized files remain writable. Complete traversal is bounded to 100,000 entries, with a 10,000-entry generic-resource limit. Containment version 4 rejects v3 and earlier receipts.

Native regressions cover sibling, parent, nested, linked and case-alias roots; deny credential read/write/rename/delete and metadata write/rename/delete; preserve exact original ACLs and contents; and verify safe ordinary writes and public Git reads. Additional cases protect a directly authorized cloud directory and reject metadata-root overlap without launching. Positive controls against c76db07 reproduced the original credential/metadata bypasses in disposable fixtures. The owner-accepted chat supplies independent critical review.

Fresh verification over c76db07: the complete serialized source suite passes 279 tests, with four platform-specific skips and zero failures; no tests are omitted. Compiled Windows boundary QA passes 29 tests, and compiled pnpm CMD/CLI run-resume QA passes two. Configured formatting, lint, typecheck, clean production build, built CLI help and diff checks pass. Frozen source hashes remain unchanged. Evidence is retained under gitignored .autocode/implementation-plans/AC-012-pr14-extra-*.log.

This checkpoint supersedes containment version 3's writable-root coverage. AC-012 remains in review under exact-head remote review and human merge gates. Existing command/platform and live-authentication acceptance gaps remain recorded below; complete MVP acceptance is not claimed.

### Historical credential and Git inspection boundary corrections, 2026-09-13

The latest P2 ACL-cleanup finding (3999340870) and P1 common-credential-filename finding on PR #14 are corrected. Shared discovery covers dotenv, npm/netrc/pypirc/Git auth, auth JSON/YAML, private keys and sensitive cloud/SSH/Kubernetes/Docker paths. Raw-byte fingerprints detect binary changes; bounded format-aware redaction also handles padded YAML tokens. Generic non-repository launches scan recursively with a 10,000-entry ceiling and fail closed on credential links or overflow.

Credential isolation never removes and reconstructs preexisting package/capability allows. Such access blocks launch and requires operator hardening, leaving those ACL entries unchanged. Normal and timeout cleanup remove only launch-specific permissions and restore inheritance only when the recorded temporary boundary is unchanged; concurrent hardening remains authoritative. Containment version 3 invalidates earlier receipts.

Critical review found that trusted-host Git inspection could execute text-conversion, clean/process-filter and filesystem-monitor helpers outside containment and conceal changes. Every production Git inspection call now disables these helpers, including smudge filters and external diff drivers. A regression includes actual unsafe positive controls, confirms no helper executes through AutoCode, and verifies hidden edits invalidate evidence.

Critical review also reproduced preexisting package write access on a descendant of protected metadata. Recursive metadata ACL preflight now rejects package/capability write/delete/ACL-changing rights, null ACLs and links, with a 100,000-entry ceiling before enqueue. Safe package read access remains allowed; regression verifies read access, write denial, unchanged original ACLs and fail-closed unsafe launch.

Fresh verification of the corrections over 9f1e4e1: the complete serialized source suite outside the restricted Windows sandbox passes 271 tests, with four platform-specific skips and zero failures; no tests are omitted. Compiled Windows boundary QA passes 21 tests, and compiled pnpm CMD/CLI run-resume QA passes two. Configured formatting, lint, typecheck, clean build, built CLI help and diff checks pass. The source hashes remain identical to the frozen verification snapshot. Evidence is retained under gitignored .autocode/implementation-plans/AC-012-pr14-*.log.

The owner-accepted chat supplies independent critical review, including the reproduced Git-helper and padded-token findings and their corrections. Exact-head remote PR review and human merge authorization remain gates; AC-012 stays in review. Production verification is not applicable. Live authenticated Codex compatibility, captured Node child-process pipes, cross-volume batch execution, unsupported platforms and broader MVP acceptance remain unaccepted; no raw-process fallback is enabled. This checkpoint supersedes earlier claims of reconstructing original package ACL grants.

## Historical AC-012 review corrections

Published as [PR #14](https://github.com/hcuddeback/autocode/pull/14) from `feat/AC-012-integrated-workflow`. Commit `1980bca` contains the verified corrections and owner-authorized publication policy changes. The owner accepts this chat as the independent review. Required exact-head PR review and human merge authorization remain pending.

The AC-012 feature worktree now checks all protected AutoCode state around deterministic commands and QA callbacks. Detected state tampering terminates the run before forged receipts can advance it, and restart cannot complete a failed run. Separate, immutable QA preflight receipts bind the missing adapter to one effect and attempt. Supplying the adapter resumes that unstarted attempt through the durable retry policy; prior preflight evidence cannot replay an interrupted callback.

The full serialized suite after these source changes passed 201 tests with four platform skips and no failures in the restricted Windows sandbox using Node.js 24.19.0 and the locked repository tools. The focused regression run passed seven tests. Formatting, lint, typecheck, clean compilation, built CLI help, and a built CLI run/resume fixture pass. Evidence is retained under the feature worktree's gitignored `.autocode/implementation-plans/`. The owner accepts this chat as the independent review and both findings are resolved with regression evidence. Publication is authorized under D-005; required PR/merge gates remain pending.

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
- Timeout and output-limit termination escalate to forceful process-tree shutdown and return within a fixed grace period. Windows Codex sessions use AppContainers and kill-on-close Job Objects; Linux and macOS execution fail closed pending accepted containment.
- Non-`EPIPE` prompt-delivery failures terminate the subprocess before reporting failure, and successful sessions require a non-empty final
  agent message.
- Deterministic fake-Codex tests cover scoped prompts plus malformed events, missing final messages, duplicate identity, Git-state, protected-state and credential-state drift, timeout, output overflow, concurrent reservation, multi-format credential redaction, stale preparation, existing artifacts, and failed exits.

## AC-005 evidence

- `autocode verify` validates configured executable-and-argument arrays and runs them sequentially without a shell from the prepared worktree.
- The evidence directory is reserved before execution; each attempted check retains bounded redacted output, command identity, timing, exit status, and the prepared Git branch and commit.
- Verification stops on the first nonzero exit, timeout, output overflow, Git-identity change, or worktree change, retaining partial evidence and refusing to overwrite an existing run.
- Windows verification uses AppContainers and Job Objects for native commands and contained CMD/BAT shims with escaped arguments and delayed expansion disabled; Linux and macOS execution fail closed pending accepted containment.
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
- Run and phase identifiers are canonical lowercase path segments; each invocation verifies that its run path remains untracked and gitignored, rejects credential-bearing definitions, and redacts known environment values plus explicitly discovered workspace credentials of four or more characters from untrusted adapter reasons before durable persistence, refreshing credential discovery after every adapter callback.
- Each transition is appended and synced before an atomic versioned snapshot replacement; newly published directory entries are synced where the runtime supports it, and a stable effect identity is durable before its adapter is invoked.
- Deliberate pause occurs only after phase completion, and repeated invocation resumes from the first incomplete phase while completed runs perform no additional effects.
- In-flight effects must reconcile as applied, not applied, or ambiguous. Applied effects are checkpointed without execution, confirmed absent effects reuse the original identity, and ambiguity blocks without invoking the effect.
- A child-process integration test writes an effect marker and terminates before completion is checkpointed; resume reclaims the dead local lock, reconciles the marker, and does not repeat the write.
- Deterministic tests also cover event-before-snapshot recovery, empty initial event-log recovery, interruption during lock release, reused process identifiers, symlinked lock rejection, pause-checkpoint recovery, definition drift, bounded credential redaction/rejection, Git ignore and tracking drift, corrupt state, concurrent ownership, path traversal, hostile definitions/results, partial event tails, and deep immutability.
- PR #11 merged as `48b5dcf` before two final P1 findings were posted. A bounded follow-up on `fix/AC-010-review-findings` checks the exact moved lock owner before deletion, excludes live quarantined owners during acquisition, recovers abandoned dead quarantines, and redacts eligible raw and JSON-escaped secret literals longest-first. Regression tests reproduce concurrent stale/empty-lock reclamation with a third contender and verify overlapping credentials do not reach durable evidence.
- Follow-up verification passes formatting, lint, typecheck, compilation, all 22 durable-run tests, and both focused redaction tests. The full suite passes outside the restricted Windows sandbox with one test file at a time (162 passed, four platform-specific skips, no tests omitted). Earlier parallel runs encountered unrelated Windows concurrent-initialization EPERM/EBUSY failures. The owner authorized external Codex review of this diff; independent read-only review found no actionable regressions. Fixes were published as `51ddc9d` in PR #13; both original PR #11 threads are resolved, and no unresolved threads remain on PR #11. PR #13 subsequently merged on main as 63e8a49.

## AC-011 evidence

- Durable definitions accept a bounded attempt ceiling, elapsed-time ceiling, minimum effect interval, exponential backoff, and backoff cap; retryable adapter results may add a bounded retry-after delay.
- Every adapter invocation is preceded by a durable attempt-start event. Retry decisions store an absolute next-attempt timestamp before waiting, while the elapsed budget remains anchored to the original persisted run creation time.
- Restart tests prove a partially elapsed wait is resumed only for its remainder and that attempts already consumed cannot be reset or exceed their ceiling.
- Confirmed-not-applied reconciliation schedules a new counted attempt with the original stable effect identity; ambiguous effects remain blocked without retry.
- Exhausted attempt or elapsed-time budgets persist a terminal failed result. Invalid policies, retry delays, clocks, waits, snapshots, and hostile values fail closed.
- Snapshot schema version 2 records pacing state and can upgrade compatible AC-010 version 1 snapshots by replaying their durable event history without repeating effects.
- AC-011 review fixes validate the exponential-backoff lower bound during event replay and recheck the elapsed ceiling immediately before adapter invocation and at safe completion boundaries. Late confirmed effects remain checkpointed as applied while the run fails, including after interrupted completion and reconciliation. Completion-event clock races persist failure without corrupting resumable history. Independent read-only Codex review passes; the full suite passes outside the restricted sandbox (173 passed, four platform-specific skips), while sandboxed runs encounter unrelated Windows initialization-lock EPERM/EBUSY failures.

## Next task

AC-012 verification was refreshed on 2026-09-12 against implementation commit `1509c66`: formatting, lint, typecheck, compilation, built CLI help, and diff checks pass. The full serialized suite outside the restricted Windows sandbox passes 193 tests with four platform-specific skips and no failures, including CLI fixture QA and interruption/resume. The restricted run reproduced the known concurrent-initialization failure and was stopped before the full rerun. This historical checkpoint preceded the owner-accepted chat review and D-005 publication authorization; current correction evidence is recorded above.

Finish required review/merge gates for AC-012 PR #14; the owner-accepted chat review is recorded above. Then select the next remaining MVP outcome from `docs/MVP_AUDIT.md` after resolving the external lifecycle scope question.

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

- 2026-09-11 — Confirmed AC-011 merged through PR #12 as `c2625a7` and AC-010 follow-up merged through PR #13 as `63e8a49`.
- 2026-09-11 — Created AC-012 and implemented its local durable workflow on an isolated feature worktree; acceptance audit records the remaining full MVP gaps.

Update this file when a major capability, blocker, milestone, or release fact changes.
