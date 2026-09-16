import type { RoleAssignmentConfig, WorkflowRole } from './config.js';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  CodexStateTamperingError,
  preflightCodexSession,
  runPreparedCodexRole,
  type CodexSessionOptions,
  type CodexSessionRecord,
} from './codex.js';
import {
  RunnerStateTamperingError,
  type PreparedRoleRunner,
  type RunnerAdapter,
  type RunnerInvocation,
  type RunnerRegistry,
} from './runner.js';
import {
  refreshQaInputs,
  snapshotQaInputs,
  type QaInputSnapshot,
} from './qa-inputs.js';

const CODEX_ROLE: Readonly<Record<WorkflowRole, CodexSessionRecord['role']>> =
  Object.freeze({
    planner: 'planning',
    implementer: 'implementation',
    reviewer: 'review',
    fixer: 'fix',
  });

export type CodexRunnerOptions = Omit<
  CodexSessionOptions,
  | 'role'
  | 'artifactName'
  | 'fixContext'
  | 'planContent'
  | 'model'
  | 'validateFinalMessage'
>;

export class CodexRunnerAdapter implements RunnerAdapter {
  readonly id = 'codex';
  readonly revision = 'codex-cli-adapter-v1';
  readonly capabilities = Object.freeze({
    roles: Object.freeze({
      planner: 'read-only' as const,
      implementer: 'worktree-write' as const,
      reviewer: 'read-only' as const,
      fixer: 'worktree-write' as const,
    }),
    acceptsModel: true,
  });
  private resourceSnapshot:
    { key: string; value: Promise<QaInputSnapshot> } | undefined;

  constructor(private readonly options: CodexRunnerOptions = {}) {}

  async prepare(
    root: string,
    role: WorkflowRole,
    assignment: Readonly<RoleAssignmentConfig>,
  ): Promise<PreparedRoleRunner> {
    if (assignment.runner !== this.id)
      throw new Error('Codex adapter received a different runner assignment');
    const options = await preflightCodexSession(root, {
      ...this.options,
      ...(assignment.model === undefined ? {} : { model: assignment.model }),
    });
    const configuration = createHash('sha256')
      .update(
        JSON.stringify({
          revision: this.revision,
          role,
          assignment,
          command: options.command,
          commandPrefixArguments: options.commandPrefixArguments,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          sandboxWriteDirectories: options.sandboxWriteDirectories,
          sandboxWriteFiles: options.sandboxWriteFiles,
        }),
      )
      .digest('hex');
    const targets = [
      options.command!,
      ...(await discoverRunnerResources(options.commandPrefixArguments ?? [])),
    ].filter((target, index, values) => values.indexOf(target) === index);
    const resourceKey = JSON.stringify({ root, targets });
    if (this.resourceSnapshot === undefined) {
      const resourceConfiguration = createHash('sha256')
        .update(resourceKey)
        .digest('hex');
      this.resourceSnapshot = {
        key: resourceKey,
        value: snapshotQaInputs(root, resourceConfiguration, targets),
      };
    } else if (this.resourceSnapshot.key !== resourceKey) {
      throw new Error('Codex preflight resources changed between roles');
    }
    const resources = await this.resourceSnapshot.value;
    await assertRunnerResourcesUnchanged(root, resources);
    const identity = createHash('sha256')
      .update(JSON.stringify({ configuration, resources }))
      .digest('hex');
    return {
      assignment,
      identity,
      invoke: async (invocation: RunnerInvocation) => {
        await assertRunnerResourcesUnchanged(root, resources);
        let finalMessage: string | undefined;
        let record: CodexSessionRecord;
        try {
          record = await runPreparedCodexRole(
            root,
            CODEX_ROLE[role],
            invocation.artifactName,
            {
              ...options,
              ...(invocation.plan === undefined
                ? {}
                : { planContent: invocation.plan }),
              ...(invocation.fixContext === undefined
                ? {}
                : { fixContext: invocation.fixContext }),
              validateFinalMessage(message) {
                finalMessage = message;
              },
            },
          );
        } catch (error) {
          await assertRunnerResourcesUnchanged(root, resources);
          if (error instanceof CodexStateTamperingError)
            throw new RunnerStateTamperingError(error.message);
          throw error;
        }
        await assertRunnerResourcesUnchanged(root, resources);
        if (finalMessage === undefined)
          throw new Error('Codex adapter did not capture a final message');
        return {
          version: 1,
          role,
          runner: this.id,
          ...(assignment.model === undefined
            ? {}
            : { model: assignment.model }),
          executionId: record.sessionId,
          effectId: invocation.effectId,
          outcome: 'completed',
          finalMessage,
          evidence: Object.freeze({ session: record }),
        };
      },
    };
  }
}

const STATIC_MODULE =
  /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
const SCRIPT_RESOURCE = /\.(?:c|m)?(?:j|t)sx?$/i;

async function discoverRunnerResources(
  prefixArguments: readonly string[],
): Promise<string[]> {
  const resources: string[] = [];
  const visited = new Set<string>();
  async function visit(target: string): Promise<void> {
    try {
      const canonical = await realpath(target);
      if (visited.has(canonical.toLowerCase())) return;
      const info = await lstat(canonical);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
      visited.add(canonical.toLowerCase());
      resources.push(canonical);
      if (resources.length > 31)
        throw new Error('runner dependency limit exceeded');
      if (!SCRIPT_RESOURCE.test(canonical)) return;
      const contents = await readFile(canonical, 'utf8');
      for (const match of contents.matchAll(STATIC_MODULE)) {
        const specifier = match[1]!;
        if (!specifier.startsWith('./') && !specifier.startsWith('../'))
          continue;
        await visit(path.resolve(path.dirname(canonical), specifier));
      }
    } catch {
      throw new Error(
        'Codex runner dependencies could not be inspected safely',
      );
    }
  }
  for (const argument of prefixArguments) await visit(argument);
  return resources;
}

export async function assertRunnerResourcesUnchanged(
  root: string,
  expected: QaInputSnapshot,
): Promise<void> {
  try {
    const current = await refreshQaInputs(root, expected);
    if (
      current.configuration !== expected.configuration ||
      current.fingerprint !== expected.fingerprint ||
      JSON.stringify(current.targets) !== JSON.stringify(expected.targets)
    )
      throw new Error('runner resources changed');
  } catch {
    throw new RunnerStateTamperingError('Codex runner resources changed');
  }
}

export function createRunnerRegistry(
  codexOptions: CodexRunnerOptions = {},
): RunnerRegistry {
  const adapter = new CodexRunnerAdapter(codexOptions);
  return new Map([[adapter.id, adapter]]);
}
