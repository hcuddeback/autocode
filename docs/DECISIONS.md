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
