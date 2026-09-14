# AutoCode decisions

Record durable choices with meaningful alternatives; do not duplicate task history.

## Decision index

| ID    | Date       | Status   | Decision                                                           | Revisit trigger                                                             |
| ----- | ---------- | -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| D-001 | 2026-09-02 | accepted | Local-first TypeScript CLI around Codex CLI                        | Local execution cannot meet a measured need                                 |
| D-002 | 2026-09-02 | accepted | MVP document, small queue, JIT tasks, and JIT plans                | Rework shows a planning horizon is wrong                                    |
| D-003 | 2026-09-02 | accepted | QA as an explicit applicability-gated phase                        | Evidence shows it belongs outside orchestration                             |
| D-004 | 2026-09-11 | accepted | Fresh scoped sessions with durable phase receipts                  | Stable continuation/reconciliation evidence justifies a different interface |
| D-005 | 2026-09-12 | accepted | Autonomous commit, push, and PR creation after local checks and QA | Owner changes publication authority or required merge gates                 |

## D-001 — Local TypeScript CLI

**Context:** Earlier prototypes used deterministic runners, a hosted control plane, and direct model APIs. The refined product needs local Codex sessions and durable recovery.

**Decision:** Start clean with Node.js 24+, strict TypeScript, pnpm, project-local state, and Codex CLI adapters.

| Alternative               | Advantage                  | Why not now                                        |
| ------------------------- | -------------------------- | -------------------------------------------------- |
| Refactor hosted prototype | More existing code         | Carries Supabase/provider/multi-user assumptions   |
| Python                    | Strong scripting ecosystem | No ML workload; TypeScript matches target projects |

**Consequence:** Port only proven parsing, policy, Git, and state ideas with tests.

## D-002 — MVP plus two-stage JIT planning

**Context:** Detailed backlogs decay, while coding without a product contract causes drift.

**Decision:** PRODUCT owns the MVP; the queue holds coarse outcomes; task contracts are refined when selected; detailed plans are generated immediately before coding against the current commit.

**Consequence:** Future work stays intentionally coarse, while the active task remains reviewable and testable.

## D-003 — Explicit QA phase

**Context:** Static checks do not prove user-visible behavior, but not every internal change warrants browser testing.

**Decision:** Persist a QA applicability decision, run scenario-based QA when required, and invalidate affected evidence after fixes.

**Consequence:** User-facing work receives runtime evidence without forcing QA onto irrelevant changes.

## D-004 — Fresh sessions and conservative model-effect reconciliation

**Context:** The local workflow needs safe restart before native Codex session continuation has been proven. PRODUCT explicitly permits fresh scoped sessions with persisted artifacts.

**Decision:** Run planning, implementation, fixes, and review as fresh role-scoped Codex CLI sessions. Persist successful phase receipts after protected-state/Git checks. Resume reconciles successful current receipts without invoking Codex again; interrupted model effects without safe receipts block for operator reconciliation. Bind receipts to task, operator policy/configuration, prepared plan, base Git identity, and workspace digest.

**Alternatives:** Automatically retrying uncertain model work can repeat changes or external effects. Requiring native session continuation would prevent the local slice without improving deterministic evidence today.

**Consequence:** Workflow resume is implemented without claiming native session continuation. Configuration/workspace drift requires fresh evidence. This decision does not narrow PRODUCT's still-open PR/production or supported-platform requirements.

## D-005 — Publication authority and review evidence

**Context:** Requiring a separate external or manual review before publication blocked locally verified AC-012 fixes. The owner explicitly authorized committing, pushing, and opening a PR, and accepted the current chat as the independent review for AC-012.

**Decision:** After deterministic verification and applicable QA pass, agents have standing authority to commit scoped selected-task changes, push their feature branch, and open a PR without another manual review or permission request. Independent critical review remains required for task completion; an owner-accepted review chat can provide that evidence by recording findings and their verified dispositions. No separate external Codex session is mandatory before publication.

**Consequence:** AC-012's two chat-review findings are dispositioned by the protected-state and QA preflight corrections and their regression evidence. Publication may proceed. Configured CI, exact-head Codex PR review when required, and human merge authorization remain merge gates. This decision changes repository contribution policy; it does not add remote adapters to the local workflow CLI or authorize autonomous merging or deployment.

## D-006 — Windows broker isolation

**Context:** Job Objects control descendants but Task Scheduler can launch a helper through a user service outside the job.

**Decision:** Use a unique AppContainer with the fixed internetClient capability for Windows model, QA and verification commands, retaining suspended-start Job Object lifetime containment. Grant worktree access and explicit trusted host resources while keeping `.autocode`, `.git` and common Git metadata read-only. Use allow-only grants; do not rely on package-SID deny rules. Keep helper code and its cleanup manifest outside writable resources and never fall back to an uncontained process. Remove launch-specific permissions and data after termination. Discovered ignored credential files receive no package/capability access. Pass a minimal explicit environment with private profile directories and omit operator credentials. Bind receipts to this containment version so legacy Job-only and credential-exposing runs require reconciliation.

**Consequence:** A real scheduler regression denies registration and launch of an existing operator-owned task, with a viable trusted-parent control. Ordinary contained fixture work remains available. Current Node/libuv captured-pipe support, cross-volume batch execution, live authenticated Codex compatibility and PRODUCT platform acceptance remain gaps; this decision does not claim full MVP acceptance.

**Credential ACL refinement (2026-09-13):** Do not remove and later reconstruct preexisting package/capability permissions. Such restoration cannot safely distinguish temporary removals from concurrent operator hardening. Refuse to launch when a credential already has package/capability allow entries, leaving them unchanged for explicit operator disposition. Preserve denies and concurrent access-rule edits; restore temporary inheritance only for an unchanged recorded boundary. Share standard credential-path classification between launches and freshness checks, and invalidate older containment receipts.

Protected metadata also rejects preexisting package/capability write access throughout its tree, including descendant ACL grants; safe read access is retained. This is the same fail-closed permission policy, rather than destructive grant removal/restoration.

**Writable-root refinement (2026-09-13):** Apply credential and metadata isolation to every authorized writable root before granting access. Discover nested repositories and linked common Git metadata, deduplicate case aliases and covering roots, protect direct cloud credential directories, and reject roots inside protected metadata. Bound the complete walk and fail closed on links or overflow. Containment version 4 invalidates earlier receipts. Public Git data labels remain readable; private metadata stores retain credential protection.

**Git metadata refinement (2026-09-13):** An out-of-root common Git directory requires explicit read authorization or registration back to the actual linked worktree; discovery does not itself authorize unrelated repositories. Parse Git configs without following includes and isolate credential-bearing configs, including worktree config. Preserve reads of public configs. Fail closed without raw config-error output or an authentication fallback. Containment version 5 invalidates earlier receipts.

Only registered worktrees under `.autocode/worktrees`, with an external common directory, qualify as writable infrastructure enclaves. A plain Git marker cannot authorize mutation of cache/run metadata. Standard hidden `.credentials`/`.secrets` roots remain credential boundaries regardless of opaque filenames. Config matching follows actual Git metadata locations, preserving public ref/worktree data labels.

**Submodule metadata refinement (2026-09-13):** Treat the complete common Git modules namespace as private, including nested submodules and arbitrary config fragments. Apply credential ACL preflight/isolation to every descendant, propagating privacy through nested metadata boundaries. Preserve ordinary parent Git reads; commands requiring submodule metadata may fail closed. Containment version 6 invalidates v5 and earlier receipts.

Included configs inside authorized sandbox resources remain private regardless of filename or metadata location. Parse them through a bounded deduplicated in-scope walk; includes never expand host authorization.

**Private Git file reference refinement (2026-09-14):** Discover known literal TLS key/certificate, cookie, credential-file, askpass, SSH -i and credential-store file references from guarded configs. Canonical in-scope regular files are private; references never grant external access or execute helpers. Discovery and target expansion are capped at 1,000 entries and unsafe inspections fail closed. Carry the Git metadata role explicitly, including when the common directory is named .autocode. Containment version 7 invalidates v6 and earlier receipts.

**SSH identity refinement (2026-09-14):** Inspect literal SSH arguments from core.sshCommand, supporting separate/joined -i and -o IdentityFile options, including quoting and case-insensitive IdentityFile keys. Never execute or expand the command. Apply existing bounded authorized-target isolation; containment version 8 invalidates v7 and earlier receipts.

**Executable resource refinement (2026-09-14):** Selecting a native executable or batch shim grants only that file, never its parent directory or arbitrary adjacent DLLs. Extra runtime resources require explicit trusted-host authorization; unsupported layouts fail closed. SSH -F config indirection is refused before launch because its private references cannot be safely discovered by the Git-config parser. Containment version 8 applies to both refinements.
