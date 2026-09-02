# Contributing to AutoCode

AutoCode is in its foundation phase. Changes should keep the first release small, local-first, observable, and recoverable.

## Before contributing

1. Open or reference a narrowly scoped task.
2. Identify the affected workflow contract and safety boundary.
3. Include acceptance criteria and deterministic verification.
4. Avoid adding a hosted service or UI dependency to MVP 1 without an accepted architecture decision.

## Engineering expectations

- TypeScript strict and Node.js 24+.
- Small modules with explicit inputs and outputs.
- Schema validation at persistence and external-service boundaries.
- Tests for state transitions, retries, recovery, path safety, and policy decisions.
- No live credentials or committed local run state.
- Documentation updated when behavior or configuration changes.
- External integrations implemented behind narrow adapters.

## Pull requests

Pull requests should explain:

- The user-visible or workflow outcome.
- Risks and assumptions.
- Verification performed and its result.
- State-schema or compatibility impact.
- Any follow-up deliberately left out of scope.

Setup commands and the complete quality command set will be added with the executable CLI foundation.
