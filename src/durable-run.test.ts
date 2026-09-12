import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { runDurableRun } from './durable-run.js';

const temporaryDirectories: string[] = [];
const definition = {
  runId: 'fixture-run',
  phases: [
    { id: 'first', description: 'Apply the first external effect.' },
    { id: 'second', description: 'Apply the second external effect.' },
  ],
} as const;

afterEach(async () => {
  mock.restoreAll();
  syncBuiltinESMExports();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('executes ordered effects once and returns deeply immutable state', async () => {
  const root = await fixtureProject();
  const calls: string[] = [];
  const callbacks = {
    async execute(phase: { id: string }, context: { effectId: string }) {
      calls.push(`${phase.id}:${context.effectId}`);
      return { kind: 'applied', reason: `${phase.id} applied` };
    },
    async reconcile() {
      throw new Error('not expected');
    },
  };

  const first = await runDurableRun(root, definition, callbacks);
  const second = await runDurableRun(root, definition, callbacks);

  assert.equal(first.outcome, 'completed');
  assert.equal(second.outcome, 'completed');
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map((call) => call.split(':')[1])).size, 2);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state), true);
  assert.equal(Object.isFrozen(first.state.phases), true);
  assert.equal(Object.isFrozen(first.state.phases[0]), true);
  const events = await eventLines(first.runDirectory);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'run-created',
      'effect-started',
      'effect-completed',
      'effect-started',
      'effect-completed',
      'run-completed',
    ],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6],
  );
});

test('pauses only after a completed phase and resumes at the next phase', async () => {
  const root = await fixtureProject();
  const calls: string[] = [];
  const callbacks = appliedCallbacks(calls);

  const paused = await runDurableRun(root, definition, callbacks, {
    pauseAfterPhase: 'first',
  });
  assert.equal(paused.outcome, 'paused');
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(
    paused.state.phases.map((phase) => phase.status),
    ['completed', 'pending'],
  );

  const resumed = await runDurableRun(root, definition, callbacks);
  assert.equal(resumed.outcome, 'completed');
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(
    (await eventLines(resumed.runDirectory)).some(
      (event) => event.type === 'run-resumed',
    ),
    true,
  );
});

test('recovers an event appended before its snapshot without repeating the effect', async () => {
  const root = await fixtureProject();
  let executions = 0;
  let interrupted = false;
  const callbacks = {
    async execute() {
      executions += 1;
      return { kind: 'applied', reason: 'effect applied once' };
    },
    async reconcile() {
      throw new Error(
        'reconciliation is unnecessary when completion event is durable',
      );
    },
  };

  await assert.rejects(
    runDurableRun(root, singlePhaseDefinition('event-window'), callbacks, {
      async onCheckpoint(checkpoint, state) {
        if (
          !interrupted &&
          checkpoint === 'after-event-appended' &&
          state.phases[0]?.status === 'completed'
        ) {
          interrupted = true;
          throw new Error('forced snapshot window');
        }
      },
    }),
    /forced snapshot window/,
  );

  const resumed = await runDurableRun(
    root,
    singlePhaseDefinition('event-window'),
    callbacks,
  );
  assert.equal(resumed.outcome, 'completed');
  assert.equal(executions, 1);
});

test('recovers an empty event log left by interrupted initial publication', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('empty-event-log');
  const runDirectory = path.join(
    root,
    '.autocode',
    'runs',
    'durable-empty-event-log',
  );
  await mkdir(runDirectory);
  await writeFile(path.join(runDirectory, 'events.jsonl'), '');
  const calls: string[] = [];

  const result = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks(calls),
  );

  assert.equal(result.outcome, 'completed');
  assert.deepEqual(calls, ['effect']);
});

test('preserves a requested pause across the completion checkpoint window', async () => {
  const root = await fixtureProject();
  const calls: string[] = [];
  let interrupted = false;

  await assert.rejects(
    runDurableRun(root, definition, appliedCallbacks(calls), {
      pauseAfterPhase: 'first',
      async onCheckpoint(checkpoint, state) {
        if (
          !interrupted &&
          checkpoint === 'after-event-appended' &&
          state.phases[0]?.status === 'completed'
        ) {
          interrupted = true;
          throw new Error('forced pause checkpoint window');
        }
      },
    }),
    /forced pause checkpoint window/,
  );

  const resumed = await runDurableRun(
    root,
    definition,
    appliedCallbacks(calls),
    { pauseAfterPhase: 'first' },
  );
  assert.equal(resumed.outcome, 'paused');
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(
    resumed.state.phases.map((phase) => phase.status),
    ['completed', 'pending'],
  );
});

test('forced process interruption reconciles the applied effect without repeating it', async () => {
  const root = await fixtureProject();
  const marker = path.join(root, 'effect-marker.txt');
  const child = path.join(root, 'forced-interruption.ts');
  await writeFile(
    child,
    interruptionProgram(new URL('./durable-run.ts', import.meta.url).href),
  );
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), child, root, marker],
    { cwd: root, encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(result.status, 86, result.stderr);
  const effectId = (await readFile(marker, 'utf8')).trim();
  let executions = 0;
  let reconciliations = 0;

  const resumed = await runDurableRun(
    root,
    singlePhaseDefinition('forced-interruption', 'publish'),
    {
      async execute() {
        executions += 1;
        return { kind: 'applied', reason: 'must not execute again' };
      },
      async reconcile(_phase, context) {
        reconciliations += 1;
        assert.equal(context.effectId, effectId);
        assert.equal((await readFile(marker, 'utf8')).trim(), effectId);
        return {
          kind: 'applied',
          reason: 'existing marker proves effect applied',
        };
      },
    },
  );

  assert.equal(resumed.outcome, 'completed');
  assert.equal(reconciliations, 1);
  assert.equal(executions, 0);
  assert.equal((await readFile(marker, 'utf8')).trim(), effectId);
});

test('reuses the stable identity only after reconciliation proves no effect exists', async () => {
  const root = await fixtureProject();
  const effects: string[] = [];
  let interrupt = true;
  const runDefinition = singlePhaseDefinition('not-applied');
  const callbacks = {
    async execute(_phase: unknown, context: { effectId: string }) {
      effects.push(context.effectId);
      return { kind: 'applied', reason: 'effect accepted' };
    },
    async reconcile() {
      return {
        kind: 'not-applied',
        reason: 'provider confirms no effect exists',
      };
    },
  };
  await assert.rejects(
    runDurableRun(root, runDefinition, callbacks, {
      async onCheckpoint(checkpoint) {
        if (interrupt && checkpoint === 'after-effect-applied') {
          interrupt = false;
          throw new Error('interrupt after uncertain callback');
        }
      },
    }),
    /interrupt after uncertain callback/,
  );
  const resumed = await runDurableRun(root, runDefinition, callbacks);
  assert.equal(resumed.outcome, 'completed');
  assert.equal(effects.length, 2);
  assert.equal(effects[0], effects[1]);
});

test('blocks on ambiguous reconciliation without invoking the effect', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('ambiguous');
  let executions = 0;
  let interrupt = true;
  const callbacks = {
    async execute() {
      executions += 1;
      return { kind: 'applied', reason: 'effect may exist' };
    },
    async reconcile() {
      return {
        kind: 'ambiguous',
        reason: 'provider cannot determine effect state',
      };
    },
  };
  await assert.rejects(
    runDurableRun(root, runDefinition, callbacks, {
      async onCheckpoint(checkpoint) {
        if (interrupt && checkpoint === 'after-effect-applied') {
          interrupt = false;
          throw new Error('interrupt');
        }
      },
    }),
  );
  const blocked = await runDurableRun(root, runDefinition, callbacks);
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(executions, 1);
  assert.equal(blocked.state.phases[0]?.status, 'in-flight');
});

test('rejects definition drift and corrupt snapshots', async () => {
  const root = await fixtureProject();
  const completed = await runDurableRun(
    root,
    singlePhaseDefinition('drift'),
    appliedCallbacks([]),
  );
  await assert.rejects(
    runDurableRun(
      root,
      singlePhaseDefinition('drift', 'changed'),
      appliedCallbacks([]),
    ),
    /current run definition/,
  );
  const statePath = path.join(completed.runDirectory, 'run.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')) as {
    status: string;
  };
  state.status = 'blocked';
  await writeFile(statePath, `${JSON.stringify(state)}\n`);
  await assert.rejects(
    runDurableRun(root, singlePhaseDefinition('drift'), appliedCallbacks([])),
    /snapshot does not match/,
  );
});

test('rejects concurrent ownership and resumes after the owner releases', async () => {
  const root = await fixtureProject();
  let releaseEffect!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseEffect = resolve;
  });
  const first = runDurableRun(root, singlePhaseDefinition('concurrent'), {
    async execute() {
      await gate;
      return { kind: 'applied', reason: 'effect released' };
    },
    async reconcile() {
      throw new Error('not expected');
    },
  });
  await waitForPath(
    path.join(root, '.autocode', 'runs', 'durable-concurrent', 'run.lock'),
  );
  await assert.rejects(
    runDurableRun(
      root,
      singlePhaseDefinition('concurrent'),
      appliedCallbacks([]),
    ),
    /already locked/,
  );
  releaseEffect();
  assert.equal((await first).outcome, 'completed');
});

test('recovers an empty lock directory left by interrupted release', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('empty-lock');
  const runDirectory = path.join(
    root,
    '.autocode',
    'runs',
    'durable-empty-lock',
  );
  await mkdir(path.join(runDirectory, 'run.lock'), { recursive: true });

  const result = await runDurableRun(root, runDefinition, appliedCallbacks([]));
  assert.equal(result.outcome, 'completed');
});

test('reclaims a stale lock after its owner PID is reused', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('reused-pid');
  const lockDirectory = path.join(
    root,
    '.autocode',
    'runs',
    'durable-reused-pid',
    'run.lock',
  );
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(
    path.join(lockDirectory, 'owner.json'),
    `${JSON.stringify({
      version: 1,
      hostname: os.hostname(),
      pid: process.pid,
      processIdentity: 'identity-from-former-process',
      token: 'former-owner-token',
    })}\n`,
  );

  const result = await runDurableRun(root, runDefinition, appliedCallbacks([]));
  assert.equal(result.outcome, 'completed');
});

test('stale reclamation preserves and releases a displaced owner despite a third invocation', async () => {
  for (const [empty, obstructed] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const root = await fixtureProject();
    const runDefinition = singlePhaseDefinition(
      empty ? 'empty-reclaim-race' : 'reclaim-race',
    );
    const runDirectory = path.join(
      root,
      '.autocode',
      'runs',
      `durable-${runDefinition.runId}`,
    );
    const lockDirectory = path.join(runDirectory, 'run.lock');
    await mkdir(lockDirectory, { recursive: true });
    if (!empty)
      await writeFile(
        path.join(lockDirectory, 'owner.json'),
        JSON.stringify({
          version: 1,
          hostname: os.hostname(),
          pid: process.pid,
          processIdentity: 'former-process',
          token: 'former-token',
        }),
      );
    let inspected!: () => void;
    const inspection = new Promise<void>((resolve) => {
      inspected = resolve;
    });
    let resumeReclaimer!: () => void;
    const reclaimGate = new Promise<void>((resolve) => {
      resumeReclaimer = resolve;
    });
    let quarantined!: () => void;
    const quarantine = new Promise<void>((resolve) => {
      quarantined = resolve;
    });
    let resumeValidation!: () => void;
    const validationGate = new Promise<void>((resolve) => {
      resumeValidation = resolve;
    });
    let contenderReleasing!: () => void;
    const contenderRelease = new Promise<void>((resolve) => {
      contenderReleasing = resolve;
    });
    let finishContender!: () => void;
    const contenderGate = new Promise<void>((resolve) => {
      finishContender = resolve;
    });
    let holdContender = false;
    let firstRename = true;
    const nativeRename = fsPromises.rename;
    mock.method(
      fsPromises,
      'rename',
      async (
        source: Parameters<typeof nativeRename>[0],
        target: Parameters<typeof nativeRename>[1],
      ) => {
        if (
          holdContender &&
          source === lockDirectory &&
          String(target).includes('.stale-')
        ) {
          holdContender = false;
          contenderReleasing();
          await contenderGate;
        }
        if (
          source === lockDirectory &&
          String(target).includes('.stale-') &&
          firstRename
        ) {
          firstRename = false;
          inspected();
          await reclaimGate;
          await nativeRename(source, target);
          quarantined();
          await validationGate;
          return;
        }
        return nativeRename(source, target);
      },
    );
    syncBuiltinESMExports();
    const attempts: string[] = [];
    const first = assert.rejects(
      runDurableRun(root, runDefinition, appliedCallbacks(attempts)),
      /owner changed during reclamation/,
    );
    await inspection;
    let executing!: () => void;
    const execution = new Promise<void>((resolve) => {
      executing = resolve;
    });
    let finishEffect!: () => void;
    const effectGate = new Promise<void>((resolve) => {
      finishEffect = resolve;
    });
    const second = runDurableRun(root, runDefinition, {
      async execute() {
        attempts.push('second');
        executing();
        await effectGate;
        return { kind: 'applied', reason: 'one effect' };
      },
      async reconcile() {
        throw new Error('unexpected');
      },
    });
    await execution;
    const replacementOwner = await readFile(
      path.join(lockDirectory, 'owner.json'),
      'utf8',
    );
    resumeReclaimer();
    await quarantine;
    holdContender = obstructed === true;
    const third = assert.rejects(
      runDurableRun(root, runDefinition, appliedCallbacks(attempts)),
      /already locked by a quarantined owner/,
    );
    if (obstructed) await contenderRelease;
    else await third;
    resumeValidation();
    await first;
    const canonicalOwner = await readFile(
      path.join(lockDirectory, 'owner.json'),
      'utf8',
    );
    if (obstructed) assert.notEqual(canonicalOwner, replacementOwner);
    else assert.equal(canonicalOwner, replacementOwner);
    finishEffect();
    assert.equal((await second).outcome, 'completed');
    if (obstructed) {
      // Releasing B while C still owns the canonical path removes only B's
      // quarantine. C's owner remains intact until its own release proceeds.
      assert.equal(
        await readFile(path.join(lockDirectory, 'owner.json'), 'utf8'),
        canonicalOwner,
      );
      finishContender();
      await third;
    }
    assert.equal(
      (await runDurableRun(root, runDefinition, appliedCallbacks(attempts)))
        .outcome,
      'completed',
    );
    assert.deepEqual(attempts, ['second']);
    mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('recovers a dead quarantine left by interrupted reclamation', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('dead-quarantine');
  const stale = path.join(
    root,
    '.autocode',
    'runs',
    'durable-dead-quarantine',
    'run.lock.stale-former-owner',
  );
  await mkdir(stale, { recursive: true });
  await writeFile(
    path.join(stale, 'owner.json'),
    JSON.stringify({
      version: 1,
      hostname: os.hostname(),
      pid: process.pid,
      processIdentity: 'former-process',
      token: 'former-token',
    }),
  );
  assert.equal(
    (await runDurableRun(root, runDefinition, appliedCallbacks([]))).outcome,
    'completed',
  );
  await assert.rejects(readFile(path.join(stale, 'owner.json')), {
    code: 'ENOENT',
  });
});

test('overlapping workspace secrets never reach execution or reconciliation evidence', async () => {
  const root = await fixtureProject();
  await writeFile(path.join(root, '.env'), 'SHORT=abcd\nLONG=abcdEFGHIJKL\n');
  const runDefinition = singlePhaseDefinition('overlapping-secrets');
  let interrupt = true;
  const callbacks = {
    async execute() {
      return { kind: 'applied', reason: 'provider echoed abcdEFGHIJKL' };
    },
    async reconcile() {
      return { kind: 'applied', reason: 'provider echoed abcdEFGHIJKL' };
    },
  };
  await assert.rejects(
    runDurableRun(root, runDefinition, callbacks, {
      async onCheckpoint(checkpoint) {
        if (interrupt && checkpoint === 'after-effect-applied') {
          interrupt = false;
          throw new Error('interrupt');
        }
      },
    }),
    /interrupt/,
  );
  const result = await runDurableRun(root, runDefinition, callbacks);
  for (const name of ['events.jsonl', 'run.json']) {
    const contents = await readFile(
      path.join(result.runDirectory, name),
      'utf8',
    );
    assert.equal(contents.includes('abcd'), false);
    assert.equal(contents.includes('EFGHIJKL'), false);
  }
  await assert.rejects(
    runDurableRun(
      root,
      {
        runId: 'overlapping-definition',
        phases: [{ id: 'effect', description: 'Use abcdEFGHIJKL' }],
      },
      appliedCallbacks([]),
    ),
    /credential/,
  );
});

test('rejects a symlinked lock directory without modifying its target', async () => {
  const root = await fixtureProject();
  const runDirectory = path.join(
    root,
    '.autocode',
    'runs',
    'durable-symlinked-lock',
  );
  const target = path.join(root, 'lock-target');
  await mkdir(runDirectory);
  await mkdir(target);
  const ownerPath = path.join(target, 'owner.json');
  await writeFile(ownerPath, 'preserve target contents\n');
  await symlink(
    target,
    path.join(runDirectory, 'run.lock'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  await assert.rejects(
    runDurableRun(
      root,
      singlePhaseDefinition('symlinked-lock'),
      appliedCallbacks([]),
    ),
    /lock directory must be a real directory/,
  );
  assert.equal(await readFile(ownerPath, 'utf8'), 'preserve target contents\n');
});

test('rejects unsafe and hostile definitions and adapter results', async () => {
  const root = await fixtureProject();
  const callbacks = appliedCallbacks([]);
  await assert.rejects(
    runDurableRun(
      root,
      { runId: '../escape', phases: definition.phases },
      callbacks,
    ),
    /run id is invalid/,
  );
  await assert.rejects(
    runDurableRun(
      root,
      { runId: 'Case-Alias', phases: definition.phases },
      callbacks,
    ),
    /run id is invalid/,
  );
  await assert.rejects(
    runDurableRun(root, new Proxy(definition, {}), callbacks),
    /plain mapping/,
  );
  await assert.rejects(
    runDurableRun(
      root,
      {
        runId: 'excessive',
        phases: Array.from({ length: 65 }, (_, index) => ({
          id: `phase-${index}`,
          description: 'Bounded phase.',
        })),
      },
      callbacks,
    ),
    /between 1 and 64 phases/,
  );
  let getterCalls = 0;
  const accessorDefinition = Object.defineProperty(
    { phases: definition.phases },
    'runId',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'accessor';
      },
    },
  );
  await assert.rejects(
    runDurableRun(
      root,
      accessorDefinition as unknown as typeof definition,
      callbacks,
    ),
    /plain data properties/,
  );
  assert.equal(getterCalls, 0);
  await assert.rejects(
    runDurableRun(root, singlePhaseDefinition('hostile-result'), {
      async execute() {
        return new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('trap');
            },
          },
        );
      },
      async reconcile() {
        return { kind: 'not-applied', reason: 'not reached' };
      },
    }),
    /invalid result.*reconciliation is required/,
  );
  let resultGetterCalls = 0;
  await assert.rejects(
    runDurableRun(root, singlePhaseDefinition('accessor-result'), {
      async execute() {
        return Object.defineProperty({ kind: 'applied' }, 'reason', {
          enumerable: true,
          get() {
            resultGetterCalls += 1;
            return 'must not be read';
          },
        });
      },
      async reconcile() {
        return { kind: 'not-applied', reason: 'not reached' };
      },
    }),
    /invalid result.*reconciliation is required/,
  );
  assert.equal(resultGetterCalls, 0);
});

test('refreshes credential redaction after execution and reconciliation callbacks', async () => {
  const root = await fixtureProject();
  const initialSecret = '123456';
  const executionSecret = '654321';
  const reconciliationSecret = '987654';
  await writeFile(path.join(root, '.env'), `SERVICE_TOKEN=${initialSecret}\n`);

  const executed = await runDurableRun(
    root,
    singlePhaseDefinition('redacted-execution'),
    {
      async execute() {
        await writeFile(
          path.join(root, '.env'),
          `SERVICE_TOKEN=${executionSecret}\n`,
        );
        return {
          kind: 'applied',
          reason: `provider echoed ${executionSecret}`,
        };
      },
      async reconcile() {
        throw new Error('not expected');
      },
    },
  );
  assert.equal(
    (
      await readFile(path.join(executed.runDirectory, 'events.jsonl'), 'utf8')
    ).includes(executionSecret),
    false,
  );
  assert.equal(
    (
      await readFile(path.join(executed.runDirectory, 'run.json'), 'utf8')
    ).includes(executionSecret),
    false,
  );

  const reconciliationDefinition = singlePhaseDefinition(
    'redacted-reconciliation',
  );
  await assert.rejects(
    runDurableRun(
      root,
      reconciliationDefinition,
      {
        async execute() {
          return { kind: 'applied', reason: 'effect applied' };
        },
        async reconcile() {
          throw new Error('not reached before interruption');
        },
      },
      {
        async onCheckpoint(checkpoint) {
          if (checkpoint === 'after-effect-applied')
            throw new Error('forced reconciliation');
        },
      },
    ),
    /forced reconciliation/,
  );
  const reconciled = await runDurableRun(root, reconciliationDefinition, {
    async execute() {
      throw new Error('must not execute again');
    },
    async reconcile() {
      await writeFile(
        path.join(root, '.env'),
        `SERVICE_TOKEN=${reconciliationSecret}\n`,
      );
      return {
        kind: 'applied',
        reason: `provider echoed ${reconciliationSecret}`,
      };
    },
  });
  const durableContents = await Promise.all([
    readFile(path.join(reconciled.runDirectory, 'events.jsonl'), 'utf8'),
    readFile(path.join(reconciled.runDirectory, 'run.json'), 'utf8'),
  ]);
  assert.equal(
    durableContents.some((contents) =>
      [initialSecret, executionSecret, reconciliationSecret].some((secret) =>
        contents.includes(secret),
      ),
    ),
    false,
  );
  assert.equal(
    durableContents.every((contents) => contents.includes('<redacted>')),
    true,
  );
});

test('rejects an adapter reason that exceeds bounds after redaction', async () => {
  const root = await fixtureProject();
  const secret = '12345678';
  const runDefinition = singlePhaseDefinition('expanded-redaction');
  await writeFile(path.join(root, '.env'), `SERVICE_TOKEN=${secret}\n`);

  await assert.rejects(
    runDurableRun(root, runDefinition, {
      async execute() {
        return { kind: 'applied', reason: secret.repeat(512) };
      },
      async reconcile() {
        throw new Error('not reached');
      },
    }),
    /invalid result.*reconciliation is required/,
  );

  const resumed = await runDurableRun(root, runDefinition, {
    async execute() {
      throw new Error('must not execute again');
    },
    async reconcile() {
      return { kind: 'applied', reason: 'effect reconciled safely' };
    },
  });
  assert.equal(resumed.outcome, 'completed');
});

test('rejects credential-bearing phase definitions before creating run state', async () => {
  const root = await fixtureProject();
  const secret = '654321';
  await writeFile(path.join(root, '.env'), `SERVICE_TOKEN=${secret}\n`);

  await assert.rejects(
    runDurableRun(
      root,
      {
        runId: 'credential-definition',
        phases: [{ id: 'effect', description: `Publish ${secret}` }],
      },
      appliedCallbacks([]),
    ),
    /phase definition must not contain credentials/,
  );
  await assert.rejects(
    readFile(
      path.join(
        root,
        '.autocode',
        'runs',
        'durable-credential-definition',
        'run.json',
      ),
    ),
    { code: 'ENOENT' },
  );
});

test('rejects unignored and tracked durable run paths before execution', async () => {
  const unignoredRoot = await fixtureProject();
  await writeFile(path.join(unignoredRoot, '.gitignore'), '');
  await assert.rejects(
    runDurableRun(
      unignoredRoot,
      singlePhaseDefinition('unignored'),
      appliedCallbacks([]),
    ),
    /must be gitignored/,
  );

  const trackedRoot = await fixtureProject();
  const trackedRun = path.join(
    trackedRoot,
    '.autocode',
    'runs',
    'durable-tracked',
  );
  await mkdir(trackedRun);
  await writeFile(path.join(trackedRun, 'run.json'), '{}\n');
  const added = spawnSync(
    'git',
    ['add', '--force', '.autocode/runs/durable-tracked/run.json'],
    { cwd: trackedRoot, encoding: 'utf8' },
  );
  assert.equal(added.status, 0, added.stderr);
  await assert.rejects(
    runDurableRun(
      trackedRoot,
      singlePhaseDefinition('tracked'),
      appliedCallbacks([]),
    ),
    /must not be tracked/,
  );
});

test('discards an incomplete final event record and resumes from the durable snapshot', async () => {
  const root = await fixtureProject();
  const completed = await runDurableRun(
    root,
    singlePhaseDefinition('partial-tail'),
    appliedCallbacks([]),
  );
  const eventsPath = path.join(completed.runDirectory, 'events.jsonl');
  await appendFile(eventsPath, '{"version":1');
  const resumed = await runDurableRun(
    root,
    singlePhaseDefinition('partial-tail'),
    appliedCallbacks([]),
  );
  assert.equal(resumed.outcome, 'completed');
  assert.equal((await readFile(eventsPath, 'utf8')).endsWith('\n'), true);
});

test('restart preserves the original retry timestamp and attempt count', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('persisted-retry', {
    initialBackoffMs: 1_000,
    maxBackoffMs: 4_000,
  });
  let now = 10_000;
  const attempts: number[] = [];
  let interrupt = true;
  await assert.rejects(
    runDurableRun(
      root,
      runDefinition,
      {
        async execute(_phase, context) {
          attempts.push(context.attempt);
          return { kind: 'retryable', reason: 'provider asked for retry' };
        },
        async reconcile() {
          throw new Error('not expected for a durably scheduled retry');
        },
      },
      {
        clock: () => now,
        async wait(milliseconds) {
          now += milliseconds;
        },
        async onCheckpoint(checkpoint, state) {
          if (
            interrupt &&
            checkpoint === 'after-state-published' &&
            state.status === 'waiting'
          ) {
            interrupt = false;
            throw new Error('restart during backoff');
          }
        },
      },
    ),
    /restart during backoff/,
  );

  now = 10_250;
  const waits: number[] = [];
  const resumed = await runDurableRun(
    root,
    runDefinition,
    {
      async execute(_phase, context) {
        attempts.push(context.attempt);
        return { kind: 'applied', reason: 'retry succeeded' };
      },
      async reconcile() {
        throw new Error('scheduled retries do not reconcile');
      },
    },
    {
      clock: () => now,
      async wait(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
      },
    },
  );

  assert.equal(resumed.outcome, 'completed');
  assert.deepEqual(waits, [750]);
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(resumed.state.phases[0]?.attemptsUsed, 2);
  assert.equal(Object.isFrozen(resumed.state.retryPolicy), true);
});

test('rejects shortened backoff in an event ahead of the snapshot', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('corrupt-backoff', {
    initialBackoffMs: 1_000,
    maxBackoffMs: 1_000,
  });
  await assert.rejects(
    runDurableRun(
      root,
      runDefinition,
      {
        async execute() {
          return { kind: 'retryable', reason: 'retry later' };
        },
        async reconcile() {
          throw new Error('unexpected');
        },
      },
      {
        clock: () => 1_000,
        async onCheckpoint(checkpoint, state) {
          if (
            checkpoint === 'after-event-appended' &&
            state.status === 'waiting'
          )
            throw new Error('interrupted retry snapshot');
        },
      },
    ),
    /interrupted retry snapshot/,
  );
  const directory = path.join(
    root,
    '.autocode',
    'runs',
    'durable-corrupt-backoff',
  );
  const events = await eventLines(directory);
  events.at(-1)!.nextAttemptAt = new Date(1_000).toISOString();
  await writeFile(
    path.join(directory, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  const calls: string[] = [];
  await assert.rejects(
    runDurableRun(root, runDefinition, appliedCallbacks(calls), {
      clock: () => 1_000,
    }),
    /violates retry policy/,
  );
  assert.deepEqual(calls, []);
});

test('fails before invocation when checkpoint persistence crosses the deadline', async () => {
  const root = await fixtureProject();
  let now = 1_000;
  const calls: string[] = [];
  const runDefinition = pacedDefinition('late-invocation', {
    maxElapsedMs: 100,
  });
  const result = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks(calls),
    {
      clock: () => now,
      async onCheckpoint(checkpoint, state) {
        if (
          checkpoint === 'after-state-published' &&
          state.phases[0]?.status === 'in-flight'
        )
          now = 1_100;
      },
    },
  );
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(calls, []);
  assert.equal(
    (await runDurableRun(root, runDefinition, appliedCallbacks(calls))).outcome,
    'failed',
  );
  assert.deepEqual(calls, []);
});

test('records late applied effects and fails across completion interruption and reconciliation', async () => {
  for (const recovery of [
    'none',
    'completion-event',
    'reconciliation',
  ] as const) {
    const root = await fixtureProject();
    const runDefinition = pacedDefinition(`late-applied-${recovery}`, {
      maxElapsedMs: 100,
    });
    let now = 1_000;
    let calls = 0;
    let reconciliations = 0;
    const callbacks = {
      async execute() {
        calls += 1;
        now = 1_100;
        return { kind: 'applied', reason: 'effect confirmed applied' } as const;
      },
      async reconcile() {
        reconciliations += 1;
        return {
          kind: 'applied',
          reason: 'effect confirmed on resume',
        } as const;
      },
    };
    const options = {
      clock: () => now,
      async onCheckpoint(
        checkpoint: string,
        state: { phases: readonly { status: string }[] },
      ) {
        if (
          (recovery === 'completion-event' &&
            checkpoint === 'after-event-appended' &&
            state.phases[0]?.status === 'completed') ||
          (recovery === 'reconciliation' &&
            checkpoint === 'after-effect-applied')
        )
          throw new Error('completion interrupted');
      },
    };
    let result;
    if (recovery === 'none')
      result = await runDurableRun(root, runDefinition, callbacks, options);
    else {
      await assert.rejects(
        runDurableRun(root, runDefinition, callbacks, options),
        /completion interrupted/,
      );
      result = await runDurableRun(root, runDefinition, callbacks, {
        clock: () => now,
      });
    }
    assert.equal(result.outcome, 'failed');
    assert.equal(result.state.phases[0]?.status, 'completed');
    assert.equal(calls, 1);
    assert.equal(reconciliations, recovery === 'reconciliation' ? 1 : 0);
    assert.equal(
      (await runDurableRun(root, runDefinition, callbacks)).outcome,
      'failed',
    );
    assert.equal(calls, 1);
  }
});

test('completion clock races persist failure and remain resumable', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('completion-deadline-race', {
    maxElapsedMs: 100,
  });
  let completed = false;
  let completionClockReads = 0;
  const calls: string[] = [];
  const result = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks(calls),
    {
      clock: () =>
        completed ? (++completionClockReads === 1 ? 1_099 : 1_100) : 1_000,
      async onCheckpoint(checkpoint, state) {
        if (
          checkpoint === 'after-state-published' &&
          state.phases[0]?.status === 'completed'
        )
          completed = true;
      },
    },
  );
  assert.equal(result.outcome, 'failed');
  assert.equal(result.state.phases[0]?.status, 'completed');
  assert.deepEqual(
    (await eventLines(result.runDirectory)).map((event) => event.type),
    ['run-created', 'effect-started', 'effect-completed', 'run-failed'],
  );
  assert.equal(
    (await runDurableRun(root, runDefinition, appliedCallbacks(calls))).outcome,
    'failed',
  );
  assert.deepEqual(calls, ['effect']);
});

test('clock deadline races fail durably before an attempt event is appended', async () => {
  const root = await fixtureProject();
  const times = [1_000, 1_000, 1_100];
  const result = await runDurableRun(
    root,
    pacedDefinition('deadline-race', { maxElapsedMs: 100 }),
    appliedCallbacks([]),
    {
      clock: () => times.shift() ?? 1_100,
    },
  );
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(
    (await eventLines(result.runDirectory)).map((event) => event.type),
    ['run-created', 'run-failed'],
  );
  const resumed = await runDurableRun(
    root,
    pacedDefinition('deadline-race', { maxElapsedMs: 100 }),
    appliedCallbacks([]),
  );
  assert.equal(resumed.outcome, 'failed');
});

test('a waiting run can pause safely after an earlier completed phase', async () => {
  const root = await fixtureProject();
  let now = 15_000;
  let interrupted = false;
  const runDefinition = {
    runId: 'pause-waiting',
    phases: definition.phases,
    retryPolicy: {
      ...defaultTestPolicy(),
      initialBackoffMs: 1_000,
      maxBackoffMs: 1_000,
    },
  };
  await assert.rejects(
    runDurableRun(
      root,
      runDefinition,
      {
        async execute(phase) {
          return phase.id === 'first'
            ? { kind: 'applied', reason: 'first applied' }
            : { kind: 'retryable', reason: 'second waits' };
        },
        async reconcile() {
          throw new Error('not expected');
        },
      },
      {
        clock: () => now,
        async wait(milliseconds) {
          now += milliseconds;
        },
        async onCheckpoint(checkpoint, state) {
          if (
            !interrupted &&
            checkpoint === 'after-state-published' &&
            state.status === 'waiting'
          ) {
            interrupted = true;
            throw new Error('restart before pause request');
          }
        },
      },
    ),
    /restart before pause request/,
  );

  const paused = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks([]),
    {
      pauseAfterPhase: 'first',
      clock: () => now,
      async wait(milliseconds) {
        now += milliseconds;
      },
    },
  );
  assert.equal(paused.outcome, 'paused');
  assert.equal(paused.state.phases[1]?.status, 'waiting');
  assert.equal(
    (
      await runDurableRun(root, runDefinition, appliedCallbacks([]), {
        pauseAfterPhase: 'first',
        clock: () => now,
      })
    ).outcome,
    'paused',
  );
});

test('large clock rollback splits waits into Node-safe timer intervals', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('timer-cap', {
    initialBackoffMs: 1_000,
    maxBackoffMs: 1_000,
  });
  let now = 3_000_000_000;
  let interrupted = false;
  await assert.rejects(
    runDurableRun(
      root,
      runDefinition,
      {
        async execute() {
          return { kind: 'retryable', reason: 'retry after rollback' };
        },
        async reconcile() {
          throw new Error('not expected');
        },
      },
      {
        clock: () => now,
        async wait(milliseconds) {
          now += milliseconds;
        },
        async onCheckpoint(checkpoint, state) {
          if (
            !interrupted &&
            checkpoint === 'after-state-published' &&
            state.status === 'waiting'
          ) {
            interrupted = true;
            throw new Error('restart before rollback');
          }
        },
      },
    ),
    /restart before rollback/,
  );

  now = 0;
  const waits: number[] = [];
  const result = await runDurableRun(
    root,
    runDefinition,
    {
      async execute() {
        return { kind: 'applied', reason: 'retry applied' };
      },
      async reconcile() {
        throw new Error('not expected');
      },
    },
    {
      clock: () => now,
      async wait(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
      },
    },
  );
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(waits, [2_147_483_647, 852_517_353]);
});

test('restart cannot reset or exceed the persisted attempt ceiling', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('attempt-ceiling', {
    maxAttempts: 2,
    initialBackoffMs: 100,
    maxBackoffMs: 100,
  });
  let now = 20_000;
  let interrupt = true;
  const attempts: number[] = [];
  const callbacks = {
    async execute(_phase: unknown, context: { attempt: number }) {
      attempts.push(context.attempt);
      return { kind: 'retryable' as const, reason: 'still unavailable' };
    },
    async reconcile() {
      throw new Error('not expected');
    },
  };
  await assert.rejects(
    runDurableRun(root, runDefinition, callbacks, {
      clock: () => now,
      async wait(milliseconds) {
        now += milliseconds;
      },
      async onCheckpoint(checkpoint, state) {
        if (
          interrupt &&
          checkpoint === 'after-state-published' &&
          state.status === 'waiting'
        ) {
          interrupt = false;
          throw new Error('restart after first attempt');
        }
      },
    }),
    /restart after first attempt/,
  );

  const result = await runDurableRun(root, runDefinition, callbacks, {
    clock: () => now,
    async wait(milliseconds) {
      now += milliseconds;
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.deepEqual(attempts, [1, 2]);
  assert.match(result.state.reason, /ceiling exhausted.*2 attempts/);
  assert.equal(
    (await eventLines(result.runDirectory)).filter(
      (event) => event.type === 'effect-started',
    ).length,
    2,
  );
});

test('upgrades a compatible AC-010 snapshot without resetting durable history', async () => {
  const root = await fixtureProject();
  const runDefinition = singlePhaseDefinition('legacy-snapshot');
  const completed = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks([]),
  );
  const statePath = path.join(completed.runDirectory, 'run.json');
  const legacy = JSON.parse(await readFile(statePath, 'utf8')) as Record<
    string,
    unknown
  >;
  legacy.version = 1;
  delete legacy.nextEffectAt;
  delete legacy.retryPolicy;
  for (const phase of legacy.phases as Array<Record<string, unknown>>) {
    delete phase.attemptsUsed;
    delete phase.nextAttemptAt;
  }
  const eventsPath = path.join(completed.runDirectory, 'events.jsonl');
  const events = await eventLines(completed.runDirectory);
  const twoDaysLater = new Date(
    Date.parse(legacy.createdAt as string) + 2 * MAX_TEST_DELAY,
  ).toISOString();
  for (const event of events) {
    event.version = 1;
    if ((event.sequence as number) > 1) event.at = twoDaysLater;
  }
  legacy.updatedAt = twoDaysLater;
  await writeFile(
    eventsPath,
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  await writeFile(statePath, `${JSON.stringify(legacy)}\n`);

  const calls: string[] = [];
  const resumed = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks(calls),
  );
  assert.equal(resumed.outcome, 'completed');
  assert.deepEqual(calls, []);
  assert.equal(resumed.state.version, 2);
  assert.equal(resumed.state.phases[0]?.attemptsUsed, 1);
  assert.equal(
    (JSON.parse(await readFile(statePath, 'utf8')) as { version: number })
      .version,
    2,
  );
});

test('rejects version-one events appended after version-two history begins', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('downgraded-event');
  const completed = await runDurableRun(
    root,
    runDefinition,
    appliedCallbacks([]),
  );
  const events = await eventLines(completed.runDirectory);
  events[1]!.version = 1;
  await writeFile(
    path.join(completed.runDirectory, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  await assert.rejects(
    runDurableRun(root, runDefinition, appliedCallbacks([])),
    /version 1 durable events must form a legacy prefix/,
  );
});

test('enforces minimum spacing, exponential backoff cap, and retry-after', async () => {
  const root = await fixtureProject();
  let now = 30_000;
  const starts: number[] = [];
  const waits: number[] = [];
  const runDefinition = pacedDefinition('pacing-arithmetic', {
    maxAttempts: 4,
    minimumIntervalMs: 50,
    initialBackoffMs: 100,
    backoffMultiplier: 3,
    maxBackoffMs: 250,
  });
  const result = await runDurableRun(
    root,
    runDefinition,
    {
      async execute(_phase, context) {
        starts.push(now);
        if (context.attempt === 1) {
          return {
            kind: 'retryable',
            reason: 'rate limited',
            retryAfterMs: 150,
          };
        }
        if (context.attempt < 4)
          return { kind: 'retryable', reason: 'not ready' };
        return { kind: 'applied', reason: 'eventually ready' };
      },
      async reconcile() {
        throw new Error('not expected');
      },
    },
    {
      clock: () => now,
      async wait(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
      },
    },
  );

  assert.equal(result.outcome, 'completed');
  assert.deepEqual(starts, [30_000, 30_150, 30_400, 30_650]);
  assert.deepEqual(waits, [150, 250, 250]);
});

test('minimum interval paces separate phases and survives elapsed-time limits', async () => {
  const root = await fixtureProject();
  let now = 40_000;
  const waits: number[] = [];
  const calls: string[] = [];
  const result = await runDurableRun(
    root,
    {
      runId: 'minimum-interval',
      phases: definition.phases,
      retryPolicy: {
        maxAttempts: 2,
        maxElapsedMs: 10_000,
        minimumIntervalMs: 500,
        initialBackoffMs: 0,
        backoffMultiplier: 2,
        maxBackoffMs: 0,
      },
    },
    appliedCallbacks(calls),
    {
      clock: () => now,
      async wait(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
      },
    },
  );
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(waits, [500]);

  const elapsedRoot = await fixtureProject();
  now = 50_000;
  const elapsed = await runDurableRun(
    elapsedRoot,
    pacedDefinition('elapsed-ceiling', {
      maxElapsedMs: 500,
      initialBackoffMs: 100,
      maxBackoffMs: 100,
    }),
    {
      async execute() {
        return {
          kind: 'retryable',
          reason: 'provider delay exceeds remaining budget',
          retryAfterMs: 500,
        };
      },
      async reconcile() {
        throw new Error('not expected');
      },
    },
    {
      clock: () => now,
      async wait() {
        throw new Error('must fail without waiting past the ceiling');
      },
    },
  );
  assert.equal(elapsed.outcome, 'failed');
  assert.match(elapsed.state.reason, /elapsed-time ceiling/);
});

test('reconciliation-confirmed retries consume budget and preserve identity', async () => {
  const root = await fixtureProject();
  const runDefinition = pacedDefinition('reconciled-budget', {
    maxAttempts: 2,
  });
  let interrupt = true;
  const attempts: number[] = [];
  const identities: string[] = [];
  await assert.rejects(
    runDurableRun(
      root,
      runDefinition,
      {
        async execute(_phase, context) {
          attempts.push(context.attempt);
          identities.push(context.effectId);
          throw new Error('uncertain transport result');
        },
        async reconcile() {
          throw new Error('not reached in first invocation');
        },
      },
      {
        async onCheckpoint(checkpoint, state) {
          if (
            interrupt &&
            checkpoint === 'after-state-published' &&
            state.phases[0]?.status === 'in-flight'
          ) {
            interrupt = false;
          }
        },
      },
    ),
    /reconciliation is required/,
  );

  const resumed = await runDurableRun(root, runDefinition, {
    async execute(_phase, context) {
      attempts.push(context.attempt);
      identities.push(context.effectId);
      return { kind: 'retryable', reason: 'confirmed retry also failed' };
    },
    async reconcile(_phase, context) {
      identities.push(context.effectId);
      return { kind: 'not-applied', reason: 'provider confirms absence' };
    },
  });
  assert.equal(resumed.outcome, 'failed');
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(new Set(identities).size, 1);
});

test('rejects malformed pacing policies, retry delays, clocks, and waits', async () => {
  const root = await fixtureProject();
  const callbacks = appliedCallbacks([]);
  for (const retryPolicy of [
    { ...defaultTestPolicy(), maxAttempts: 0 },
    { ...defaultTestPolicy(), maxElapsedMs: Number.POSITIVE_INFINITY },
    { ...defaultTestPolicy(), minimumIntervalMs: -1 },
    { ...defaultTestPolicy(), maxBackoffMs: 50, initialBackoffMs: 100 },
    { ...defaultTestPolicy(), extra: true },
    new Proxy(defaultTestPolicy(), {}),
  ]) {
    await assert.rejects(
      runDurableRun(
        root,
        {
          ...singlePhaseDefinition(`invalid-policy-${Math.random()}`),
          runId: 'invalid-policy',
          retryPolicy,
        } as Parameters<typeof runDurableRun>[1],
        callbacks,
      ),
      /retryPolicy|plain mapping/,
    );
  }

  await assert.rejects(
    runDurableRun(root, pacedDefinition('invalid-retry-delay'), {
      async execute() {
        return {
          kind: 'retryable',
          reason: 'bad retry delay',
          retryAfterMs: MAX_TEST_DELAY + 1,
        };
      },
      async reconcile() {
        throw new Error('not expected');
      },
    }),
    /invalid result.*reconciliation is required/,
  );
  await assert.rejects(
    runDurableRun(root, pacedDefinition('invalid-clock'), callbacks, {
      clock: () => Number.NaN,
    }),
    /invalid timestamp/,
  );

  const now = 60_000;
  await assert.rejects(
    runDurableRun(
      root,
      pacedDefinition('stalled-wait', {
        initialBackoffMs: 10,
        maxBackoffMs: 10,
      }),
      {
        async execute() {
          return { kind: 'retryable', reason: 'retry later' };
        },
        async reconcile() {
          throw new Error('not expected');
        },
      },
      { clock: () => now, async wait() {} },
    ),
    /without clock progress/,
  );
});

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-durable-'));
  temporaryDirectories.push(root);
  const initialized = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  await writeFile(path.join(root, '.gitignore'), '.autocode/\n.env\n');
  await mkdir(path.join(root, '.autocode', 'runs'), { recursive: true });
  return root;
}

function singlePhaseDefinition(runId: string, phaseId = 'effect') {
  return {
    runId,
    phases: [{ id: phaseId, description: 'Apply one external effect.' }],
  } as const;
}

const MAX_TEST_DELAY = 24 * 60 * 60 * 1000;

function defaultTestPolicy() {
  return {
    maxAttempts: 3,
    maxElapsedMs: MAX_TEST_DELAY,
    minimumIntervalMs: 0,
    initialBackoffMs: 0,
    backoffMultiplier: 2,
    maxBackoffMs: 0,
  };
}

function pacedDefinition(
  runId: string,
  overrides: Partial<ReturnType<typeof defaultTestPolicy>> = {},
) {
  return {
    ...singlePhaseDefinition(runId),
    retryPolicy: { ...defaultTestPolicy(), ...overrides },
  };
}

function appliedCallbacks(calls: string[]) {
  return {
    async execute(phase: { id: string }) {
      calls.push(phase.id);
      return { kind: 'applied', reason: `${phase.id} applied` };
    },
    async reconcile() {
      throw new Error('reconciliation not expected');
    },
  };
}

async function eventLines(
  runDirectory: string,
): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path.join(runDirectory, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForPath(target: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(path.join(target, 'owner.json'));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${target}`);
}

function interruptionProgram(moduleUrl: string): string {
  return `
import { writeFile } from 'node:fs/promises';
import { runDurableRun } from ${JSON.stringify(moduleUrl)};

async function main() {
const [projectDirectory, markerPath] = process.argv.slice(2);
if (projectDirectory === undefined || markerPath === undefined) {
  throw new Error('project directory and marker path are required');
}

await runDurableRun(
  projectDirectory,
  {
    runId: 'forced-interruption',
    phases: [{ id: 'publish', description: 'Apply one external effect.' }],
  },
  {
    async execute(_phase, context) {
      await writeFile(markerPath, context.effectId + '\\n', {
        encoding: 'utf8',
        flag: 'wx',
      });
      return { kind: 'applied', reason: 'effect marker published' };
    },
    async reconcile() {
      return { kind: 'ambiguous', reason: 'child must not reconcile' };
    },
  },
  {
    async onCheckpoint(checkpoint) {
      if (checkpoint === 'after-effect-applied') process.exit(86);
    },
  },
);
}

void main();
`;
}
