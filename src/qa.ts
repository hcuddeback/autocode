const MAX_SCENARIOS = 32;
const MAX_TEXT_BYTES = 4096;
const MAX_ARTIFACT_REFERENCES = 16;
const MIN_NOT_APPLICABLE_REASON_BYTES = 16;

export interface QaScenario {
  readonly name: string;
  readonly description: string;
}

export type QaDecision =
  | {
      readonly kind: 'not-applicable';
      readonly reason: string;
    }
  | {
      readonly kind: 'required';
      readonly reason: string;
      readonly scenarios: readonly QaScenario[];
    };

export type QaScenarioResult = {
  readonly kind: 'passed' | 'failed' | 'blocked';
  readonly reason: string;
  readonly artifactReferences?: readonly string[];
};

export interface QaScenarioContext {
  readonly sequence: number;
}

export interface QaCallbacks {
  run(
    scenario: Readonly<QaScenario>,
    context: Readonly<QaScenarioContext>,
  ): Promise<unknown>;
}

export interface QaScenarioEvidence {
  readonly sequence: number;
  readonly name: string;
  readonly description: string;
  readonly outcome:
    QaScenarioResult['kind'] | 'callback-error' | 'invalid-result';
  readonly reason: string;
  readonly artifactReferences: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface QaEvidence {
  readonly version: 1;
  readonly applicability: QaDecision['kind'];
  readonly outcome: 'not-applicable' | 'passed' | 'failed' | 'blocked';
  readonly reason: string;
  readonly scenarios: readonly Readonly<QaScenarioEvidence>[];
}

export async function runQaPhase(
  decision: unknown,
  callbacks?: QaCallbacks,
): Promise<Readonly<QaEvidence>> {
  const validated = validateDecision(decision);
  if (validated.kind === 'not-applicable') {
    if (callbacks !== undefined) {
      throw new Error('QA callbacks are not allowed when QA is not applicable');
    }
    return freezeEvidence({
      version: 1,
      applicability: 'not-applicable',
      outcome: 'not-applicable',
      reason: validated.reason,
      scenarios: [],
    });
  }
  if (
    callbacks === undefined ||
    typeof callbacks !== 'object' ||
    callbacks === null
  ) {
    throw new Error('required QA needs a scenario callback');
  }
  let runScenario: QaCallbacks['run'] | undefined;

  const evidence: QaScenarioEvidence[] = [];
  for (const scenario of validated.scenarios) {
    const sequence = evidence.length + 1;
    const started = Date.now();
    let candidate: unknown;
    try {
      if (runScenario === undefined) {
        runScenario = callbacks.run;
        if (typeof runScenario !== 'function') {
          throw new TypeError('scenario callback is not callable');
        }
      }
      candidate = await runScenario.call(
        callbacks,
        scenario,
        Object.freeze({ sequence }),
      );
    } catch {
      const reason = 'scenario adapter callback failed';
      appendEvidence(
        evidence,
        scenario,
        sequence,
        started,
        { kind: 'failed', reason },
        'callback-error',
      );
      return finish('failed', reason, evidence);
    }

    let normalized: QaScenarioResult | undefined;
    try {
      normalized = normalizeScenarioResult(candidate);
    } catch {
      // Scenario results are untrusted and may be proxies with throwing traps.
    }
    if (normalized === undefined) {
      const reason = 'scenario adapter returned an invalid result';
      appendEvidence(
        evidence,
        scenario,
        sequence,
        started,
        { kind: 'failed', reason },
        'invalid-result',
      );
      return finish('failed', reason, evidence);
    }

    appendEvidence(
      evidence,
      scenario,
      sequence,
      started,
      normalized,
      normalized.kind,
    );
    if (normalized.kind !== 'passed') {
      return finish(normalized.kind, normalized.reason, evidence);
    }
  }

  return finish('passed', validated.reason, evidence);
}

function validateDecision(value: unknown): QaDecision {
  const record = mapping(value, 'QA decision');
  if (record.kind === 'not-applicable') {
    rejectUnknownKeys(record, new Set(['kind', 'reason']), 'QA decision');
    const reason = boundedText(record.reason, 'QA decision reason');
    if (Buffer.byteLength(reason, 'utf8') < MIN_NOT_APPLICABLE_REASON_BYTES) {
      throw new Error(
        `not-applicable QA reason must be at least ${MIN_NOT_APPLICABLE_REASON_BYTES} bytes`,
      );
    }
    return Object.freeze({
      kind: 'not-applicable',
      reason,
    });
  }
  if (record.kind !== 'required') {
    throw new Error('QA decision kind must be required or not-applicable');
  }
  rejectUnknownKeys(
    record,
    new Set(['kind', 'reason', 'scenarios']),
    'QA decision',
  );
  const scenarioValues = arrayDataValues(
    record.scenarios,
    'required QA scenarios',
  );
  if (scenarioValues.length === 0 || scenarioValues.length > MAX_SCENARIOS) {
    throw new Error(
      `required QA must define between 1 and ${MAX_SCENARIOS} scenarios`,
    );
  }
  const scenarios: Readonly<QaScenario>[] = [];
  for (let index = 0; index < scenarioValues.length; index += 1) {
    scenarios.push(validateScenario(scenarioValues[index], index));
  }
  if (
    new Set(scenarios.map((scenario) => scenario.name)).size !==
    scenarios.length
  ) {
    throw new Error('QA scenario names must be unique');
  }
  return Object.freeze({
    kind: 'required',
    reason: boundedText(record.reason, 'QA decision reason'),
    scenarios: Object.freeze(scenarios),
  });
}

function validateScenario(value: unknown, index: number): Readonly<QaScenario> {
  const field = `QA scenarios[${index}]`;
  const record = mapping(value, field);
  rejectUnknownKeys(record, new Set(['name', 'description']), field);
  if (
    typeof record.name !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(record.name)
  ) {
    throw new Error(`${field}.name is invalid`);
  }
  return Object.freeze({
    name: record.name,
    description: boundedText(record.description, `${field}.description`),
  });
}

function normalizeScenarioResult(value: unknown): QaScenarioResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      !['kind', 'reason', 'artifactReferences'].includes(key)
    ) {
      return undefined;
    }
  }
  const kind = ownDataValue(record, 'kind');
  const reason = ownDataValue(record, 'reason');
  const hasReferences = keys.includes('artifactReferences');
  const references = ownDataValue(record, 'artifactReferences');
  if (
    typeof kind !== 'string' ||
    !['passed', 'failed', 'blocked'].includes(kind) ||
    !isBoundedText(reason)
  ) {
    return undefined;
  }
  const normalizedReferences = normalizeReferences(references);
  if (hasReferences && normalizedReferences === undefined) {
    return undefined;
  }
  const result: QaScenarioResult = {
    kind: kind as QaScenarioResult['kind'],
    reason,
  };
  return !hasReferences
    ? result
    : { ...result, artifactReferences: normalizedReferences! };
}

function normalizeReferences(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ARTIFACT_REFERENCES) {
    return undefined;
  }
  const references: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const reference = ownDataValue(value, String(index));
    if (!isBoundedText(reference)) return undefined;
    references.push(reference);
  }
  return references;
}

function ownDataValue(record: object, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  return descriptor !== undefined && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

function appendEvidence(
  evidence: QaScenarioEvidence[],
  scenario: Readonly<QaScenario>,
  sequence: number,
  started: number,
  result: QaScenarioResult,
  outcome: QaScenarioEvidence['outcome'],
): void {
  const completed = Date.now();
  evidence.push({
    sequence,
    name: scenario.name,
    description: scenario.description,
    outcome,
    reason: result.reason,
    artifactReferences: [...(result.artifactReferences ?? [])],
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: Math.max(0, completed - started),
  });
}

function finish(
  outcome: 'passed' | 'failed' | 'blocked',
  reason: string,
  scenarios: QaScenarioEvidence[],
): Readonly<QaEvidence> {
  return freezeEvidence({
    version: 1,
    applicability: 'required',
    outcome,
    reason,
    scenarios,
  });
}

function freezeEvidence(value: QaEvidence): Readonly<QaEvidence> {
  for (const scenario of value.scenarios) {
    Object.freeze(scenario.artifactReferences);
    Object.freeze(scenario);
  }
  Object.freeze(value.scenarios);
  return Object.freeze(value);
}

function mapping(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
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

function arrayDataValues(value: unknown, field: string): unknown[] {
  let length: number;
  try {
    if (!Array.isArray(value)) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      throw new Error();
    }
    length = lengthDescriptor.value as number;
  } catch {
    throw new Error(`${field} must be an array of plain data values`);
  }
  if (length > MAX_SCENARIOS) {
    throw new Error(
      `required QA must define between 1 and ${MAX_SCENARIOS} scenarios`,
    );
  }
  try {
    const allowedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(value).some(
        (key) => typeof key !== 'string' || !allowedKeys.has(key),
      )
    ) {
      throw new Error();
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor))
        throw new Error();
      values.push(descriptor.value);
    }
    return values;
  } catch {
    throw new Error(`${field} must be an array of plain data values`);
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`unknown ${field} key: ${unexpected}`);
  }
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
    value.trim() === value &&
    value.length > 0 &&
    !hasControlCharacter(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES
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
