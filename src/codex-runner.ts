import type { RoleAssignmentConfig, WorkflowRole } from './config.js';
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
  readonly capabilities = Object.freeze({
    roles: Object.freeze({
      planner: 'read-only' as const,
      implementer: 'worktree-write' as const,
      reviewer: 'read-only' as const,
      fixer: 'worktree-write' as const,
    }),
    acceptsModel: true,
  });

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
    return {
      assignment,
      invoke: async (invocation: RunnerInvocation) => {
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
          if (error instanceof CodexStateTamperingError)
            throw new RunnerStateTamperingError(error.message);
          throw error;
        }
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

export function createRunnerRegistry(
  codexOptions: CodexRunnerOptions = {},
): RunnerRegistry {
  const adapter = new CodexRunnerAdapter(codexOptions);
  return new Map([[adapter.id, adapter]]);
}
