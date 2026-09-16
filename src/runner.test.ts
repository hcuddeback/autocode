import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RoleAssignmentsConfig, WorkflowRole } from './config.js';
import {
  resolveRoleRunners,
  type RunnerAdapter,
  type RunnerInvocation,
  type RunnerResult,
} from './runner.js';

const assignments: RoleAssignmentsConfig = {
  planner: { runner: 'fake', model: 'plan-model' },
  implementer: { runner: 'fake', model: 'code-model' },
  reviewer: { runner: 'fake', model: 'review-model' },
  fixer: { runner: 'fake', model: 'fix-model' },
};

function adapter(overrides: Partial<RunnerAdapter> = {}): RunnerAdapter {
  return {
    id: 'fake',
    capabilities: {
      roles: {
        planner: 'read-only',
        implementer: 'worktree-write',
        reviewer: 'read-only',
        fixer: 'worktree-write',
      },
      acceptsModel: true,
    },
    async prepare(_root, role, assignment) {
      return {
        assignment,
        async invoke(invocation: RunnerInvocation): Promise<RunnerResult> {
          return {
            version: 1,
            role,
            runner: assignment.runner,
            ...(assignment.model === undefined
              ? {}
              : { model: assignment.model }),
            executionId: `${role}-execution`,
            effectId: invocation.effectId,
            outcome: 'completed',
            finalMessage: `${role} result`,
            evidence: {},
          };
        },
      };
    },
    ...overrides,
  };
}

test('resolves every role and preserves explicit runner/model identity', async () => {
  const resolved = await resolveRoleRunners(
    'C:/fixture',
    assignments,
    new Map([['fake', adapter()]]),
  );
  const result = await resolved.reviewer.invoke({
    role: 'reviewer',
    effectId: 'effect-review',
    artifactName: 'review',
  });
  assert.equal(result.model, 'review-model');
  assert.equal(result.runner, 'fake');
  assert.equal(result.effectId, 'effect-review');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evidence), true);
});

test('unknown runners and capability mismatches fail during preflight', async () => {
  await assert.rejects(
    () => resolveRoleRunners('C:/fixture', assignments, new Map()),
    /unknown runner: fake/,
  );
  const incapable = adapter({
    capabilities: {
      roles: { planner: 'read-only' },
      acceptsModel: true,
    },
  });
  await assert.rejects(
    () =>
      resolveRoleRunners(
        'C:/fixture',
        assignments,
        new Map([['fake', incapable]]),
      ),
    /lacks worktree-write capability for implementer/,
  );
});

test('model rejection and malformed adapter results fail closed', async () => {
  await assert.rejects(
    () =>
      resolveRoleRunners(
        'C:/fixture',
        assignments,
        new Map([
          [
            'fake',
            adapter({
              capabilities: {
                roles: adapter().capabilities.roles,
                acceptsModel: false,
              },
            }),
          ],
        ]),
      ),
    /does not accept model selection/,
  );
  const malformed = adapter({
    async prepare(_root, role: WorkflowRole, assignment) {
      return {
        assignment,
        async invoke(invocation) {
          return {
            version: 1,
            role,
            runner: assignment.runner,
            ...(assignment.model === undefined
              ? {}
              : { model: assignment.model }),
            executionId: '',
            effectId: invocation.effectId,
            outcome: 'completed',
            finalMessage: 'result',
            evidence: {},
          };
        },
      };
    },
  });
  const resolved = await resolveRoleRunners(
    'C:/fixture',
    assignments,
    new Map([['fake', malformed]]),
  );
  await assert.rejects(
    () =>
      resolved.planner.invoke({
        role: 'planner',
        effectId: 'effect-plan',
        artifactName: 'plan',
      }),
    /returned an invalid result/,
  );
});

test('adapter evidence must be bounded immutable plain JSON', async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalid = adapter({
    async prepare(_root, role, assignment) {
      return {
        assignment,
        async invoke(invocation) {
          return {
            version: 1,
            role,
            runner: assignment.runner,
            ...(assignment.model === undefined
              ? {}
              : { model: assignment.model }),
            executionId: `${role}-execution`,
            effectId: invocation.effectId,
            outcome: 'completed',
            finalMessage: 'result',
            evidence: cyclic,
          };
        },
      };
    },
  });
  const resolved = await resolveRoleRunners(
    'C:/fixture',
    assignments,
    new Map([['fake', invalid]]),
  );
  await assert.rejects(
    () =>
      resolved.planner.invoke({
        role: 'planner',
        effectId: 'effect-plan',
        artifactName: 'plan',
      }),
    /evidence exceeds nesting limit/,
  );
});
