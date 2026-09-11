import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCompletionGates } from './completion-gates.js';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);

interface MutableGateRequirement {
  id: string;
  description: string;
}

interface MutableMergeSignal {
  id: string;
  status: 'passed' | 'pending' | 'failed';
  reason: string;
  headCommit: string;
}

interface MutableProductionSignal {
  id: string;
  status: 'passed' | 'pending' | 'failed';
  reason: string;
  deploymentId: string;
  sourceCommit: string;
}

type MutableInput = {
  merge: {
    headCommit: string;
    requirements: MutableGateRequirement[];
    signals: MutableMergeSignal[];
  };
  production:
    | { kind: 'not-applicable'; reason: string }
    | {
        kind: 'required';
        reason: string;
        deploymentId: string;
        sourceCommit: string;
        requirements: MutableGateRequirement[];
        signals: MutableProductionSignal[];
      };
};

function passingInput(): MutableInput {
  return {
    merge: {
      headCommit: HEAD,
      requirements: [
        { id: 'ci', description: 'Required CI checks' },
        { id: 'approval', description: 'Human merge authorization' },
      ],
      signals: [
        {
          id: 'approval',
          status: 'passed',
          reason: 'Owner approved the exact head',
          headCommit: HEAD,
        },
        {
          id: 'ci',
          status: 'passed',
          reason: 'All required checks passed',
          headCommit: HEAD,
        },
      ],
    },
    production: {
      kind: 'required',
      reason: 'This change is deployed to production',
      deploymentId: 'deployment-42',
      sourceCommit: HEAD,
      requirements: [
        { id: 'smoke', description: 'Production smoke checks' },
        { id: 'rollback', description: 'Rollback signal available' },
      ],
      signals: [
        {
          id: 'smoke',
          status: 'passed',
          reason: 'Smoke checks passed',
          deploymentId: 'deployment-42',
          sourceCommit: HEAD,
        },
        {
          id: 'rollback',
          status: 'passed',
          reason: 'Rollback target is recorded',
          deploymentId: 'deployment-42',
          sourceCommit: HEAD,
        },
      ],
    },
  };
}

test('passes complete current merge and production evidence in configured order', () => {
  const evidence = evaluateCompletionGates(passingInput());

  assert.equal(evidence.outcome, 'passed');
  assert.equal(evidence.merge.outcome, 'passed');
  assert.deepEqual(
    evidence.merge.gates.map((gate) => [gate.sequence, gate.id]),
    [
      [1, 'ci'],
      [2, 'approval'],
    ],
  );
  assert.equal(evidence.production.outcome, 'passed');
  assert.deepEqual(
    evidence.production.gates.map((gate) => gate.id),
    ['smoke', 'rollback'],
  );
});

test('accepts full SHA-256 commit identities', () => {
  const input = passingInput();
  const sha256Commit = 'c'.repeat(64);
  input.merge.headCommit = sha256Commit;
  for (const signal of input.merge.signals) signal.headCommit = sha256Commit;
  if (input.production.kind !== 'required') assert.fail('expected production');
  input.production.sourceCommit = sha256Commit;
  for (const signal of input.production.signals) {
    signal.sourceCommit = sha256Commit;
  }

  assert.equal(evaluateCompletionGates(input).outcome, 'passed');
});

test('passes after merge when production is explicitly not applicable', () => {
  const input = passingInput();
  input.production = {
    kind: 'not-applicable',
    reason: 'The package is not published or deployed',
  };

  const evidence = evaluateCompletionGates(input);

  assert.equal(evidence.outcome, 'passed');
  assert.deepEqual(evidence.production, {
    applicability: 'not-applicable',
    outcome: 'not-applicable',
    reason: 'The package is not published or deployed',
    gates: [],
  });
});

test('records every configured gate and blocks missing and pending signals', () => {
  const input = passingInput();
  input.merge.signals = [
    {
      id: 'ci',
      status: 'pending',
      reason: 'Checks are still running',
      headCommit: HEAD,
    },
  ];
  input.production = {
    kind: 'not-applicable',
    reason: 'The package is not published or deployed',
  };

  const evidence = evaluateCompletionGates(input);

  assert.equal(evidence.outcome, 'blocked');
  assert.deepEqual(
    evidence.merge.gates.map((gate) => ({
      id: gate.id,
      outcome: gate.outcome,
      signalStatus: gate.signalStatus,
      freshness: gate.freshness,
    })),
    [
      {
        id: 'ci',
        outcome: 'blocked',
        signalStatus: 'pending',
        freshness: 'current',
      },
      {
        id: 'approval',
        outcome: 'blocked',
        signalStatus: 'missing',
        freshness: 'missing',
      },
    ],
  );
});

test('blocks a passed merge signal bound to another head', () => {
  const input = passingInput();
  input.merge.signals[0] = {
    ...input.merge.signals[0]!,
    headCommit: OTHER_HEAD,
  };
  input.production = {
    kind: 'not-applicable',
    reason: 'The package is not published or deployed',
  };

  const evidence = evaluateCompletionGates(input);
  const stale = evidence.merge.gates.find((gate) => gate.id === 'approval');

  assert.equal(evidence.outcome, 'blocked');
  assert.equal(stale?.outcome, 'blocked');
  assert.equal(stale?.signalStatus, 'passed');
  assert.equal(stale?.freshness, 'stale');
  assert.deepEqual(stale?.observedSubject, {
    kind: 'merge',
    headCommit: OTHER_HEAD,
  });
});

test('blocks production signals for either a stale deployment or source commit', () => {
  const input = passingInput();
  if (input.production.kind !== 'required') assert.fail('expected production');
  input.production.signals[0] = {
    ...input.production.signals[0]!,
    deploymentId: 'deployment-previous',
  };
  input.production.signals[1] = {
    ...input.production.signals[1]!,
    sourceCommit: OTHER_HEAD,
  };

  const evidence = evaluateCompletionGates(input);

  assert.equal(evidence.outcome, 'blocked');
  assert.equal(evidence.production.outcome, 'blocked');
  assert.equal(
    evidence.production.applicability === 'required'
      ? evidence.production.applicabilityReason
      : undefined,
    'This change is deployed to production',
  );
  assert.deepEqual(
    evidence.production.gates.map((gate) => gate.freshness),
    ['stale', 'stale'],
  );
});

test('failed current signals outrank blocked signals across phases', () => {
  const input = passingInput();
  input.merge.signals = [
    {
      id: 'ci',
      status: 'failed',
      reason: 'Required test failed',
      headCommit: HEAD,
    },
  ];
  if (input.production.kind !== 'required') assert.fail('expected production');
  input.production.signals[0] = {
    ...input.production.signals[0]!,
    status: 'pending',
    reason: 'Smoke checks are pending',
  };

  const evidence = evaluateCompletionGates(input);

  assert.equal(evidence.merge.outcome, 'failed');
  assert.equal(evidence.production.outcome, 'blocked');
  assert.equal(evidence.outcome, 'failed');
});

test('snapshots caller input and deeply freezes returned evidence', () => {
  const input = passingInput();
  const evidence = evaluateCompletionGates(input);

  input.merge.requirements[0]!.description = 'mutated';
  input.merge.signals[0]!.reason = 'mutated';
  if (input.production.kind !== 'required') assert.fail('expected production');
  input.production.deploymentId = 'mutated';

  assert.equal(evidence.merge.gates[0]?.description, 'Required CI checks');
  assert.equal(
    evidence.merge.gates.find((gate) => gate.id === 'approval')?.reason,
    'Owner approved the exact head',
  );
  assert.equal(
    evidence.production.applicability === 'required'
      ? evidence.production.deploymentId
      : undefined,
    'deployment-42',
  );
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.merge));
  assert.ok(Object.isFrozen(evidence.merge.gates));
  assert.ok(evidence.merge.gates.every(Object.isFrozen));
  assert.ok(
    evidence.merge.gates.every(
      (gate) =>
        gate.observedSubject === null || Object.isFrozen(gate.observedSubject),
    ),
  );
  assert.ok(Object.isFrozen(evidence.production));
  assert.ok(Object.isFrozen(evidence.production.gates));
  assert.ok(evidence.production.gates.every(Object.isFrozen));
  assert.ok(
    evidence.production.gates.every(
      (gate) =>
        gate.observedSubject === null || Object.isFrozen(gate.observedSubject),
    ),
  );
});

test('rejects empty or excessive gate configuration and excessive signals', () => {
  const empty = passingInput();
  empty.merge.requirements = [];
  assert.throws(
    () => evaluateCompletionGates(empty),
    /merge requirements must contain between 1 and 64 gates/,
  );

  const excessiveRequirements = passingInput();
  excessiveRequirements.merge.requirements = Array.from(
    { length: 65 },
    (_, index) => ({ id: `gate-${index}`, description: `Gate ${index}` }),
  );
  assert.throws(
    () => evaluateCompletionGates(excessiveRequirements),
    /merge requirements must contain between 1 and 64 gates/,
  );

  const excessiveSignals = passingInput();
  excessiveSignals.merge.signals = Array.from({ length: 65 }, (_, index) => ({
    id: `gate-${index}`,
    status: 'passed' as const,
    reason: `Gate ${index} passed`,
    headCommit: HEAD,
  }));
  assert.throws(
    () => evaluateCompletionGates(excessiveSignals),
    /merge signals must be an array of at most 64/,
  );
});

test('rejects duplicate requirements, duplicate signals, and unconfigured signals', () => {
  const duplicateRequirements = passingInput();
  duplicateRequirements.merge.requirements[1] = {
    id: 'ci',
    description: 'Duplicate CI',
  };
  assert.throws(
    () => evaluateCompletionGates(duplicateRequirements),
    /merge requirements identifiers must be unique/,
  );

  const duplicateSignals = passingInput();
  duplicateSignals.merge.signals[1] = {
    ...duplicateSignals.merge.signals[0]!,
  };
  assert.throws(
    () => evaluateCompletionGates(duplicateSignals),
    /merge signals identifiers must be unique/,
  );

  const unexpected = passingInput();
  unexpected.merge.signals[0] = {
    ...unexpected.merge.signals[0]!,
    id: 'not-configured',
  };
  assert.throws(
    () => evaluateCompletionGates(unexpected),
    /merge signals contain an unconfigured identifier/,
  );
});

test('requires substantive production applicability and forbids extra evidence', () => {
  const shortReason = passingInput();
  shortReason.production = { kind: 'not-applicable', reason: 'too short' };
  assert.throws(
    () => evaluateCompletionGates(shortReason),
    /not-applicable production reason must be at least 16 bytes/,
  );

  const extra = passingInput();
  extra.production = {
    kind: 'not-applicable',
    reason: 'The package is not published',
    signals: [],
  } as never;
  assert.throws(
    () => evaluateCompletionGates(extra),
    /unknown production decision key/,
  );
});

test('rejects malformed identities, statuses, text, and unknown properties', () => {
  const cases: MutableInput[] = [];

  const badCommit = passingInput();
  badCommit.merge.headCommit = 'HEAD';
  cases.push(badCommit);

  const intermediateSha1Length = passingInput();
  intermediateSha1Length.merge.headCommit = 'a'.repeat(41);
  cases.push(intermediateSha1Length);

  const intermediateSha256Length = passingInput();
  if (intermediateSha256Length.production.kind !== 'required') {
    assert.fail('expected production');
  }
  intermediateSha256Length.production.signals[0]!.sourceCommit = 'a'.repeat(63);
  cases.push(intermediateSha256Length);

  const badStatus = passingInput();
  badStatus.merge.signals[0]!.status = 'success' as never;
  cases.push(badStatus);

  const badText = passingInput();
  badText.merge.requirements[0]!.description = 'line\nbreak';
  cases.push(badText);

  const unknown = passingInput();
  unknown.merge.signals[0] = {
    ...unknown.merge.signals[0]!,
    secret: 'not allowed',
  } as never;
  cases.push(unknown);

  for (const input of cases) {
    assert.throws(() => evaluateCompletionGates(input));
  }
});

test('rejects accessor-backed and proxy-backed untrusted data without invoking getters', () => {
  let getterInvoked = false;
  const accessorSignal = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(accessorSignal, {
    id: { value: 'ci', enumerable: true },
    status: {
      enumerable: true,
      get() {
        getterInvoked = true;
        return 'passed';
      },
    },
    reason: { value: 'All checks passed', enumerable: true },
    headCommit: { value: HEAD, enumerable: true },
  });
  const accessorInput = passingInput();
  accessorInput.merge.signals = [accessorSignal as never];

  assert.throws(
    () => evaluateCompletionGates(accessorInput),
    /must expose plain data properties/,
  );
  assert.equal(getterInvoked, false);

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.throws(() => evaluateCompletionGates(proxy), /must be a mapping/);

  assert.throws(
    () => evaluateCompletionGates(new Proxy(passingInput(), {})),
    /must be a mapping/,
  );

  const transparentObject = passingInput();
  transparentObject.merge.requirements[0] = new Proxy(
    transparentObject.merge.requirements[0]!,
    {},
  );
  assert.throws(
    () => evaluateCompletionGates(transparentObject),
    /merge requirements\[0\] must be a mapping/,
  );

  const transparentArray = passingInput();
  transparentArray.merge.signals = new Proxy(
    transparentArray.merge.signals,
    {},
  );
  assert.throws(
    () => evaluateCompletionGates(transparentArray),
    /merge signals must be an array of at most 64/,
  );

  const hostileArray = new Proxy([], {
    ownKeys() {
      throw new Error('do not leak this trap detail');
    },
  });
  const proxyInput = passingInput();
  proxyInput.merge.signals = hostileArray;
  assert.throws(
    () => evaluateCompletionGates(proxyInput),
    /merge signals must be an array of at most 64/,
  );
});

test('rejects required production without configured gates', () => {
  const input = passingInput();
  if (input.production.kind !== 'required') assert.fail('expected production');
  input.production.requirements = [];

  assert.throws(
    () => evaluateCompletionGates(input),
    /production requirements must contain between 1 and 64 gates/,
  );
});
