import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runQaPhase, type QaDecision } from './qa.js';

const requiredDecision: QaDecision = {
  kind: 'required',
  reason: 'The change has observable runtime behavior.',
  scenarios: [
    { name: 'happy_path', description: 'Complete the primary journey.' },
    { name: 'recovery', description: 'Recover from an expected failure.' },
  ],
};

test('records a justified not-applicable decision without a callback', async () => {
  const result = await runQaPhase({
    kind: 'not-applicable',
    reason: 'This is an internal type-only change.',
  });

  assert.deepEqual(result, {
    version: 1,
    applicability: 'not-applicable',
    outcome: 'not-applicable',
    reason: 'This is an internal type-only change.',
    scenarios: [],
  });
});

test('runs required scenarios in order and records structured evidence', async () => {
  const invoked: string[] = [];
  const result = await runQaPhase(requiredDecision, {
    async run(scenario, context) {
      invoked.push(`${context.sequence}:${scenario.name}`);
      return {
        kind: 'passed',
        reason: `${scenario.name} passed`,
        artifactReferences: [`evidence/${scenario.name}.txt`],
      };
    },
  });

  assert.equal(result.outcome, 'passed');
  assert.equal(result.reason, requiredDecision.reason);
  assert.deepEqual(invoked, ['1:happy_path', '2:recovery']);
  assert.deepEqual(
    result.scenarios.map(({ sequence, name, outcome, reason }) => ({
      sequence,
      name,
      outcome,
      reason,
    })),
    [
      {
        sequence: 1,
        name: 'happy_path',
        outcome: 'passed',
        reason: 'happy_path passed',
      },
      {
        sequence: 2,
        name: 'recovery',
        outcome: 'passed',
        reason: 'recovery passed',
      },
    ],
  );
  assert.equal(result.scenarios[0]!.durationMs >= 0, true);
  assert.doesNotThrow(() => new Date(result.scenarios[0]!.startedAt));
});

test('keeps scenario timing consistent when the wall clock moves backward', async () => {
  const originalNow = Date.now;
  const wallClockValues = [2_000, 1_000];
  Date.now = () => wallClockValues.shift() ?? 1_000;

  try {
    const result = await runQaPhase(
      {
        kind: 'required',
        reason: 'Runtime behavior requires QA.',
        scenarios: [{ name: 'clock', description: 'Observe clock handling.' }],
      },
      {
        async run() {
          return { kind: 'passed', reason: 'passed' };
        },
      },
    );
    const scenario = result.scenarios[0]!;

    assert.equal(scenario.durationMs >= 0, true);
    assert.equal(
      new Date(scenario.completedAt).getTime() >=
        new Date(scenario.startedAt).getTime() + scenario.durationMs,
      true,
    );
  } finally {
    Date.now = originalNow;
  }
});

test('stops after a failed or blocked scenario', async () => {
  for (const terminal of ['failed', 'blocked'] as const) {
    let calls = 0;
    const result = await runQaPhase(requiredDecision, {
      async run() {
        calls += 1;
        return { kind: terminal, reason: `${terminal} by QA` };
      },
    });
    assert.equal(result.outcome, terminal);
    assert.equal(result.reason, `${terminal} by QA`);
    assert.equal(result.scenarios.length, 1);
    assert.equal(calls, 1);
  }
});

test('callback failures fail closed without leaking exception details', async () => {
  const result = await runQaPhase(requiredDecision, {
    async run() {
      throw new Error('secret provider response');
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.scenarios[0]!.outcome, 'callback-error');
  assert.equal(result.reason, 'scenario adapter callback failed');
  assert.doesNotMatch(JSON.stringify(result), /secret provider response/);
});

test('callback lookup failures fail closed without leaking exception details', async () => {
  const callbacks = Object.defineProperty({}, 'run', {
    get() {
      throw new Error('secret callback accessor detail');
    },
  });
  const result = await runQaPhase(requiredDecision, callbacks as never);

  assert.equal(result.outcome, 'failed');
  assert.equal(result.scenarios[0]!.outcome, 'callback-error');
  assert.equal(result.reason, 'scenario adapter callback failed');
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret callback accessor detail/,
  );
});

test('malformed callback results fail closed and stop later scenarios', async () => {
  let calls = 0;
  const result = await runQaPhase(requiredDecision, {
    async run() {
      calls += 1;
      return { kind: 'passed', reason: '', injected: true };
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  assert.equal(result.reason, 'scenario adapter returned an invalid result');
  assert.equal(calls, 1);
});

test('does not invoke accessors on untrusted callback results', async () => {
  let reasonReads = 0;
  const result = await runQaPhase(requiredDecision, {
    async run() {
      return Object.defineProperties(
        {},
        {
          kind: { enumerable: true, value: 'passed' },
          reason: {
            enumerable: true,
            get: () => {
              reasonReads += 1;
              return 'unsafe getter';
            },
          },
        },
      );
    },
  });

  assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  assert.equal(reasonReads, 0);
});

test('rejects accessor-backed artifact references without invoking them', async () => {
  let referenceReads = 0;
  const result = await runQaPhase(requiredDecision, {
    async run() {
      return Object.defineProperties(
        {},
        {
          kind: { enumerable: true, value: 'passed' },
          reason: { enumerable: true, value: 'passed' },
          artifactReferences: {
            enumerable: true,
            get: () => {
              referenceReads += 1;
              return ['unsafe-reference'];
            },
          },
        },
      );
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  assert.equal(referenceReads, 0);
});

test('classifies throwing result proxies as invalid results', async () => {
  const result = await runQaPhase(requiredDecision, {
    async run() {
      return new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('untrusted trap detail');
          },
        },
      );
    },
  });

  assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  assert.doesNotMatch(JSON.stringify(result), /untrusted trap detail/);
});

test('rejects ambiguous or malformed applicability decisions', async () => {
  const invalid = [
    null,
    { kind: 'auto', reason: 'infer it' },
    { kind: 'not-applicable', reason: '' },
    { kind: 'not-applicable', reason: 'too short' },
    { kind: 'not-applicable', reason: 'no', scenarios: [] },
    { kind: 'required', reason: 'yes', scenarios: [] },
    { kind: 'required', reason: 'yes', scenarios: 'one' },
    {
      kind: 'required',
      reason: 'yes',
      scenarios: [{ name: 'bad name', description: 'x' }],
    },
  ];
  for (const decision of invalid) {
    await assert.rejects(() => runQaPhase(decision));
  }
});

test('rejects inherited or accessor-backed applicability decisions', async () => {
  const inherited = Object.create({
    kind: 'not-applicable',
    reason: 'Inherited skip rationale.',
  });
  let reasonReads = 0;
  const accessorBacked = Object.defineProperty(
    { kind: 'not-applicable' },
    'reason',
    {
      enumerable: true,
      get() {
        reasonReads += 1;
        return 'Accessor skip rationale.';
      },
    },
  );

  await assert.rejects(() => runQaPhase(inherited), /kind/);
  await assert.rejects(() => runQaPhase(accessorBacked), /plain data/);
  assert.equal(reasonReads, 0);
});

test('rejects inherited or accessor-backed scenario definitions', async () => {
  const inheritedScenario = Object.create({
    name: 'inherited',
    description: 'Inherited scenario definition.',
  });
  let descriptionReads = 0;
  const accessorScenario = Object.defineProperty(
    { name: 'accessor' },
    'description',
    {
      enumerable: true,
      get() {
        descriptionReads += 1;
        return 'Accessor scenario definition.';
      },
    },
  );

  for (const scenario of [inheritedScenario, accessorScenario]) {
    await assert.rejects(() =>
      runQaPhase({
        kind: 'required',
        reason: 'Runtime behavior requires QA.',
        scenarios: [scenario],
      }),
    );
  }
  assert.equal(descriptionReads, 0);
});

test('rejects duplicate or excessive scenario names', async () => {
  await assert.rejects(
    () =>
      runQaPhase({
        kind: 'required',
        reason: 'required',
        scenarios: [
          { name: 'same', description: 'one' },
          { name: 'same', description: 'two' },
        ],
      }),
    /unique/,
  );
  await assert.rejects(
    () =>
      runQaPhase({
        kind: 'required',
        reason: 'required',
        scenarios: Array.from({ length: 33 }, (_, index) => ({
          name: `scenario_${index}`,
          description: 'bounded',
        })),
      }),
    /between 1 and 32/,
  );
});

test('rejects missing callbacks and callbacks for not-applicable QA', async () => {
  await assert.rejects(
    () => runQaPhase(requiredDecision),
    /needs a scenario callback/,
  );
  await assert.rejects(
    () =>
      runQaPhase(
        { kind: 'not-applicable', reason: 'No runtime behavior.' },
        {
          async run() {
            return { kind: 'passed', reason: 'unexpected' };
          },
        },
      ),
    /callbacks are not allowed/,
  );
});

test('bounds result reasons and artifact references', async () => {
  for (const candidate of [
    { kind: 'passed', reason: 'x'.repeat(4097) },
    { kind: 'passed', reason: 'ok', artifactReferences: Array(17).fill('x') },
    { kind: 'passed', reason: 'ok', artifactReferences: ['bad\0reference'] },
  ]) {
    const result = await runQaPhase(requiredDecision, {
      async run() {
        return candidate;
      },
    });
    assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  }
});

test('validates artifact references against a stable own-data array length', async () => {
  let lengthReads = 0;
  const references = new Proxy(Array(17).fill('proof.txt'), {
    get(target, property, receiver) {
      if (property === 'length') {
        lengthReads += 1;
        return lengthReads === 1 ? 1 : 17;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const result = await runQaPhase(requiredDecision, {
    async run() {
      return {
        kind: 'passed',
        reason: 'passed',
        artifactReferences: references,
      };
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.scenarios[0]!.outcome, 'invalid-result');
  assert.equal(lengthReads, 0);
});

test('returns deeply immutable decisions, scenarios, and evidence', async () => {
  let receivedScenario:
    Readonly<{ name: string; description: string }> | undefined;
  const result = await runQaPhase(requiredDecision, {
    async run(scenario) {
      receivedScenario = scenario;
      return {
        kind: 'passed',
        reason: 'passed',
        artifactReferences: ['proof.txt'],
      };
    },
  });

  assert.equal(Object.isFrozen(receivedScenario), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scenarios), true);
  assert.equal(Object.isFrozen(result.scenarios[0]), true);
  assert.equal(Object.isFrozen(result.scenarios[0]!.artifactReferences), true);
  assert.throws(() => {
    (result.scenarios[0]!.artifactReferences as string[]).push('mutated');
  }, TypeError);
});

test('preserves the callback receiver for stateful QA adapters', async () => {
  const adapter = {
    calls: 0,
    async run() {
      this.calls += 1;
      return { kind: 'passed', reason: 'state updated' };
    },
  };
  const result = await runQaPhase(requiredDecision, adapter);
  assert.equal(result.outcome, 'passed');
  assert.equal(adapter.calls, 2);
});
