const MAX_FINDINGS = 64;
const MAX_TEXT_BYTES = 4096;
const MAX_EVIDENCE_REFERENCES = 16;

export type PrReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PrReviewFinding {
  readonly id: string;
  readonly severity: PrReviewSeverity;
  readonly summary: string;
  readonly sourceReference: string;
}

export type PrReviewDisposition =
  | {
      readonly kind: 'resolved';
      readonly reason: string;
      readonly evidenceReferences?: readonly string[];
    }
  | {
      readonly kind: 'disputed';
      readonly reason: string;
      readonly evidenceReferences: readonly string[];
    }
  | {
      readonly kind: 'escalated';
      readonly reason: string;
      readonly evidenceReferences?: readonly string[];
    };

export interface PrReviewFindingContext {
  readonly sequence: number;
  readonly total: number;
}

export interface PrReviewCallbacks {
  address(
    finding: Readonly<PrReviewFinding>,
    context: Readonly<PrReviewFindingContext>,
  ): Promise<unknown>;
}

export interface PrReviewFindingEvidence extends PrReviewFinding {
  readonly sequence: number;
  readonly disposition:
    PrReviewDisposition['kind'] | 'callback-error' | 'invalid-result';
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface PrReviewEvidence {
  readonly version: 1;
  readonly outcome: 'passed' | 'blocked' | 'failed';
  readonly reason: string;
  readonly totalFindings: number;
  readonly attemptedFindings: number;
  readonly findings: readonly Readonly<PrReviewFindingEvidence>[];
}

interface FindingStartTime {
  readonly wallClockMs: number;
  readonly monotonicNs: bigint;
}

export async function runPrReviewPhase(
  findings: unknown,
  callbacks?: PrReviewCallbacks,
): Promise<Readonly<PrReviewEvidence>> {
  const validated = validateFindings(findings);
  if (validated.length === 0) {
    return finish('passed', 'Codex PR review reported no findings', 0, []);
  }
  if (
    callbacks === undefined ||
    typeof callbacks !== 'object' ||
    callbacks === null
  ) {
    throw new Error('PR-review findings need an address callback');
  }

  const evidence: PrReviewFindingEvidence[] = [];
  let addressFinding: PrReviewCallbacks['address'] | undefined;
  let escalated = false;
  let earliestStartMs: number | undefined;
  for (const finding of validated) {
    const sequence = evidence.length + 1;
    const started = startFindingTiming(earliestStartMs);
    let candidate: unknown;
    try {
      if (addressFinding === undefined) {
        addressFinding = callbacks.address;
        if (typeof addressFinding !== 'function') {
          throw new TypeError('address callback is not callable');
        }
      }
      candidate = await addressFinding.call(
        callbacks,
        finding,
        Object.freeze({ sequence, total: validated.length }),
      );
    } catch {
      const reason = 'PR-review address callback failed';
      appendEvidence(
        evidence,
        finding,
        sequence,
        started,
        'callback-error',
        reason,
        [],
      );
      return finish('failed', reason, validated.length, evidence);
    }

    let disposition: NormalizedDisposition | undefined;
    try {
      disposition = normalizeDisposition(candidate);
    } catch {
      // Adapter results are untrusted and may be proxies with throwing traps.
    }
    if (disposition === undefined) {
      const reason = 'PR-review address callback returned an invalid result';
      appendEvidence(
        evidence,
        finding,
        sequence,
        started,
        'invalid-result',
        reason,
        [],
      );
      return finish('failed', reason, validated.length, evidence);
    }

    earliestStartMs = appendEvidence(
      evidence,
      finding,
      sequence,
      started,
      disposition.kind,
      disposition.reason,
      disposition.evidenceReferences,
    );
    if (disposition.kind === 'escalated') escalated = true;
  }

  return escalated
    ? finish(
        'blocked',
        'one or more PR-review findings require escalation',
        validated.length,
        evidence,
      )
    : finish(
        'passed',
        'all PR-review findings were resolved or disputed with evidence',
        validated.length,
        evidence,
      );
}

type NormalizedDisposition = {
  kind: PrReviewDisposition['kind'];
  reason: string;
  evidenceReferences: string[];
};

function validateFindings(
  value: unknown,
): readonly Readonly<PrReviewFinding>[] {
  const values = arrayDataValues(value, MAX_FINDINGS);
  if (values === undefined) {
    throw new Error(
      `PR-review findings must be an array of at most ${MAX_FINDINGS}`,
    );
  }
  const findings = values.map((candidate, index) =>
    validateFinding(candidate, index),
  );
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) {
    throw new Error('PR-review finding identifiers must be unique');
  }
  return Object.freeze(findings);
}

function validateFinding(
  value: unknown,
  index: number,
): Readonly<PrReviewFinding> {
  const field = `PR-review findings[${index}]`;
  const record = mapping(value, field);
  rejectUnknownKeys(
    record,
    new Set(['id', 'severity', 'summary', 'sourceReference']),
    field,
  );
  if (
    typeof record.id !== 'string' ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(record.id)
  ) {
    throw new Error(`${field}.id is invalid`);
  }
  if (
    typeof record.severity !== 'string' ||
    !['low', 'medium', 'high', 'critical'].includes(record.severity)
  ) {
    throw new Error(`${field}.severity is invalid`);
  }
  return Object.freeze({
    id: record.id,
    severity: record.severity as PrReviewSeverity,
    summary: boundedText(record.summary, `${field}.summary`),
    sourceReference: boundedText(
      record.sourceReference,
      `${field}.sourceReference`,
    ),
  });
}

function normalizeDisposition(
  value: unknown,
): NormalizedDisposition | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !['kind', 'reason', 'evidenceReferences'].includes(key),
    )
  ) {
    return undefined;
  }
  const kind = ownDataValue(record, 'kind');
  const reason = ownDataValue(record, 'reason');
  const hasReferences = keys.includes('evidenceReferences');
  const rawReferences = ownDataValue(record, 'evidenceReferences');
  if (
    typeof kind !== 'string' ||
    !['resolved', 'disputed', 'escalated'].includes(kind) ||
    !isBoundedText(reason)
  ) {
    return undefined;
  }
  const references = hasReferences ? normalizeReferences(rawReferences) : [];
  if (
    references === undefined ||
    (kind === 'disputed' && references.length === 0)
  ) {
    return undefined;
  }
  return {
    kind: kind as PrReviewDisposition['kind'],
    reason,
    evidenceReferences: references,
  };
}

function normalizeReferences(value: unknown): string[] | undefined {
  const values = arrayDataValues(value, MAX_EVIDENCE_REFERENCES);
  if (values === undefined) return undefined;
  const references: string[] = [];
  for (const reference of values) {
    if (!isBoundedText(reference)) return undefined;
    references.push(reference);
  }
  return references;
}

function appendEvidence(
  evidence: PrReviewFindingEvidence[],
  finding: Readonly<PrReviewFinding>,
  sequence: number,
  started: FindingStartTime,
  disposition: PrReviewFindingEvidence['disposition'],
  reason: string,
  evidenceReferences: readonly string[],
): number {
  const elapsedNs = process.hrtime.bigint() - started.monotonicNs;
  const durationMs = Math.max(0, Number(elapsedNs) / 1_000_000);
  const completed = Math.max(
    Date.now(),
    started.wallClockMs + Math.ceil(durationMs),
  );
  evidence.push({
    sequence,
    ...finding,
    disposition,
    reason,
    evidenceReferences: [...evidenceReferences],
    startedAt: new Date(started.wallClockMs).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs,
  });
  return completed;
}

function startFindingTiming(earliestStartMs?: number): FindingStartTime {
  return {
    wallClockMs: Math.max(Date.now(), earliestStartMs ?? -Infinity),
    monotonicNs: process.hrtime.bigint(),
  };
}

function finish(
  outcome: PrReviewEvidence['outcome'],
  reason: string,
  totalFindings: number,
  findings: PrReviewFindingEvidence[],
): Readonly<PrReviewEvidence> {
  for (const finding of findings) {
    Object.freeze(finding.evidenceReferences);
    Object.freeze(finding);
  }
  Object.freeze(findings);
  return Object.freeze({
    version: 1,
    outcome,
    reason,
    totalFindings,
    attemptedFindings: findings.length,
    findings,
  });
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

function arrayDataValues(
  value: unknown,
  maximumLength: number,
): unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
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
      if (descriptor === undefined || !('value' in descriptor))
        return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

function ownDataValue(record: object, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  return descriptor !== undefined && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new Error(`unknown ${field} key`);
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
