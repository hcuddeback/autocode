# AutoCode system state

**Last verified:** 2026-09-15 AC-015 implementation verification on `feat/AC-015-configurable-role-runners` from `main` at `8a842a2`

**Stage:** AC-001 through AC-014 remain complete historical delivery; AC-015 is implemented on its feature branch and remains the single active workbook task pending repository gates

**Current release target:** MVP 1 — ordered JIT task workbook

**Production:** Not deployed

## What is true now

- The clean public repository exists.
- Product acceptance, target architecture, workflow, security, release, and the canonical task workbook are documented.
- A strict TypeScript foundation initializes local state, selects one dependency-ready materialized task, prepares commit-bound planning artifacts, resolves planner/implementer/reviewer/fixer assignments, runs configured deterministic checks with retained evidence, applies reusable review/QA/fix policies, enforces configured completion gates, and executes bounded ordered effect phases through durable pause/resume checkpoints, reconciliation, and persisted pacing/retry budgets.
- Version-1 configuration accepts a complete role-to-runner/optional-model map and safely defaults existing files without that map to Codex. Core workflow sequencing consumes provider-neutral capability and bounded result contracts; `codex-runner.ts` owns Codex role mapping, model arguments, contained invocation, event/session translation, and evidence identity.

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
| Configurable roles exist       | AC-015 schema, runner-contract, workflow and CLI QA   | High on the feature branch                    |

## Known gaps and blockers

- The former MVP 2 sequential batch description is superseded by D-008: ordered workbook execution is the MVP 1 product target. `tasks/README.md` is the single sequencing/state authority; only AC-015 is materialized and ready.
- Additional production runners, workbook parsing/eligibility, durable task ownership, state updates/continuation, general required-QA adapters/QA-fix rounds, and final immutable summaries are absent.
- Remote lifecycle adapters are deferred under D-007/D-008; repository task completion updates remain operator-managed until the workbook state task implements a safe boundary. Codex remains the only production runner and authenticated compatibility remains AC-019 scope.
- PR #13 merged as `63e8a49`. AC-012 merged in PR #14 as 6d72cfd after verified head 0a4e877. Integrated Codex, QA and verification share Windows AppContainer/Job containment; protected metadata writes and credential access are denied before execution, sanitized environments omit operator tokens, and tampering durably terminates runs. Fresh receipts cannot be pre-created; interrupted QA/completion require operator reconciliation. The latest boundary corrections below preserve concurrent ACL hardening and prevent trusted-host Git helpers from escaping containment. All review conversations and configured GitGuardian gates passed; the owner merged the PR. Node captured-child pipes, cross-volume batch execution and live authenticated compatibility remain unaccepted; unsupported commands fail closed.
- D-005 permits owner-accepted critical chat review and scoped publication after checks/QA. The owner ended further continuous bot-review requests for PR #14; final verified dispositions and configured merge gates passed before human merge.
- Linux and macOS subprocess execution fail closed; PRODUCT's three-platform acceptance remains open.
- License has not been selected and added.

See [the MVP audit](docs/MVP_AUDIT.md), refreshed against `main` at be5b144 on 2026-09-15, for AC-001–AC-014 reconciliation, current implementation evidence, contradictions resolved, and remaining acceptance/release gaps. Historical runtime evidence was inspected but not rerun or promoted by this documentation audit. MVP 1 is not yet accepted or released.

## Latest pnpm upgrade, 2026-09-14

The owner requested the latest pnpm release after the compatible refresh. package.json and the source guide now declare pnpm 12.4.1, verified against npm's latest release. pnpm 12 adds a separate package-manager integrity document to the lockfile; application dependency resolutions are unchanged. The owner-reported workspace error was reproduced with pnpm 8.15.6 on PATH. pnpm-workspace.yaml now explicitly lists the root package, resolving that configuration error; pnpm 8 then correctly remains unable to read pnpm 12's multi-document lockfile. The source guide explains using the declared version through npx when an older binary wins PATH precedence. Normal and frozen-lockfile installations, formatting, lint, typecheck, clean build and built CLI help pass with pnpm 12.4.1. Targeted Windows pnpm CMD-shim and fake-Codex CLI run/resume QA passes both cases with no skips or failures. Diff review confirms matching current pins and package-manager-only lockfile additions. The full suite below was run with pnpm 11 and was not repeated for this package-manager-only upgrade; authenticated live Codex, other operating systems and distribution installation remain unverified.

## Compatible package refresh baseline, 2026-09-14

Updated pnpm to 11.27.0, Node 24 types to 24.13.4, ESLint to 10.10.0, typescript-eslint to 8.70.0 and YAML to 2.9.1; regenerated the lockfile. TypeScript remains at 6.0.3 within typescript-eslint's supported peer range; Node 24 and the current dependency major versions are retained. Formatting, lint, typecheck, clean build, built CLI help and frozen-lockfile installation pass. The complete Windows suite passes 306 of 310 cases with four platform skips and no failures or cancellations, including fake-Codex CLI run/resume and pnpm CMD-shim workflow QA. Current-chat critical diff review found no manifest/lockfile mismatch, unsupported peer combination, unrelated source change or exposed run artifacts. Authenticated live Codex, other operating systems and distribution installation were not verified; existing release limitations remain. PR #20 review finding 4010320695 correctly identified the stale source-guide pnpm prerequisite; the guide was corrected to match package.json at 11.27.0 before the latest-pnpm upgrade above. A tracked-file search confirms no remaining 11.25.0 pins. Documentation formatting and diff checks pass; runtime verification above was not rerun for this documentation-only correction.

## Historical PR #19 requirements review, 2026-09-14

At that checkpoint, review verified both reported findings against the then-current PRODUCT, WORKFLOW, D-007 and MVP audit. It added explicit operator publication/merge, completion evidence and target-branch reconciliation requirements, with separate local-only and PR-required acceptance scenarios, and placed remaining acceptance before the then-named MVP 2 pipeline. D-008 now incorporates the sequential workbook into MVP 1 while preserving those safety requirements. The historical scoped validation remains evidence for PR #19 only; it is not evidence for this reconciliation or current runtime acceptance.

## AC-014 user documentation, 2026-09-14

[The user guide](docs/user/README.md) covers the current source setup, operator-authored task/worktree preparation, configuration/commands and conservative recovery. It retains platform, authenticated execution, QA adapter and release limits. AC-014 is complete: PR #18 merged as 46ddae6 on 2026-09-14 at 18:37:22 UTC with GitGuardian passing and owner-confirmed merge. The owner requested record closure after the current-chat review. The pnpm setup finding is resolved by merged PR #21, including explicit root workspace and current-version bootstrap guidance; runtime behavior is unchanged. Scoped formatting, lint, typecheck, build/help, 39 local links, schema examples and disposable init/select/prepare checks pass. No authenticated model, clean-install or new runtime-suite evidence is claimed; review dispositions and limitations are recorded in [AC-014](tasks/completed/AC-014.md).

## AC-013 lifecycle boundary, 2026-09-14

D-007 selects durable local execution through verified operator handoff for MVP 1. Remote PR/review/merge/deployment automation is later scope; required repository gates and D-005 contribution authority remain intact. PR-required runs still block at the external boundary; no runtime or CLI state changed. Ownership/summary, QA recovery, supported platforms/live Codex and release/security acceptance remain open. AC-013 is complete: [PR #16](https://github.com/hcuddeback/autocode/pull/16) merged as 38fa030ff8e56359d669698a75afe4d23c1d6e83 at 2026-09-14 18:25:09 UTC, with GitGuardian passing and owner merge authorization exercised. Scoped formatting, lint, typecheck, fresh build, CLI help, local document links and diff checks pass; runtime tests were not rerun for the documentation-only change. Owner-accepted current-chat critical-review dispositions are in [the completed contract](tasks/completed/AC-013.md); no separate independent session is claimed. Post-merge closure checks documentation only; runtime checks were not rerun and MVP release acceptance remains open.

## AC-012 completion, 2026-09-14

PR #14 merged as 6d72cfd2b3994eaaf71cca9ff4508f9a712753e6 at 17:59:09 UTC. Final head 0a4e877 passed GitGuardian; all 49 review conversations were resolved and GitHub reported CLEAN. Verification: 306 source passes and four platform skips, all 62 production-JavaScript checks and eleven privacy controls pass, plus configured format/lint/typecheck/build and CLI smoke. The completed contract is tasks/completed/AC-012.md. This is completion of the bounded local fixture outcome, with broader MVP/live compatibility gaps still recorded above and in docs/MVP_AUDIT.md. AC-015 is now the active queue entry; no AC-012 implementation remains active. Nonblocking maintainability follow-up stays separate.

## Historical AC-012 boundary checkpoints

### Direnv credential coverage, 2026-09-14

Code finding 4003995527 identifies ignored .envrc export assignments omitted by the dotenv filename boundary. Shared discovery and existing INI/export assignment redaction now recognize .envrc and dotted variants alongside .env files; raw-byte freshness and existing sandbox isolation apply. Native credential coverage includes .envrc. Containment version 12 rejects v11 and earlier receipts.

Fresh frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations and no retries; all 13 source files and 33 workflow roots are covered exactly once. Hash-identical production-JavaScript boundary QA passes 56 tests, compiled CLI/pnpm workflow QA passes two, and compiled QA preflight/same-head recovery passes one. Configured formatting, lint, typecheck, clean build and built CLI help pass; frozen source hashes match. Production controls protect Direnv, Yarn Classic, pip, NuGet, signing keys and prior durable evidence. Proof is retained under .autocode/implementation-plans/AC-012-pr14-envrc-final-*. Exact-head remote review and human merge gates remain required; AC-012 stays in review.

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

**Outcome:** Implement the first canonical workbook task, AC-015, so planner, implementer, reviewer, and fixer resolve through provider-neutral runner/model assignments while Codex remains the first adapter.

**Evidence expected:** Configuration/adapter contract tests and disposable contained CLI QA prove safe defaults, explicit role/model mapping, distinct review identity, fail-closed invalid assignments, fresh evidence, and resume without repeated effects.

**Stop condition:** Do not implement workbook scheduling, a second production runner, hosted services, direct provider APIs, or parallel execution in AC-015.

## AC-015 feature-branch evidence, 2026-09-15

Version-1 configuration now validates exactly one planner, implementer, reviewer and fixer assignment when `roles` is present, with the documented compatibility default of Codex and its default model when the section is absent. `runner.ts` defines role authority, adapter capabilities, preflight resolution, stable effect identity, and bounded immutable JSON-safe results. Unknown runners, malformed models, capability mismatch, registry identity mismatch and invalid adapter results fail before durable/model effects. `codex-runner.ts` preserves the existing contained Codex path while applying configured models and translating Codex sessions to provider-neutral results. Workflow receipts retain runner/model/execution/effect identity, bind configuration freshness, enforce globally fresh executions and a reviewer identity distinct from implementation, and resume current completed effects without replay.

The complete final suite passes 317 tests with four declared platform skips and no failures or cancellations. Disposable fake-runner workflow QA passes explicit per-role model selection and fix routing, while an unknown runner produces no model or durable effects. CLI QA passes default migration, explicit model routing through plan, implementation, fix and independent review, then resumes without changing any session artifact; unsupported CLI assignment fails before effects. Formatting, lint, typecheck, clean build and built CLI help pass.

The owner-accepted current-chat critical review found and resolved four issues before final validation: runner-registry aliases could misstate adapter identity; adapter evidence was shallow-frozen and depended on the later receipt bound; unexpected top-level result fields could survive validation; and provider-neutral final messages were duplicated in retained receipts. Exact registry identity is now enforced, adapter evidence is bounded/deep-copied/deep-frozen JSON, results are reconstructed from an exact field set, and only planning retains the final message while other phases retain bounded runner identity/evidence. A stale credential-redaction assertion was updated to the new provider-neutral field and its focused regression plus the complete suite pass. Publication and remote repository gates remain; AC-015 is not marked done here.

Verified implementation commit `21f4783` is published on `feat/AC-015-configurable-role-runners` in [PR #25](https://github.com/hcuddeback/autocode/pull/25). The active task is in review. Configured PR checks, remote review, human merge authorization, and post-merge workbook reconciliation remain pending; `tasks/README.md` is intentionally unchanged.

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

Exactly one task is ready: [AC-015](tasks/AC-015.md), **Configure provider-neutral workflow roles with a Codex adapter**. Its acceptance requires validated role-to-runner/model configuration; a provider-neutral capability/result/evidence contract; preserved contained Codex behavior and safe defaults; fail-closed invalid assignments; distinct independent review; receipt freshness and interruption-safe resume; deterministic checks; and disposable fake-runner CLI QA. AC-016 remains waiting and must not be materialized until AC-015 is complete and the workbook is reconciled against then-current `main`.

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

### Gradle credential coverage, 2026-09-14

Published-head code finding 4004315550 identifies ignored gradle.properties credentials. Shared discovery now recognizes that filename and protects it through sandbox isolation and raw-byte freshness. Literal Java Properties values using equals, colon or whitespace separators are redacted without treating quotes or inline comment markers as syntax. Backslash escaping, continuation and NUL layouts fail generically before launch. Containment version 13 rejects v12 and earlier evidence. A disposable production control reproduces the prior build's readable synthetic Gradle credential.

Fresh complete final frozen-source verification covers all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 files and 33 workflow roots are covered exactly once. The final complete run passes without retries. Hash-identical production-JavaScript boundary QA passes 56 tests, compiled CLI/pnpm workflow QA passes two including exact runtime authorization and grant revocation, and compiled QA preflight/recovery passes one. Formatting, lint, typecheck, clean build and built CLI help pass; frozen source hashes match. Nine disposable production controls protect credential formats, Android signing files, arbitrary ignored opaque files and prior durable evidence. Final proof is retained under .autocode/implementation-plans/AC-012-pr14-grants-final-*. Earlier interrupted/failing runs are retained separately below. Exact-head remote reviews and human merge gates remain required; AC-012 stays in review.

Security finding 4004376973 identifies ignored release.jks and keystore.properties as fresh evidence of unclassified private data. The shared Windows execution preflight now enumerates ignored files in every discovered repository and denies them by default. Only exact regular-file resources explicitly authorized by the trusted operator and selected executables/runtime files can expose otherwise unclassified ignored files; directory grants do not waive this policy. Known credentials, Git private references and durable evidence remain denied even when separately granted. Native regression covers Android and arbitrary opaque files, denied reads/writes/renames/deletion and an exact safe-file grant with neighboring secrets still denied; ACLs restore exactly. Both published-head findings are addressed in this v13 batch. The interrupted Gradle-only run is retained as stale, not passing proof.

Exact verification grants: trusted .autocode/workflow.json may declare up to 16 absolute regular-file verificationReadResources. The integrated driver validates them before model effects and supplies copied resources to contained deterministic verification. Raw operator policy is already part of every receipt binding, so changing a grant rejects old receipts. The ignored package-runtime pnpm fixture now declares its exact check.mjs resource; completion/resume and revoked-grant rejection pass. The initial policy-only source run's failing pnpm case is retained in AC-012-pr14-ignored-final-workflow-shard-1.log; the interrupted run is stale. An initial focused test's expected error wording was corrected, with its original assertion log retained.

### Read-resource freshness and Codex preflight, 2026-09-14

Published-head code findings 4004835194, 4004835206 and 4004835214 identify inherited write access on nested read grants, untracked runtime contents omitted from receipt freshness, and missing Codex resources deferred until after durable effect creation. Read grants inheriting this launch's write permissions now use the existing protected ACL boundary and cleanup protocol before granting read/execute. Operator verification files have bounded stable raw-content digests and canonical identities in both receipt bindings and live workspace fingerprints, and deterministic checks compare their snapshots before accepting evidence. Version 14 rejects v13 and earlier receipts. Fixed copied Codex executable/prefix resources are resolved and inspected through shared contained-process preflight before preparing a durable run, without launching models or changing ACLs.

Focused regressions pass: an exact ignored read grant denies overwrite/rename/deletion and restores ACLs; altered runtime content or same-content identity replacement rejects old completion receipts; changing a grant rejects old receipts; missing/invalid Codex executables produce no model effects and recover on the same task/head. A trusted-owner mutation during a successful check retains exitCode 0 and worktreeUnchanged true while protectedStateUnchanged/passed become false.

Fresh v14 frozen-source verification passes all 310 cases: 306 pass, four platform skips, zero failures/cancellations, all 13 files and 33 workflow roots exactly once. The complete final source run required no retries. Hash-identical production JavaScript QA passes 56 native boundary cases, two CLI/pnpm cases, one Codex/QA preflight recovery case and one owner-mutation freshness case. Configured formatting, lint, typecheck, clean build and built CLI help pass. Ten disposable production controls protect known credentials, ignored Android/opaque files, unclassified non-repository files and prior durable evidence; original readable controls remain separately retained. Final proof is under .autocode/implementation-plans/AC-012-pr14-v14-final-*. The initial generic native run's six fixture failures were due to missing exact script grants; its original log remains retained, and the corrected targeted 9/9 plus final full source/compiled runs pass. Exact-head remote reviews and human merge gates remain required. GitGuardian synthetic fixture incident disposition awaits specifically authorized SSO; AC-012 remains in review.

Security finding 4004926346 also demonstrates unclassified private files beneath non-repository writable roots. Existing files there are denied by default unless an exact read or mutable-file resource is authorized; directory write access does not expose existing neighboring files. Trusted contained adapters may declare up to 16 sandboxWriteFiles inside already authorized writable roots for specific output files. Known credentials and durable evidence remain private. Native regression covers arbitrary opaque files, Android signing files, denied read/write/rename/delete, exact counter-file mutation and exact ACL restoration. Disposable controls retain the prior readable result separately from corrected production proof.

### Verification executable preflight, 2026-09-14

Exact-head code finding 4005442221 identifies missing verification executables discovered only after model phases, exhausting fix rounds and leaving terminal durable failure. The integrated driver now resolves every configured check on the trusted PATH and inspects each launch through shared contained-process preflight before preparing a durable run or starting Codex effects. The regression covers a missing first command and a missing later command, absent model calls and durable events, unchanged implementation output and corrected same-task/head completion. Version 15 rejects v14 and earlier receipts.

Fresh v15 frozen-source verification passes all 310 cases: 306 pass, four platform skips, zero failures/cancellations, all 13 test files and 33 workflow roots exactly once, without retries. Hash-identical production JavaScript QA passes 56 boundary cases, two CLI/pnpm cases, one expanded verification/Codex/QA preflight recovery case and one owner-mutation freshness case. Formatting, lint, typecheck, clean build and built CLI help pass; frozen source hashes match. Ten production privacy controls remain protected. Proof is retained under .autocode/implementation-plans/AC-012-pr14-v15-final-*. The previous published head's security review reports no issues; its sole code finding is addressed here. Exact new-head code/security reviews and human merge gates remain required. GitGuardian's synthetic fixture incident disposition still awaits specifically authorized SSO; AC-012 remains in review.

### Codex limit preflight, 2026-09-14

Exact-head code finding 4005867349 identifies invalid Codex timeout/output limits rejected only after recording a durable effect. Codex preflight now validates both effective limits using the same positive 32-bit integer rules as contained launch, copies their effective defaults into fixed launch options, and shared process preflight validates its output limit. Invalid zero, negative, fractional, nonfinite, oversized and unsafe-integer limits cannot start model or durable effects; corrected options remain resumable on the same task/head. Version 16 rejects v15 and earlier receipts.

Fresh v16 complete frozen-source verification passes all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 test files and 33 workflow roots exactly once. The complete final run required no retries after the actual lock fix. Hash-identical production JavaScript QA passes 61 cases: 56 boundary, two CLI/pnpm, one expanded preflight recovery, one owner-mutation freshness and one 20-way concurrent initialization. Formatting, lint, typecheck, clean build and built CLI help pass; frozen hashes match. Ten production privacy controls remain protected. Final proof is retained under .autocode/implementation-plans/AC-012-pr14-v16-complete-final-*. The initial failed base and its hashes remain separately retained under the original v16-final prefix. Effective Codex limits are 1 through 2147483647. The previous published head's security review reports no issues; its sole code finding is addressed here. Fresh exact new-head code/security reviews and human merge gates remain required. GitGuardian synthetic fixture incident disposition awaits specifically authorized SSO; AC-012 remains in review.

The initial v16 frozen-source base run failed only the existing 20-way concurrent initialization case: Windows EPERM reading init.lock/owner.json. The original 240-case result (235 pass, one failure, four skips) and frozen hashes remain retained under AC-012-pr14-v16-final-_. Windows EPERM during owner inspection now conservatively treats the lock as held under existing bounded acquisition retries, without reclaiming or deleting it. This resolves actual QA evidence within integrated workflow idempotency; final proof uses a distinct AC-012-pr14-v16-complete-final-_ prefix.

### QA input freshness and bounded output, 2026-09-14

Published-head findings 4006356384 and 4006356389 concern stale required-QA evidence after adapter changes and memory consumption from a near-2-GiB output limit. Version 17 binds QA/completion receipts to copied adapter configuration, the selected executable and explicit read resources. Bounded streaming snapshots retain canonical identities and content digests; resumed and completed evidence is rejected after input changes. Missing-adapter recovery remains scoped to the unstarted QA attempt, and completed resume can refresh stored inputs without repeating QA. Snapshots permit at most 17 targets, 10,000 entries, depth 32 and 512 MiB of file data; private workflow state is excluded. Shared contained-process and Codex preflight cap output at 16 MiB; timeout retains its positive native integer bound. Limits are validated before durable/model effects. Version 17 rejects earlier receipts.

Fresh v17 complete frozen-source verification passes all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 test files and 33 workflow roots exactly once. The complete corrected final run required no retries. Hash-identical production JavaScript QA passes 62 cases: 56 boundary, two CLI/pnpm, one expanded preflight recovery, one resource freshness, one concurrent initialization and one expanded required-QA freshness/recovery case. Formatting, lint, typecheck, clean build and built CLI help pass; frozen source hashes match. Ten production privacy controls remain protected. Final proof is retained under AC-012-pr14-v17-complete-final-_. The original failed v17 full run (290 pass, 16 failures including parent subtest failures, four skips) is separately retained under AC-012-pr14-v17-final-_. Its failures were consolidated to final receipt inspection overriding durable failed outcomes and the changed-adapter recovery expectation; completed-only final comparison and explicit changed/original-adapter recovery assertions resolve them, with six focused checks passing. Initial serialized-callback fixture failures are separately retained; the new fixture binding was renamed and temporary diagnostics removed. Exact new-head code/security reviews and human merge gates remain required. GitGuardian synthetic fixture incident disposition still awaits specifically authorized SSO; AC-012 remains in review.

### Verification executable freshness and exact read grants, 2026-09-14

Published-head findings 4007330571 and 4007343736 concern stale deterministic evidence after replacing resolved verification executables and nested private files exposed by directory read grants. Version 18 binds deduplicated resolved verification executables and their stable identity/content snapshots into receipt bindings and live workspace freshness, resolves the trusted PATH again during freshness checks, and blocks executable changes during deterministic verification. The shared snapshot backend permits up to 32 targets with a 512-MiB aggregate file-data budget and bounded streaming; configured QA still has at most 17 inputs. Shared preflight and direct contained launch now require exact existing absolute regular-file read resources and reject directories/links before effects. Version 18 rejects earlier receipts. The prior production build exposes three nested private fixtures through a directory grant; the corrected build rejects that grant before launch. Existing workflow regressions cover changed executable content and same-content identity replacement after verification, no repeated model effects and unchanged-input resume. Native and preflight regressions cover directory rejection, no process/model/durable effects and unchanged ACLs.

Fresh v18 complete frozen-source verification passes all 310 cases: 306 pass, four platform skips, zero failures/cancellations; all 13 test files and 33 workflow roots exactly once, with no retries in the corrected final run. Hash-identical production JavaScript QA passes all 62 cases: 56 boundary, two CLI/pnpm, one preflight/recovery, one resource freshness, one concurrent initialization and one required-QA freshness/recovery. Eleven production privacy controls pass, including rejection of the formerly exposing directory read grant before launch. Focused current regressions pass 3/3 and corrected metadata cases pass 4/4. The original v18 failed base (234 pass, two failures including the parent, four skips) remains under AC-012-pr14-v18-final-_: its explicit-directory success expectation conflicted with the safer exact-file policy, and was corrected to assert rejection with unchanged ACLs and no launch. Current proof is retained under AC-012-pr14-v18-complete-final-_. The D-005 owner-accepted critical chat review dispositions both reported findings; the owner ended additional continuous bot-review requests on 2026-09-14. No known security/correctness finding is deferred. A bounded later maintainability audit is recorded in the queue and is not a merge gate. GitGuardian passes on published c20caa7 after owner false-positive disposition; recheck it on the final published head. Configured GitGuardian, resolved conversations, current-base checks and human merge authorization remain. AC-012 stays in review until human-authorized merge; broader product/platform limitations remain in the existing MVP audit.
