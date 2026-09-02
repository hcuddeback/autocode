---
task_id: AC-001
title: Replace with one observable outcome
status: ready
priority: high
risk: low
depends_on: []
branch: feat/AC-001-replace-slug
owner: unassigned
last_updated: YYYY-MM-DD
qa: auto
deployment: auto
---

# Outcome

Describe one observable user or system result.

## Why now

Link this task to the MVP milestone, evidence, defect, security need, or release gate.

## Required context

- `docs/PRODUCT.md` — relevant sections only.
- `docs/ARCHITECTURE.md` — relevant sections only.
- `docs/WORKFLOW.md` — affected phases/gates only.
- `docs/SECURITY.md` — relevant sections or not applicable.
- `SYSTEM.md` — current state.

Remove unneeded documents. Do not import the whole roadmap into implementation context.

## Scope

### In

- Specific behavior or deliverable.
- Important integration boundaries.

### Out

- Adjacent work excluded.
- Later outcome not to implement early.

## Implementation constraints

- Preserve documented architecture/security invariants.
- Reuse patterns before adding dependencies/abstractions.
- Do not expose secrets, broaden permissions, or modify unrelated work.
- Create a fresh plan against the current commit before coding.

## Done when

- [ ] Observable positive result.
- [ ] Important failure, empty, interruption, or recovery result.
- [ ] Applicable data, authorization, process, or provider boundary.
- [ ] Documentation and `SYSTEM.md` match behavior.

## Deterministic validation

- [ ] Formatting/lint: `PENDING_REAL_COMMAND`
- [ ] Typecheck: `PENDING_REAL_COMMAND`
- [ ] Tests: `PENDING_REAL_COMMAND`
- [ ] Build/package smoke: `PENDING_REAL_COMMAND`

Replace pending commands before marking ready once the repository provides them.

## Independent critical-review focus

- Assumptions, edge cases, safety boundaries, and regression surfaces to challenge.

## QA

**Applicability:** `auto`

- Runtime/user-journey scenarios and required evidence if applicable.
- Persist a reason when not applicable.

## PR, merge, and production gates

- Codex PR review: required | not applicable | auto
- Merge authorization: human | policy | not applicable
- Production verification: required | not applicable | auto
- Task-specific CI, freshness, deployment, smoke, or rollback evidence.

## Files/areas expected

- Likely paths/components; this does not authorize unrelated cleanup.

## Manual owner steps or blockers

- `None`, or account/provider/credential/approval work and what it blocks. Never include secrets.

## Completion record

- Branch/PR:
- Final commit:
- Validation evidence:
- Review disposition:
- QA evidence or not-applicable reason:
- Production evidence or not-applicable reason:
- Remaining limitation:
