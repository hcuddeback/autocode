import type { RoleAssignmentConfig, WorkflowRole } from './config.js';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
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
    const configuredOptions = {
      ...this.options,
      ...(assignment.model === undefined ? {} : { model: assignment.model }),
    };
    const options = await preflightCodexSession(root, configuredOptions);
    const configuration = createHash('sha256')
      .update(
        JSON.stringify({
          revision: this.revision,
          role,
          assignment,
          command: options.command,
          commandPrefixArguments: options.commandPrefixArguments,
          runnerResourceFiles: options.runnerResourceFiles,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          sandboxWriteDirectories: options.sandboxWriteDirectories,
          sandboxWriteFiles: options.sandboxWriteFiles,
        }),
      )
      .digest('hex');
    const { resourceKey, targets } = await inspectRunnerResources(
      root,
      options,
    );
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
    const assertCurrentResources = async (): Promise<void> => {
      try {
        const currentOptions = await preflightCodexSession(
          root,
          configuredOptions,
        );
        const current = await inspectRunnerResources(root, currentOptions);
        if (current.resourceKey !== resourceKey)
          throw new Error('Codex runner resource set changed');
        await assertRunnerResourcesUnchanged(root, resources);
      } catch (error) {
        if (error instanceof RunnerStateTamperingError) throw error;
        throw new RunnerStateTamperingError('Codex runner resources changed');
      }
    };
    const identity = createHash('sha256')
      .update(JSON.stringify({ configuration, resources }))
      .digest('hex');
    return {
      assignment,
      identity,
      invoke: async (invocation: RunnerInvocation) => {
        await assertCurrentResources();
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
          await assertCurrentResources();
          if (error instanceof CodexStateTamperingError)
            throw new RunnerStateTamperingError(error.message);
          throw error;
        }
        await assertCurrentResources();
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

const MODULE_TRIVIA = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))`;
const STATIC_MODULE = new RegExp(
  String.raw`(?:\b(?:import|export)(?![\w$])${MODULE_TRIVIA}*(?:[^'";]*?${MODULE_TRIVIA}*from${MODULE_TRIVIA}*)?|\brequire\s*\()\s*['"]([^'"]+)['"]`,
  'g',
);
const DYNAMIC_MODULE =
  /\b(?:import|require)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\(/g;
const SCRIPT_RESOURCE = /\.(?:c|m)?(?:j|t)sx?$/i;

async function inspectRunnerResources(
  root: string,
  options: CodexSessionOptions,
): Promise<{ resourceKey: string; targets: string[] }> {
  const manifest = await Promise.all(
    (options.runnerResourceFiles ?? []).map((resource) => realpath(resource)),
  );
  const discovered = await discoverRunnerResources([
    ...(options.commandPrefixArguments ?? []),
    ...manifest.filter((resource) => SCRIPT_RESOURCE.test(resource)),
  ]);
  if (discovered.some((resource) => !manifest.includes(resource)))
    throw new Error('Codex runner dependency is absent from its manifest');
  const targets = [options.command!, ...manifest].filter(
    (target, index, values) => values.indexOf(target) === index,
  );
  return { resourceKey: JSON.stringify({ root, targets }), targets };
}

async function discoverRunnerResources(
  prefixArguments: readonly string[],
): Promise<string[]> {
  const resources: string[] = [];
  const visited = new Set<string>();
  async function visit(target: string, entry = false): Promise<void> {
    try {
      const canonical = await realpath(target);
      if (visited.has(canonical)) return;
      const info = await lstat(canonical);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
      visited.add(canonical);
      resources.push(canonical);
      if (resources.length > 31)
        throw new Error('runner dependency limit exceeded');
      if (entry && !SCRIPT_RESOURCE.test(canonical))
        throw new Error('unsupported runner entry script');
      if (!SCRIPT_RESOURCE.test(canonical)) return;
      const contents = await readFile(canonical, 'utf8');
      if (/\\u(?:\{[0-9a-f]+\}|[0-9a-f]{4})/i.test(contents))
        throw new Error('escaped runner dependency syntax is unsupported');
      if (/\bcreateRequire\b/.test(contents))
        throw new Error('alternate runner dependency loaders are unsupported');
      for (const match of contents.matchAll(/\brequire\b/g)) {
        const call = contents.slice(match.index + match[0].length);
        if (!/^\s*\(\s*['"]/.test(call))
          throw new Error('unsupported runner dependency syntax');
      }
      for (const match of contents.matchAll(DYNAMIC_MODULE)) {
        const argument = contents.slice(match.index + match[0].length);
        const literal = argument.match(/^\s*(['"])([^'"]+)\1/);
        if (literal === null) throw new Error('nonliteral runner dependency');
        const specifier = literal[2]!;
        if (path.isAbsolute(specifier)) await visit(specifier);
        else if (specifier.startsWith('./') || specifier.startsWith('../'))
          await visit(path.resolve(path.dirname(canonical), specifier));
        else if (!isBuiltin(specifier))
          throw new Error('package runner dependencies are unsupported');
      }
      for (const match of contents.matchAll(STATIC_MODULE)) {
        const specifier = match[1]!;
        if (path.isAbsolute(specifier)) await visit(specifier);
        else if (specifier.startsWith('./') || specifier.startsWith('../'))
          await visit(path.resolve(path.dirname(canonical), specifier));
        else if (!isBuiltin(specifier))
          throw new Error('package runner dependencies are unsupported');
      }
    } catch {
      throw new Error(
        'Codex runner dependencies could not be inspected safely',
      );
    }
  }
  for (const argument of prefixArguments) await visit(argument, true);
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
