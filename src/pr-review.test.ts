import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPrReviewPhase } from './pr-review.js';

const findings = [
  {
    id: 'finding-1',
    severity: 'high',
    summary: 'A race can replace the validated file.',
    sourceReference: 'src/example.ts:42',
  },
  {
    id: 'finding-2',
    severity: 'medium',
    summary: 'The failure path lacks regression coverage.',
    sourceReference: 'src/example.test.ts:10',
  },
] as const;

test('passes an empty review without invoking an adapter', async () => {
  let calls = 0;
  const result = await runPrReviewPhase([], {
    async address() {
      calls += 1;
      return { kind: 'resolved', reason: 'not reached' };
    },
  });

  assert.equal(result.outcome, 'passed');
  assert.equal(result.totalFindings, 0);
  assert.equal(result.attemptedFindings, 0);
  assert.equal(calls, 0);
});

test('records ordered resolved and evidenced-dispute dispositions', async () => {
  const seen: string[] = [];
  const result = await runPrReviewPhase(findings, {
    async address(finding, context) {
      seen.push(`${context.sequence}/${context.total}:${finding.id}`);
      return finding.id === 'finding-1'
        ? {
            kind: 'resolved',
            reason: 'Guarded the final filesystem operation.',
            evidenceReferences: ['src/example.test.ts:25'],
          }
        : {
            kind: 'disputed',
            reason: 'The existing test already covers this path.',
            evidenceReferences: ['src/example.test.ts:50'],
          };
    },
  });

  assert.equal(result.outcome, 'passed');
  assert.equal(result.totalFindings, 2);
  assert.equal(result.attemptedFindings, 2);
  assert.deepEqual(seen, ['1/2:finding-1', '2/2:finding-2']);
  assert.deepEqual(
    result.findings.map(({ sequence, id, disposition }) => ({
      sequence,
      id,
      disposition,
    })),
    [
      { sequence: 1, id: 'finding-1', disposition: 'resolved' },
      { sequence: 2, id: 'finding-2', disposition: 'disputed' },
    ],
  );
});

test('keeps finding timing consistent when the wall clock moves backward', async () => {
  const originalNow = Date.now;
  const wallClockValues = [2_000, 1_000, 500, 250];
  Date.now = () => wallClockValues.shift() ?? 250;

  try {
    const result = await runPrReviewPhase(findings, {
      async address() {
        return { kind: 'resolved', reason: 'Regression covered.' };
      },
    });
    const first = result.findings[0]!;
    const second = result.findings[1]!;

    assert.equal(first.durationMs >= 0, true);
    assert.equal(
      new Date(first.completedAt).getTime() >=
        new Date(first.startedAt).getTime() + first.durationMs,
      true,
    );
    assert.equal(
      new Date(second.startedAt).getTime() >=
        new Date(first.completedAt).getTime(),
      true,
    );
  } finally {
    Date.now = originalNow;
  }
});

test('processes every finding and blocks when any is escalated', async () => {
  const result = await runPrReviewPhase(findings, {
    async address(finding) {
      return finding.id === 'finding-1'
        ? { kind: 'escalated', reason: 'Needs an owner risk decision.' }
        : { kind: 'resolved', reason: 'Added regression coverage.' };
    },
  });

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.attemptedFindings, 2);
  assert.deepEqual(
    result.findings.map((finding) => finding.disposition),
    ['escalated', 'resolved'],
  );
});

test('requires evidence for a disputed finding', async () => {
  const result = await runPrReviewPhase([findings[0]], {
    async address() {
      return { kind: 'disputed', reason: 'Unsupported disagreement.' };
    },
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.findings[0]?.disposition, 'invalid-result');
});

test('fails closed and stops after callback failures or invalid results', async () => {
  let calls = 0;
  const callbackFailure = await runPrReviewPhase(findings, {
    async address() {
      calls += 1;
      throw new Error('secret provider detail');
    },
  });
  assert.equal(callbackFailure.outcome, 'failed');
  assert.equal(callbackFailure.totalFindings, 2);
  assert.equal(callbackFailure.attemptedFindings, 1);
  assert.equal(callbackFailure.findings[0]?.disposition, 'callback-error');
  assert.equal(callbackFailure.reason.includes('secret'), false);
  assert.equal(calls, 1);

  calls = 0;
  const invalidResult = await runPrReviewPhase(findings, {
    async address() {
      calls += 1;
      return { kind: 'ignored', reason: 'silently skip it' };
    },
  });
  assert.equal(invalidResult.outcome, 'failed');
  assert.equal(invalidResult.findings[0]?.disposition, 'invalid-result');
  assert.equal(calls, 1);
});

test('rejects malformed, duplicate, and excessive findings', async () => {
  await assert.rejects(() => runPrReviewPhase({}), /array of at most 64/);
  await assert.rejects(
    () =>
      runPrReviewPhase([findings[0], findings[0]], {
        address: async () => ({}),
      }),
    /identifiers must be unique/,
  );
  await assert.rejects(
    () =>
      runPrReviewPhase(
        Array.from({ length: 65 }, (_, index) => ({
          ...findings[0],
          id: `finding-${index}`,
        })),
      ),
    /array of at most 64/,
  );
  await assert.rejects(
    () => runPrReviewPhase([{ ...findings[0], severity: 'informational' }]),
    /severity is invalid/,
  );
  await assert.rejects(
    () => runPrReviewPhase([{ ...findings[0], unexpected: true }]),
    /unknown PR-review findings\[0\] key/,
  );
});

test('does not copy untrusted property names into validation errors', async () => {
  const hostileKey = `\u001b[31m${'x'.repeat(8192)}`;
  const finding = { ...findings[0], [hostileKey]: true };

  await assert.rejects(() => runPrReviewPhase([finding]), {
    message: 'unknown PR-review findings[0] key',
  });
});

test('requires a callback only when findings exist', async () => {
  await assert.rejects(
    () => runPrReviewPhase(findings),
    /need an address callback/,
  );
  const invalidCallback = await runPrReviewPhase(findings, {} as never);
  assert.equal(invalidCallback.outcome, 'failed');
  assert.equal(invalidCallback.findings[0]?.disposition, 'callback-error');
});

test('callback lookup failures fail closed without leaking details', async () => {
  const callbacks = Object.defineProperty({}, 'address', {
    get() {
      throw new Error('secret callback accessor detail');
    },
  });

  const result = await runPrReviewPhase(findings, callbacks as never);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.attemptedFindings, 1);
  assert.equal(result.findings[0]?.disposition, 'callback-error');
  assert.equal(
    result.reason.includes('secret callback accessor detail'),
    false,
  );
});

test('bounds disposition reasons and evidence references', async () => {
  for (const candidate of [
    { kind: 'resolved', reason: 'x'.repeat(4097) },
    { kind: 'resolved', reason: 'ok', evidenceReferences: Array(17).fill('x') },
    { kind: 'resolved', reason: 'ok', evidenceReferences: ['bad\0reference'] },
    { kind: 'disputed', reason: 'ok', evidenceReferences: [] },
  ]) {
    const result = await runPrReviewPhase([findings[0]], {
      async address() {
        return candidate;
      },
    });
    assert.equal(result.findings[0]?.disposition, 'invalid-result');
  }
});

test('does not invoke accessors on untrusted findings or results', async () => {
  let findingReads = 0;
  const accessorFinding = Object.defineProperties(
    {},
    {
      id: { enumerable: true, value: 'finding-1' },
      severity: { enumerable: true, value: 'high' },
      summary: {
        enumerable: true,
        get: () => {
          findingReads += 1;
          return 'unsafe';
        },
      },
      sourceReference: { enumerable: true, value: 'src/example.ts:1' },
    },
  );
  await assert.rejects(
    () => runPrReviewPhase([accessorFinding]),
    /plain data properties/,
  );
  assert.equal(findingReads, 0);

  let resultReads = 0;
  const result = await runPrReviewPhase([findings[0]], {
    async address() {
      return Object.defineProperties(
        {},
        {
          kind: { enumerable: true, value: 'resolved' },
          reason: {
            enumerable: true,
            get: () => {
              resultReads += 1;
              return 'unsafe';
            },
          },
        },
      );
    },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(resultReads, 0);
});

test('classifies throwing result proxies as invalid and rejects finding proxies', async () => {
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('hostile trap detail');
      },
    },
  );
  await assert.rejects(
    () => runPrReviewPhase([hostile]),
    /plain data properties/,
  );

  const result = await runPrReviewPhase([findings[0]], {
    async address() {
      return hostile;
    },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.findings[0]?.disposition, 'invalid-result');
  assert.equal(result.reason.includes('hostile'), false);
});

test('snapshots inputs and returns deeply immutable evidence', async () => {
  const mutableFinding: {
    id: string;
    severity: string;
    summary: string;
    sourceReference: string;
  } = { ...findings[0] };
  const mutableReferences = ['src/example.test.ts:20'];
  let receivedFinding: object | undefined;
  let receivedContext: object | undefined;
  const result = await runPrReviewPhase([mutableFinding], {
    async address(finding, context) {
      receivedFinding = finding;
      receivedContext = context;
      mutableFinding.summary = 'mutated after validation';
      return {
        kind: 'resolved',
        reason: 'Regression covered.',
        evidenceReferences: mutableReferences,
      };
    },
  });
  mutableReferences.push('later-mutation');

  assert.equal(result.findings[0]?.summary, findings[0].summary);
  assert.deepEqual(result.findings[0]?.evidenceReferences, [
    'src/example.test.ts:20',
  ]);
  for (const value of [
    receivedFinding,
    receivedContext,
    result,
    result.findings,
    result.findings[0],
    result.findings[0]?.evidenceReferences,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('preserves the callback receiver for stateful adapters', async () => {
  const adapter = {
    calls: 0,
    async address() {
      this.calls += 1;
      return { kind: 'resolved', reason: 'State updated.' };
    },
  };
  const result = await runPrReviewPhase(findings, adapter);
  assert.equal(result.outcome, 'passed');
  assert.equal(adapter.calls, 2);
});
