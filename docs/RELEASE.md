# AutoCode release runbook

This runbook tracks release gates as the CLI and workflow are built.

## Release identity

- Milestone: MVP 1 ordered JIT task workbook
- Target: public source plus locally installed CLI
- Repository: `hcuddeback/autocode`
- Branch: `main`
- Package/binary: pending registry check

## MVP 1 workflow acceptance

D-008 defines MVP 1 as an ordered sequential workbook using configurable role/runner/model assignments. D-007's verified local handoff remains the boundary for PR-required tasks. Automated publication/PR review/merge/deployment/production adapters are later work. This does not waive repository contribution gates or any local QA, platform, security or distribution requirement.

- [ ] The canonical workbook rejects malformed ordering/dependencies/state and selects exactly the next eligible task.
- [ ] Planner, implementer, reviewer, and fixer resolve through validated runner/model assignments; Codex is proven as the first adapter.
- [ ] Durable task ownership prevents competing execution and reconciles after interruption.
- [ ] Validation, independent review, fixes, revalidation/re-review, and applicable QA use one bounded recovery policy.
- [ ] Immutable task summaries support evidence-backed state updates, continuation, blocker handling, and resume without repeated completed effects.
- [ ] A disposable five-task workbook completes/blocks/resumes as required, and a PR-required chain does not advance before repository completion and merged-base reconciliation.

- [ ] A PR-required fixture passes current local checks, independent review and applicable QA, then stops safely at the external boundary with retained identity/digest evidence and explicit operator responsibilities. It must not claim task `done`, merged or deployed.
- [ ] A genuine local-only fixture completes under explicit task and operator PR/production exceptions.
- [ ] Missing QA, stale evidence and ambiguous interruption block; safe restart preserves evidence and retry budgets.
- [ ] Every declared supported OS/runner/model/command combination has contained live compatibility evidence.

Operator-managed remote gates remain necessary before marking real repository tasks done. Remote adapter absence is deferred scope; the local acceptance items above are still release blockers.

## Preconditions

- [ ] MVP acceptance criteria are complete.
- [ ] Security checklist passes.
- [ ] License and public contribution/security channels exist.
- [ ] Supported Node.js, Git, Codex CLI, and OS versions are documented.
- [ ] Clean install and upgrade behavior are tested.

## Repository validation

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. AC-012 adds subprocess-backed local workflow fixtures and a forced-interruption model-receipt resume test. These use fake Codex processes and are not a clean-install distribution test or authenticated live-Codex smoke. Package-install commands remain pending; skipped checks must be explicit. See `MVP_AUDIT.md` for requirement evidence and release blockers.

## Package smoke

- [ ] Install the distribution artifact.
- [ ] `autocode --help` runs without modifying the repository.
- [ ] Initialization previews or safely creates expected files.
- [ ] Local-only completion and PR-required handoff fixtures satisfy the lifecycle acceptance above.
- [ ] Forced interruption resumes without repeated effects.
- [ ] Uninstall behavior is documented and preserves user repositories.

## Rollback

- Source: revert/patch without rewriting public history.
- Package: deprecate the affected version and publish a fix.
- State: preserve migration/backward compatibility; never silently discard runs.
- Authority: repository owner until maintainership policy exists.

## Manual owner checklist

- [ ] Select/add license.
- [ ] Confirm package/binary availability.
- [ ] Configure private vulnerability reporting.
- [ ] Publish only after artifact verification.

Record the release tag, artifact digest, automated checks, installation/fixture/resume evidence, known limitations, and verifier/date.
