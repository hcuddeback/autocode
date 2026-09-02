# AutoCode decisions

Record durable choices with meaningful alternatives; do not duplicate task history.

## Decision index

| ID | Date | Status | Decision | Revisit trigger |
|---|---|---|---|---|
| D-001 | 2026-09-02 | accepted | Local-first TypeScript CLI around Codex CLI | Local execution cannot meet a measured need |
| D-002 | 2026-09-02 | accepted | MVP document, small queue, JIT tasks, and JIT plans | Rework shows a planning horizon is wrong |
| D-003 | 2026-09-02 | accepted | QA as an explicit applicability-gated phase | Evidence shows it belongs outside orchestration |

## D-001 — Local TypeScript CLI

**Context:** Earlier prototypes used deterministic runners, a hosted control plane, and direct model APIs. The refined product needs local Codex sessions and durable recovery.

**Decision:** Start clean with Node.js 24+, strict TypeScript, pnpm, project-local state, and Codex CLI adapters.

| Alternative | Advantage | Why not now |
|---|---|---|
| Refactor hosted prototype | More existing code | Carries Supabase/provider/multi-user assumptions |
| Python | Strong scripting ecosystem | No ML workload; TypeScript matches target projects |

**Consequence:** Port only proven parsing, policy, Git, and state ideas with tests.

## D-002 — MVP plus two-stage JIT planning

**Context:** Detailed backlogs decay, while coding without a product contract causes drift.

**Decision:** PRODUCT owns the MVP; the queue holds coarse outcomes; task contracts are refined when selected; detailed plans are generated immediately before coding against the current commit.

**Consequence:** Future work stays intentionally coarse, while the active task remains reviewable and testable.

## D-003 — Explicit QA phase

**Context:** Static checks do not prove user-visible behavior, but not every internal change warrants browser testing.

**Decision:** Persist a QA applicability decision, run scenario-based QA when required, and invalidate affected evidence after fixes.

**Consequence:** User-facing work receives runtime evidence without forcing QA onto irrelevant changes.
