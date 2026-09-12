# AutoCode architecture

**Status:** Selected for MVP 1

**Last updated:** 2026-09-11

## Goals and constraints

- Orchestrate one task locally through explicit durable phases.
- Use Codex CLI, not direct model-provider APIs.
- Prefer inspectable files/narrow adapters over a hosted database.
- Protect existing repositories and unrelated work.

## System context

```text
Operator → AutoCode CLI → workflow engine → policy/gates
                           ├─ Codex CLI sessions
                           ├─ Git/worktrees
                           ├─ deterministic project commands
                           ├─ optional GitHub/deployment/browser adapters
                           └─ versioned local state and evidence
```

## Selected stack

| Concern     | Choice                          | Why                           | Revisit trigger                  |
| ----------- | ------------------------------- | ----------------------------- | -------------------------------- |
| Runtime     | Node.js 24+ / strict TypeScript | Cross-platform orchestration  | Demonstrated limitation          |
| Packages    | pnpm                            | Reproducible and aligned      | Distribution requires otherwise  |
| State       | `.autocode/` versioned files    | Local and inspectable         | Measured concurrency/query needs |
| Agent       | Codex CLI adapter               | Reuses authenticated sessions | Expansion is justified           |
| Concurrency | One task                        | Safer recovery                | Proven independent scheduling    |

## Proposed boundaries

AC-012 adds `workflow.ts` as the local composition boundary. `cli.ts` exposes run/resume; prepared Codex roles and unique verification rounds feed immutable phase receipts into `runDurableRun`. QA is callback-based and missing external integrations fail closed. Existing policy modules remain independently usable. See `WORKFLOW.md` for the implemented boundary and `MVP_AUDIT.md` for acceptance gaps.

`src/` will add CLI, workflow, tasks, Codex, verification, review, QA, Git, GitHub, deployment, state, configuration, and observability modules only as the vertical slice needs them. Prompts remain versioned under `prompts/`.

## Data and state

```text
.autocode/
  config.yaml
  runs/<run-id>/
    run.json
    events.jsonl
    artifacts/
    evidence/
```

- Version schemas and write snapshots atomically.
- Append transitions before replacing the current snapshot.
- Bind evidence to its Git commit/configuration.
- Lock runs and reconcile stale locks/effects.
- Store secret references only; corrupt state stops safely.

## Failure and recovery

- Interruption → validate, lock, reconcile, then continue.
- Ambiguous effect → query by recorded identity before retry.
- Failed check/review → bounded fix loop, then block/fail.
- Changed head → invalidate affected evidence.
- Missing optional integration → apply explicit applicability policy.

## Testing strategy

Runtime subprocess containment currently supports Windows and Linux with an available user systemd manager. Other platforms, including macOS, fail closed for default model/verification execution. Cross-platform PRODUCT acceptance is not yet met; do not advertise broader support based on TypeScript portability.

- Unit: schemas, readiness, transitions, retry/pacing policy.
- Integration: subprocesses, worktrees, evidence, recovery, adapters.
- End-to-end: fixture success, failure, cancellation, and resume.
- Security: traversal, command policy, malicious inputs, redaction, Git safety.
- Package smoke: install, launch, initialize, and fixture run.

## Complexity gate

Do not add a web UI, database, hosted queue, multi-user model, or parallel tasks until a measured local limitation requires it.
