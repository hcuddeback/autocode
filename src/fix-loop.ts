import type { FixLoopConfig } from './config.js';

const MAX_REASON_BYTES = 4096;

export type CheckResult =
  | { kind: 'passed'; reason: string }
  | { kind: 'retryable'; reason: string }
  | { kind: 'blocked'; reason: string };

export type FixResult =
  { kind: 'applied'; reason: string } | { kind: 'blocked'; reason: string };

export interface FixLoopContext {
  /** Zero for the initial check, then the number of fixes already applied. */
  readonly attempt: number;
}

export interface FixLoopCallbacks {
  check(context: FixLoopContext): Promise<unknown>;
  fix(context: FixLoopContext): Promise<unknown>;
}

export interface FixLoopTransition {
  readonly sequence: number;
  readonly attempt: number;
  readonly action: 'check' | 'fix';
  readonly outcome:
    | CheckResult['kind']
    | FixResult['kind']
    | 'callback-error'
    | 'invalid-result';
  readonly reason: string;
}

export interface FixLoopResult {
  readonly outcome: 'succeeded' | 'blocked' | 'failed';
  readonly attemptsUsed: number;
  readonly reason: string;
  readonly transitions: readonly Readonly<FixLoopTransition>[];
}

export async function runBoundedFixLoop(
  config: Readonly<FixLoopConfig>,
  callbacks: FixLoopCallbacks,
): Promise<Readonly<FixLoopResult>> {
  const maxAttempts = config.maxAttempts;
  validateMaxAttempts(maxAttempts);
  const transitions: FixLoopTransition[] = [];
  let attemptsUsed = 0;

  while (true) {
    const check = await invoke(
      'check',
      attemptsUsed,
      callbacks.check,
      isCheckResult,
      transitions,
    );
    if (check.kind === 'terminal') {
      return finish('failed', attemptsUsed, check.reason, transitions);
    }
    append(transitions, attemptsUsed, 'check', check.value);
    if (check.value.kind === 'passed') {
      return finish('succeeded', attemptsUsed, check.value.reason, transitions);
    }
    if (check.value.kind === 'blocked') {
      return finish('blocked', attemptsUsed, check.value.reason, transitions);
    }
    if (attemptsUsed === maxAttempts) {
      return finish(
        'failed',
        attemptsUsed,
        `fix attempt ceiling exhausted after ${attemptsUsed} attempts`,
        transitions,
      );
    }

    const nextAttempt = attemptsUsed + 1;
    attemptsUsed = nextAttempt;
    const fix = await invoke(
      'fix',
      attemptsUsed,
      callbacks.fix,
      isFixResult,
      transitions,
    );
    if (fix.kind === 'terminal') {
      return finish('failed', attemptsUsed, fix.reason, transitions);
    }
    append(transitions, attemptsUsed, 'fix', fix.value);
    if (fix.value.kind === 'blocked') {
      return finish('blocked', attemptsUsed, fix.value.reason, transitions);
    }
  }
}

type Validated<T> =
  { kind: 'value'; value: T } | { kind: 'terminal'; reason: string };

async function invoke<T>(
  action: 'check' | 'fix',
  attempt: number,
  callback: (context: FixLoopContext) => Promise<unknown>,
  validate: (value: unknown) => T | undefined,
  transitions: FixLoopTransition[],
): Promise<Validated<T>> {
  let value: unknown;
  try {
    value = await callback(Object.freeze({ attempt }));
  } catch {
    const reason = `${action} callback failed`;
    appendFailure(transitions, attempt, action, 'callback-error', reason);
    return { kind: 'terminal', reason };
  }
  try {
    const validated = validate(value);
    if (validated !== undefined) return { kind: 'value', value: validated };
  } catch {
    // Callback results are untrusted and may contain throwing getters/proxies.
  }
  const reason = `${action} callback returned an invalid result`;
  appendFailure(transitions, attempt, action, 'invalid-result', reason);
  return { kind: 'terminal', reason };
}

function isCheckResult(value: unknown): CheckResult | undefined {
  return readValidResult(value, new Set(['passed', 'retryable', 'blocked'])) as
    CheckResult | undefined;
}

function isFixResult(value: unknown): FixResult | undefined {
  return readValidResult(value, new Set(['applied', 'blocked'])) as
    FixResult | undefined;
}

function readValidResult(
  value: unknown,
  kinds: ReadonlySet<string>,
): { kind: string; reason: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('reason')) {
    return undefined;
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(record, 'kind');
  const reasonDescriptor = Object.getOwnPropertyDescriptor(record, 'reason');
  if (
    kindDescriptor === undefined ||
    reasonDescriptor === undefined ||
    !('value' in kindDescriptor) ||
    !('value' in reasonDescriptor)
  ) {
    return undefined;
  }
  const kind = kindDescriptor.value;
  const reason = reasonDescriptor.value;
  if (typeof kind !== 'string' || !kinds.has(kind) || !validReason(reason)) {
    return undefined;
  }
  return Object.freeze({ kind, reason });
}

function validReason(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MAX_REASON_BYTES &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (isControlCharacter(character)) return true;
  }
  return false;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  );
}

function append(
  transitions: FixLoopTransition[],
  attempt: number,
  action: 'check' | 'fix',
  result: CheckResult | FixResult,
): void {
  transitions.push(
    Object.freeze({
      sequence: transitions.length + 1,
      attempt,
      action,
      outcome: result.kind,
      reason: result.reason,
    }),
  );
}

function appendFailure(
  transitions: FixLoopTransition[],
  attempt: number,
  action: 'check' | 'fix',
  outcome: 'callback-error' | 'invalid-result',
  reason: string,
): void {
  transitions.push(
    Object.freeze({
      sequence: transitions.length + 1,
      attempt,
      action,
      outcome,
      reason,
    }),
  );
}

function finish(
  outcome: FixLoopResult['outcome'],
  attemptsUsed: number,
  reason: string,
  transitions: FixLoopTransition[],
): Readonly<FixLoopResult> {
  return Object.freeze({
    outcome,
    attemptsUsed,
    reason,
    transitions: Object.freeze([...transitions]),
  });
}

function validateMaxAttempts(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 20) {
    throw new Error('fixLoop.maxAttempts must be an integer from 1 through 20');
  }
}
