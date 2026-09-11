import { types as utilTypes } from 'node:util';

const MAX_GATES = 64;
const MAX_TEXT_BYTES = 4096;
const MIN_NOT_APPLICABLE_REASON_BYTES = 16;

export type GateSignalStatus = 'passed' | 'pending' | 'failed';
export type GateOutcome = 'passed' | 'blocked' | 'failed';

export interface GateRequirement {
  readonly id: string;
  readonly description: string;
}

export interface MergeGateSignal {
  readonly id: string;
  readonly status: GateSignalStatus;
  readonly reason: string;
  readonly headCommit: string;
}

export interface MergeGateInput {
  readonly headCommit: string;
  readonly requirements: readonly GateRequirement[];
  readonly signals: readonly MergeGateSignal[];
}

export interface ProductionGateSignal {
  readonly id: string;
  readonly status: GateSignalStatus;
  readonly reason: string;
  readonly deploymentId: string;
  readonly sourceCommit: string;
}

export type ProductionGateDecision =
  | {
      readonly kind: 'not-applicable';
      readonly reason: string;
    }
  | {
      readonly kind: 'required';
      readonly reason: string;
      readonly deploymentId: string;
      readonly sourceCommit: string;
      readonly requirements: readonly GateRequirement[];
      readonly signals: readonly ProductionGateSignal[];
    };

export interface CompletionGateInput {
  readonly merge: MergeGateInput;
  readonly production: ProductionGateDecision;
}

export interface GateEvaluation {
  readonly sequence: number;
  readonly id: string;
  readonly description: string;
  readonly outcome: GateOutcome;
  readonly reason: string;
  readonly signalStatus: GateSignalStatus | 'missing';
  readonly freshness: 'current' | 'stale' | 'missing';
  readonly observedSubject:
    | Readonly<{ readonly kind: 'merge'; readonly headCommit: string }>
    | Readonly<{
        readonly kind: 'production';
        readonly deploymentId: string;
        readonly sourceCommit: string;
      }>
    | null;
}

export interface MergeGateEvidence {
  readonly headCommit: string;
  readonly outcome: GateOutcome;
  readonly reason: string;
  readonly gates: readonly Readonly<GateEvaluation>[];
}

export type ProductionGateEvidence =
  | {
      readonly applicability: 'not-applicable';
      readonly outcome: 'not-applicable';
      readonly reason: string;
      readonly gates: readonly [];
    }
  | {
      readonly applicability: 'required';
      readonly deploymentId: string;
      readonly sourceCommit: string;
      readonly applicabilityReason: string;
      readonly outcome: GateOutcome;
      readonly reason: string;
      readonly gates: readonly Readonly<GateEvaluation>[];
    };

export interface CompletionGateEvidence {
  readonly version: 1;
  readonly outcome: GateOutcome;
  readonly reason: string;
  readonly merge: Readonly<MergeGateEvidence>;
  readonly production: Readonly<ProductionGateEvidence>;
}

interface NormalizedMergeInput {
  headCommit: string;
  requirements: Readonly<GateRequirement>[];
  signals: MergeGateSignal[];
}

type NormalizedProductionDecision =
  | {
      kind: 'not-applicable';
      reason: string;
    }
  | {
      kind: 'required';
      reason: string;
      deploymentId: string;
      sourceCommit: string;
      requirements: Readonly<GateRequirement>[];
      signals: ProductionGateSignal[];
    };

export function evaluateCompletionGates(
  input: unknown,
): Readonly<CompletionGateEvidence> {
  const record = mapping(input, 'completion gates');
  rejectUnknownKeys(
    record,
    new Set(['merge', 'production']),
    'completion gates',
  );
  const merge = validateMergeInput(record.merge);
  const production = validateProductionDecision(record.production);

  const mergeEvidence = evaluateMerge(merge);
  const productionEvidence = evaluateProduction(production);
  const outcome = combineOutcomes(
    mergeEvidence.outcome,
    productionEvidence.outcome === 'not-applicable'
      ? 'passed'
      : productionEvidence.outcome,
  );

  return freezeCompletionEvidence({
    version: 1,
    outcome,
    reason:
      outcome === 'passed'
        ? 'all configured completion gates passed'
        : outcome === 'failed'
          ? 'one or more configured completion gates failed'
          : 'one or more configured completion gates are not ready',
    merge: mergeEvidence,
    production: productionEvidence,
  });
}

function validateMergeInput(value: unknown): NormalizedMergeInput {
  const record = mapping(value, 'merge gates');
  rejectUnknownKeys(
    record,
    new Set(['headCommit', 'requirements', 'signals']),
    'merge gates',
  );
  const requirements = validateRequirements(
    record.requirements,
    'merge requirements',
  );
  const signals = validateSignals(
    record.signals,
    'merge signals',
    (candidate, index) => validateMergeSignal(candidate, index),
  );
  rejectUnexpectedSignals(requirements, signals, 'merge');
  return {
    headCommit: commitIdentity(record.headCommit, 'merge headCommit'),
    requirements,
    signals,
  };
}

function validateProductionDecision(
  value: unknown,
): NormalizedProductionDecision {
  const record = mapping(value, 'production decision');
  if (record.kind === 'not-applicable') {
    rejectUnknownKeys(
      record,
      new Set(['kind', 'reason']),
      'production decision',
    );
    const reason = boundedText(record.reason, 'production decision reason');
    if (Buffer.byteLength(reason, 'utf8') < MIN_NOT_APPLICABLE_REASON_BYTES) {
      throw new Error(
        `not-applicable production reason must be at least ${MIN_NOT_APPLICABLE_REASON_BYTES} bytes`,
      );
    }
    return { kind: 'not-applicable', reason };
  }
  if (record.kind !== 'required') {
    throw new Error(
      'production decision kind must be required or not-applicable',
    );
  }
  rejectUnknownKeys(
    record,
    new Set([
      'kind',
      'reason',
      'deploymentId',
      'sourceCommit',
      'requirements',
      'signals',
    ]),
    'production decision',
  );
  const requirements = validateRequirements(
    record.requirements,
    'production requirements',
  );
  const signals = validateSignals(
    record.signals,
    'production signals',
    (candidate, index) => validateProductionSignal(candidate, index),
  );
  rejectUnexpectedSignals(requirements, signals, 'production');
  return {
    kind: 'required',
    reason: boundedText(record.reason, 'production decision reason'),
    deploymentId: boundedText(record.deploymentId, 'production deploymentId'),
    sourceCommit: commitIdentity(
      record.sourceCommit,
      'production sourceCommit',
    ),
    requirements,
    signals,
  };
}

function validateRequirements(
  value: unknown,
  field: string,
): Readonly<GateRequirement>[] {
  const values = arrayDataValues(value, MAX_GATES);
  if (values === undefined || values.length === 0) {
    throw new Error(`${field} must contain between 1 and ${MAX_GATES} gates`);
  }
  const requirements = values.map((candidate, index) => {
    const itemField = `${field}[${index}]`;
    const record = mapping(candidate, itemField);
    rejectUnknownKeys(record, new Set(['id', 'description']), itemField);
    return Object.freeze({
      id: gateId(record.id, `${itemField}.id`),
      description: boundedText(record.description, `${itemField}.description`),
    });
  });
  rejectDuplicateIds(requirements, field);
  return requirements;
}

function validateSignals<T extends { readonly id: string }>(
  value: unknown,
  field: string,
  validate: (candidate: unknown, index: number) => T,
): T[] {
  const values = arrayDataValues(value, MAX_GATES);
  if (values === undefined) {
    throw new Error(`${field} must be an array of at most ${MAX_GATES}`);
  }
  const signals = values.map(validate);
  rejectDuplicateIds(signals, field);
  return signals;
}

function validateMergeSignal(value: unknown, index: number): MergeGateSignal {
  const field = `merge signals[${index}]`;
  const record = mapping(value, field);
  rejectUnknownKeys(
    record,
    new Set(['id', 'status', 'reason', 'headCommit']),
    field,
  );
  return {
    id: gateId(record.id, `${field}.id`),
    status: signalStatus(record.status, `${field}.status`),
    reason: boundedText(record.reason, `${field}.reason`),
    headCommit: commitIdentity(record.headCommit, `${field}.headCommit`),
  };
}

function validateProductionSignal(
  value: unknown,
  index: number,
): ProductionGateSignal {
  const field = `production signals[${index}]`;
  const record = mapping(value, field);
  rejectUnknownKeys(
    record,
    new Set(['id', 'status', 'reason', 'deploymentId', 'sourceCommit']),
    field,
  );
  return {
    id: gateId(record.id, `${field}.id`),
    status: signalStatus(record.status, `${field}.status`),
    reason: boundedText(record.reason, `${field}.reason`),
    deploymentId: boundedText(record.deploymentId, `${field}.deploymentId`),
    sourceCommit: commitIdentity(record.sourceCommit, `${field}.sourceCommit`),
  };
}

function rejectDuplicateIds(
  values: readonly { readonly id: string }[],
  field: string,
): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`${field} identifiers must be unique`);
  }
}

function rejectUnexpectedSignals(
  requirements: readonly GateRequirement[],
  signals: readonly { readonly id: string }[],
  phase: string,
): void {
  const configured = new Set(requirements.map((requirement) => requirement.id));
  if (signals.some((signal) => !configured.has(signal.id))) {
    throw new Error(`${phase} signals contain an unconfigured identifier`);
  }
}

function evaluateMerge(input: NormalizedMergeInput): MergeGateEvidence {
  const signals = new Map(input.signals.map((signal) => [signal.id, signal]));
  const gates = input.requirements.map((requirement, index) => {
    const signal = signals.get(requirement.id);
    return evaluateGate(
      requirement,
      index,
      signal,
      signal === undefined ? false : signal.headCommit === input.headCommit,
      signal === undefined
        ? null
        : { kind: 'merge', headCommit: signal.headCommit },
    );
  });
  const outcome = phaseOutcome(gates);
  return {
    headCommit: input.headCommit,
    outcome,
    reason: phaseReason('merge', outcome),
    gates,
  };
}

function evaluateProduction(
  decision: NormalizedProductionDecision,
): ProductionGateEvidence {
  if (decision.kind === 'not-applicable') {
    return {
      applicability: 'not-applicable',
      outcome: 'not-applicable',
      reason: decision.reason,
      gates: [],
    };
  }
  const signals = new Map(
    decision.signals.map((signal) => [signal.id, signal]),
  );
  const gates = decision.requirements.map((requirement, index) => {
    const signal = signals.get(requirement.id);
    return evaluateGate(
      requirement,
      index,
      signal,
      signal === undefined
        ? false
        : signal.deploymentId === decision.deploymentId &&
            signal.sourceCommit === decision.sourceCommit,
      signal === undefined
        ? null
        : {
            kind: 'production',
            deploymentId: signal.deploymentId,
            sourceCommit: signal.sourceCommit,
          },
    );
  });
  const outcome = phaseOutcome(gates);
  return {
    applicability: 'required',
    deploymentId: decision.deploymentId,
    sourceCommit: decision.sourceCommit,
    applicabilityReason: decision.reason,
    outcome,
    reason: phaseReason('production', outcome),
    gates,
  };
}

function evaluateGate(
  requirement: Readonly<GateRequirement>,
  index: number,
  signal: MergeGateSignal | ProductionGateSignal | undefined,
  current: boolean,
  observedSubject: GateEvaluation['observedSubject'],
): GateEvaluation {
  if (signal === undefined) {
    return {
      sequence: index + 1,
      ...requirement,
      outcome: 'blocked',
      reason: 'required gate signal is missing',
      signalStatus: 'missing',
      freshness: 'missing',
      observedSubject: null,
    };
  }
  if (!current) {
    return {
      sequence: index + 1,
      ...requirement,
      outcome: 'blocked',
      reason: 'gate signal is stale for the expected subject',
      signalStatus: signal.status,
      freshness: 'stale',
      observedSubject,
    };
  }
  return {
    sequence: index + 1,
    ...requirement,
    outcome:
      signal.status === 'failed'
        ? 'failed'
        : signal.status === 'pending'
          ? 'blocked'
          : 'passed',
    reason: signal.reason,
    signalStatus: signal.status,
    freshness: 'current',
    observedSubject,
  };
}

function phaseOutcome(gates: readonly GateEvaluation[]): GateOutcome {
  return gates.some((gate) => gate.outcome === 'failed')
    ? 'failed'
    : gates.some((gate) => gate.outcome === 'blocked')
      ? 'blocked'
      : 'passed';
}

function combineOutcomes(left: GateOutcome, right: GateOutcome): GateOutcome {
  return left === 'failed' || right === 'failed'
    ? 'failed'
    : left === 'blocked' || right === 'blocked'
      ? 'blocked'
      : 'passed';
}

function phaseReason(phase: string, outcome: GateOutcome): string {
  return outcome === 'passed'
    ? `all configured ${phase} gates passed`
    : outcome === 'failed'
      ? `one or more configured ${phase} gates failed`
      : `one or more configured ${phase} gates are not ready`;
}

function freezeCompletionEvidence(
  evidence: CompletionGateEvidence,
): Readonly<CompletionGateEvidence> {
  for (const gate of evidence.merge.gates) {
    if (gate.observedSubject !== null) Object.freeze(gate.observedSubject);
    Object.freeze(gate);
  }
  Object.freeze(evidence.merge.gates);
  Object.freeze(evidence.merge);
  for (const gate of evidence.production.gates) {
    if (gate.observedSubject !== null) Object.freeze(gate.observedSubject);
    Object.freeze(gate);
  }
  Object.freeze(evidence.production.gates);
  Object.freeze(evidence.production);
  return Object.freeze(evidence);
}

function mapping(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  try {
    if (Array.isArray(value)) throw new Error(`${field} must be a mapping`);
  } catch {
    throw new Error(`${field} must be a mapping`);
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new Error(`${field} must expose plain data properties`);
  }
  const record: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new Error(`${field} keys must be strings`);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new Error(`${field} must expose plain data properties`);
    }
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(`${field} must expose plain data properties`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function arrayDataValues(
  value: unknown,
  maximumLength: number,
): unknown[] | undefined {
  try {
    if (!Array.isArray(value) || utilTypes.isProxy(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      return undefined;
    }
    const length = lengthDescriptor.value as number;
    const allowedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(value).some(
        (key) => typeof key !== 'string' || !allowedKeys.has(key),
      )
    ) {
      return undefined;
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor)) {
        return undefined;
      }
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error(`unknown ${field} key`);
  }
}

function gateId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function signalStatus(value: unknown, field: string): GateSignalStatus {
  if (
    typeof value !== 'string' ||
    !['passed', 'pending', 'failed'].includes(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value as GateSignalStatus;
}

function commitIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40,64}$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (!isBoundedText(value)) {
    throw new Error(`${field} must be a non-empty bounded string`);
  }
  return value;
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}
