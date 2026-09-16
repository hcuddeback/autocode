import type {
  RoleAssignmentConfig,
  RoleAssignmentsConfig,
  WorkflowRole,
} from './config.js';
import { createHash } from 'node:crypto';

export type RoleAuthority = 'read-only' | 'worktree-write';

export const ROLE_AUTHORITY: Readonly<Record<WorkflowRole, RoleAuthority>> =
  Object.freeze({
    planner: 'read-only',
    implementer: 'worktree-write',
    reviewer: 'read-only',
    fixer: 'worktree-write',
  });

export interface RunnerCapabilities {
  readonly roles: Readonly<Partial<Record<WorkflowRole, RoleAuthority>>>;
  readonly acceptsModel: boolean;
}

export interface RunnerInvocation {
  readonly role: WorkflowRole;
  readonly effectId: string;
  readonly artifactName: string;
  readonly plan?: string;
  readonly fixContext?: string;
  readonly validateFinalMessage?: (message: string) => void;
}

export interface RunnerResult {
  readonly version: 1;
  readonly role: WorkflowRole;
  readonly runner: string;
  readonly model?: string;
  readonly executionId: string;
  readonly effectId: string;
  readonly outcome: 'completed';
  readonly finalMessage: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface PreparedRoleRunner {
  readonly assignment: Readonly<RoleAssignmentConfig>;
  /** SHA-256 of adapter/runtime inputs established during effect-free preflight. */
  readonly identity: string;
  invoke(invocation: RunnerInvocation): Promise<RunnerResult>;
}

export interface RunnerAdapter {
  readonly id: string;
  /** Bump whenever adapter behavior or result translation changes. */
  readonly revision: string;
  readonly capabilities: RunnerCapabilities;
  prepare(
    root: string,
    role: WorkflowRole,
    assignment: Readonly<RoleAssignmentConfig>,
  ): Promise<PreparedRoleRunner>;
}

export type RunnerRegistry = ReadonlyMap<string, RunnerAdapter>;
export type ResolvedRoleRunners = Readonly<
  Record<WorkflowRole, PreparedRoleRunner>
>;

const ROLES: readonly WorkflowRole[] = [
  'planner',
  'implementer',
  'reviewer',
  'fixer',
];
const MAX_FINAL_MESSAGE_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
// Preserve receipt headroom for worst-case secret/key redaction expansion.
const MAX_RUNNER_RESULT_BYTES = 256 * 1024;
const MAX_EVIDENCE_DEPTH = 16;
const MAX_EVIDENCE_ENTRIES = 4096;

export class RunnerStateTamperingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerStateTamperingError';
  }
}

/** Resolve and preflight every configured role before any durable/model effect. */
export async function resolveRoleRunners(
  root: string,
  assignments: RoleAssignmentsConfig,
  registry: RunnerRegistry,
): Promise<ResolvedRoleRunners> {
  const resolved = {} as Record<WorkflowRole, PreparedRoleRunner>;
  for (const role of ROLES) {
    const assignment = assignments[role];
    const adapter = registry.get(assignment.runner);
    if (adapter === undefined)
      throw new Error(
        `roles.${role} references unknown runner: ${assignment.runner}`,
      );
    if (adapter.id !== assignment.runner)
      throw new Error(
        `runner registry identity mismatch for ${assignment.runner}`,
      );
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapter.revision))
      throw new Error(`runner ${adapter.id} has an invalid revision`);
    const authority = adapter.capabilities.roles[role];
    if (authority !== ROLE_AUTHORITY[role])
      throw new Error(
        `runner ${adapter.id} lacks ${ROLE_AUTHORITY[role]} capability for ${role}`,
      );
    if (assignment.model !== undefined && !adapter.capabilities.acceptsModel)
      throw new Error(`runner ${adapter.id} does not accept model selection`);
    const prepared = await adapter.prepare(root, role, assignment);
    if (
      prepared.assignment.runner !== assignment.runner ||
      prepared.assignment.model !== assignment.model
    )
      throw new Error(`runner ${adapter.id} changed the configured assignment`);
    if (!/^[a-f0-9]{64}$/.test(prepared.identity))
      throw new Error(
        `runner ${adapter.id} returned an invalid preflight identity`,
      );
    const identity = createHash('sha256')
      .update(
        JSON.stringify({
          runner: adapter.id,
          revision: adapter.revision,
          capabilities: adapter.capabilities,
          assignment,
          preflight: prepared.identity,
        }),
      )
      .digest('hex');
    resolved[role] = Object.freeze({
      assignment,
      identity,
      async invoke(invocation: RunnerInvocation) {
        if (invocation.role !== role)
          throw new Error(
            `resolved ${role} runner cannot invoke ${invocation.role}`,
          );
        return validateRunnerResult(
          await prepared.invoke(invocation),
          invocation,
          assignment,
        );
      },
    });
  }
  return Object.freeze(resolved);
}

export function validateRunnerResult(
  value: RunnerResult,
  invocation: RunnerInvocation,
  assignment: Readonly<RoleAssignmentConfig>,
): RunnerResult {
  const allowedKeys = new Set([
    'version',
    'role',
    'runner',
    'model',
    'executionId',
    'effectId',
    'outcome',
    'finalMessage',
    'evidence',
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    value.version !== 1 ||
    value.role !== invocation.role ||
    value.runner !== assignment.runner ||
    value.model !== assignment.model ||
    value.effectId !== invocation.effectId ||
    value.outcome !== 'completed' ||
    typeof value.executionId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.executionId) ||
    typeof value.finalMessage !== 'string' ||
    value.finalMessage.trim().length === 0 ||
    Buffer.byteLength(value.finalMessage) > MAX_FINAL_MESSAGE_BYTES ||
    typeof value.evidence !== 'object' ||
    value.evidence === null ||
    Array.isArray(value.evidence)
  )
    throw new Error(`runner ${assignment.runner} returned an invalid result`);
  const evidence = copyEvidence(value.evidence, { entries: 0 }, 0) as Readonly<
    Record<string, unknown>
  >;
  if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_EVIDENCE_BYTES)
    throw new Error(`runner ${assignment.runner} evidence exceeds limit`);
  invocation.validateFinalMessage?.(value.finalMessage);
  const result: RunnerResult = {
    version: 1,
    role: value.role,
    runner: value.runner,
    ...(value.model === undefined ? {} : { model: value.model }),
    executionId: value.executionId,
    effectId: value.effectId,
    outcome: 'completed',
    finalMessage: value.finalMessage,
    evidence,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RUNNER_RESULT_BYTES)
    throw new Error(`runner ${assignment.runner} result exceeds receipt limit`);
  return Object.freeze(result);
}

function copyEvidence(
  value: unknown,
  count: { entries: number },
  depth: number,
): unknown {
  if (depth > MAX_EVIDENCE_DEPTH)
    throw new Error('runner evidence exceeds nesting limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('runner evidence is not JSON-safe');
    return value;
  }
  if (Array.isArray(value)) {
    count.entries += value.length;
    if (count.entries > MAX_EVIDENCE_ENTRIES)
      throw new Error('runner evidence has too many entries');
    return Object.freeze(
      value.map((entry) => copyEvidence(entry, count, depth + 1)),
    );
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error('runner evidence is not a plain JSON value');
  const entries = Object.entries(value);
  count.entries += entries.length;
  if (count.entries > MAX_EVIDENCE_ENTRIES)
    throw new Error('runner evidence has too many entries');
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        copyEvidence(entry, count, depth + 1),
      ]),
    ),
  );
}
