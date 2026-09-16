# AutoCode user guide

The current AutoCode CLI supervises one local software task through planning, implementation, checks, critical review and retained evidence. Planner, implementer, reviewer, and fixer resolve through validated runner/model assignments; Codex CLI is the first and currently only production adapter.

This guide describes the development checkout, not an accepted public release. Windows AppContainer fixtures are verified, but authenticated live Codex execution, some Windows commands, and clean installation remain unaccepted. Linux and macOS execution currently stops before launching contained work. See [current evidence and gaps](../MVP_AUDIT.md).

- [Getting started](getting-started.md): build from source, initialize a project and prepare a task.
- [Configuration and commands](reference.md): supported settings, QA policy and command behavior.
- [Troubleshooting and recovery](troubleshooting.md): interpret outcomes and preserve resumability.

The MVP stops at verified local operator handoff. AutoCode does not commit, push, open PRs, merge, deploy or mark repository tasks done. You handle those steps through your repository's policies. A `blocked` result at the PR boundary is a handoff only when current local checks, review and applicable QA have passed; other blockers need investigation.
