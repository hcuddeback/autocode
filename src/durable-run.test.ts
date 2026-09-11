import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
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

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-durable-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, '.autocode', 'runs'), { recursive: true });
  return root;
}

function singlePhaseDefinition(runId: string, phaseId = 'effect') {
  return {
    runId,
    phases: [{ id: phaseId, description: 'Apply one external effect.' }],
  } as const;
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
