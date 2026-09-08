import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBoundedFixLoop } from './fix-loop.js';

test('passes the initial check without attempting a fix', async () => {
  let fixes = 0;
  const result = await runBoundedFixLoop(
    { maxAttempts: 3 },
    {
      check: async ({ attempt }) => ({
        kind: 'passed',
        reason: `passed at ${attempt}`,
      }),
      fix: async () => {
        fixes += 1;
        return { kind: 'applied', reason: 'fixed' };
      },
    },
  );

  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.attemptsUsed, 0);
  assert.equal(fixes, 0);
  assert.deepEqual(result.transitions, [
    {
      sequence: 1,
      attempt: 0,
      action: 'check',
      outcome: 'passed',
      reason: 'passed at 0',
    },
  ]);
});

test('applies fixes until a later check passes', async () => {
  const seen: string[] = [];
  const result = await runBoundedFixLoop(
    { maxAttempts: 3 },
    {
      check: async ({ attempt }) => {
        seen.push(`check:${attempt}`);
        return attempt === 2
          ? { kind: 'passed', reason: 'verification passed' }
          : { kind: 'retryable', reason: 'verification failed' };
      },
      fix: async ({ attempt }) => {
        seen.push(`fix:${attempt}`);
        return { kind: 'applied', reason: `applied fix ${attempt}` };
      },
    },
  );

  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.attemptsUsed, 2);
  assert.deepEqual(seen, ['check:0', 'fix:1', 'check:1', 'fix:2', 'check:2']);
  assert.deepEqual(
    result.transitions.map(({ sequence, attempt, action, outcome }) => ({
      sequence,
      attempt,
      action,
      outcome,
    })),
    [
      { sequence: 1, attempt: 0, action: 'check', outcome: 'retryable' },
      { sequence: 2, attempt: 1, action: 'fix', outcome: 'applied' },
      { sequence: 3, attempt: 1, action: 'check', outcome: 'retryable' },
      { sequence: 4, attempt: 2, action: 'fix', outcome: 'applied' },
      { sequence: 5, attempt: 2, action: 'check', outcome: 'passed' },
    ],
  );
});

test('does not retry a blocking check or fix', async () => {
  let calls = 0;
  const blockedCheck = await runBoundedFixLoop(
    { maxAttempts: 3 },
    {
      check: async () => ({ kind: 'blocked', reason: 'approval required' }),
      fix: async () => {
        calls += 1;
        return { kind: 'applied', reason: 'not reached' };
      },
    },
  );
  assert.equal(blockedCheck.outcome, 'blocked');
  assert.equal(blockedCheck.attemptsUsed, 0);
  assert.equal(calls, 0);

  const blockedFix = await runBoundedFixLoop(
    { maxAttempts: 3 },
    {
      check: async () => ({ kind: 'retryable', reason: 'failed' }),
      fix: async () => {
        calls += 1;
        return { kind: 'blocked', reason: 'operator input required' };
      },
    },
  );
  assert.equal(blockedFix.outcome, 'blocked');
  assert.equal(blockedFix.attemptsUsed, 1);
  assert.equal(calls, 1);
});

test('fails exactly at the configured fix-attempt ceiling', async () => {
  let checks = 0;
  let fixes = 0;
  const result = await runBoundedFixLoop(
    { maxAttempts: 2 },
    {
      check: async () => {
        checks += 1;
        return { kind: 'retryable', reason: 'still failing' };
      },
      fix: async ({ attempt }) => {
        fixes += 1;
        return { kind: 'applied', reason: `fix ${attempt}` };
      },
    },
  );

  assert.equal(result.outcome, 'failed');
  assert.equal(result.attemptsUsed, 2);
  assert.equal(result.reason, 'fix attempt ceiling exhausted after 2 attempts');
  assert.equal(checks, 3);
  assert.equal(fixes, 2);
});

test('callback errors and malformed results fail closed', async () => {
  const callbackError = await runBoundedFixLoop(
    { maxAttempts: 1 },
    {
      check: async () => {
        throw new Error('secret detail');
      },
      fix: async () => ({ kind: 'applied', reason: 'unused' }),
    },
  );
  assert.equal(callbackError.outcome, 'failed');
  assert.equal(callbackError.reason, 'check callback failed');
  assert.equal(callbackError.transitions[0]?.outcome, 'callback-error');

  const invalidFix = await runBoundedFixLoop(
    { maxAttempts: 1 },
    {
      check: async () => ({ kind: 'retryable', reason: 'failed' }),
      fix: async () => ({ kind: 'applied', reason: '' }),
    },
  );
  assert.equal(invalidFix.outcome, 'failed');
  assert.equal(invalidFix.attemptsUsed, 1);
  assert.equal(invalidFix.transitions[1]?.outcome, 'invalid-result');

  const hostileResult = await runBoundedFixLoop(
    { maxAttempts: 1 },
    {
      check: async () =>
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('hostile result');
            },
          },
        ),
      fix: async () => ({ kind: 'applied', reason: 'unused' }),
    },
  );
  assert.equal(hostileResult.outcome, 'failed');
  assert.equal(hostileResult.transitions[0]?.outcome, 'invalid-result');
});

test('rejects invalid ceilings and returns immutable evidence', async () => {
  await assert.rejects(
    () =>
      runBoundedFixLoop(
        { maxAttempts: 0 },
        {
          check: async () => ({ kind: 'passed', reason: 'passed' }),
          fix: async () => ({ kind: 'applied', reason: 'fixed' }),
        },
      ),
    /integer from 1 through 20/,
  );

  const result = await runBoundedFixLoop(
    { maxAttempts: 1 },
    {
      check: async () => ({ kind: 'passed', reason: 'passed' }),
      fix: async () => ({ kind: 'applied', reason: 'unused' }),
    },
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.transitions), true);
  assert.equal(Object.isFrozen(result.transitions[0]), true);
});

test('snapshots the validated ceiling before callbacks can mutate it', async () => {
  const config = { maxAttempts: 1 };
  let fixes = 0;
  const result = await runBoundedFixLoop(config, {
    check: async () => {
      config.maxAttempts = -1;
      return { kind: 'retryable', reason: 'still failing' };
    },
    fix: async () => {
      fixes += 1;
      return { kind: 'applied', reason: 'fixed once' };
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.attemptsUsed, 1);
  assert.equal(fixes, 1);
});

test('snapshots untrusted callback results during validation', async () => {
  let reasonReads = 0;
  const result = await runBoundedFixLoop(
    { maxAttempts: 1 },
    {
      check: async () =>
        Object.defineProperties(
          {},
          {
            kind: { enumerable: true, get: () => 'passed' },
            reason: {
              enumerable: true,
              get: () => {
                reasonReads += 1;
                if (reasonReads > 1) throw new Error('read twice');
                return 'passed safely';
              },
            },
          },
        ),
      fix: async () => ({ kind: 'applied', reason: 'unused' }),
    },
  );

  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.reason, 'passed safely');
  assert.equal(reasonReads, 1);
});
