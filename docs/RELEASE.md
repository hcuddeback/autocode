# AutoCode release runbook

This runbook tracks release gates as the CLI and workflow are built.

## Release identity

- Milestone: MVP 1
- Target: public source plus locally installed CLI
- Repository: `hcuddeback/autocode`
- Branch: `main`
- Package/binary: pending registry check

## Preconditions

- [ ] MVP acceptance criteria are complete.
- [ ] Security checklist passes.
- [ ] License and public contribution/security channels exist.
- [ ] Supported Node.js, Git, Codex CLI, and OS versions are documented.
- [ ] Clean install and upgrade behavior are tested.

## Repository validation

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Package-install and fixture-workflow commands remain pending later tasks; skipped checks must be explicit.

## Package smoke

- [ ] Install the distribution artifact.
- [ ] `autocode --help` runs without modifying the repository.
- [ ] Initialization previews or safely creates expected files.
- [ ] One fixture task completes with evidence.
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
