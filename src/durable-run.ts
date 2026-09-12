import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { discoverWorkspaceCredentials, redactSecrets } from './codex.js';

const MAX_PHASES = 64;
const MAX_TEXT_BYTES = 4096;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_EVENTS_BYTES = 8 * 1024 * 1024;
const MAX_PROCESS_IDENTITY_BYTES = 512;
const MAX_ATTEMPTS = 20;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_ELAPSED_MS = 30 * MAX_DELAY_MS;
const MAX_BACKOFF_MULTIPLIER = 10;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LOCK_DIRECTORY = 'run.lock';
const LOCK_OWNER_FILE = 'owner.json';
const DEFAULT_RETRY_POLICY: Readonly<DurableRetryPolicy> = Object.freeze({
  maxAttempts: 3,
  maxElapsedMs: MAX_DELAY_MS,
  minimumIntervalMs: 0,
  initialBackoffMs: 0,
  backoffMultiplier: 2,
  maxBackoffMs: 0,
});
let ownProcessIdentityPromise: Promise<string | undefined> | undefined;

export interface DurablePhaseDefinition {
  readonly id: string;
  readonly description: string;
}

export interface DurableRunDefinition {
  readonly runId: string;
  readonly phases: readonly DurablePhaseDefinition[];
  readonly retryPolicy?: DurableRetryPolicy;
}

export interface DurableRetryPolicy {
  readonly maxAttempts: number;
  readonly maxElapsedMs: number;
  readonly minimumIntervalMs: number;
  readonly initialBackoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
}

export interface DurableEffectContext {
  readonly runId: string;
  readonly phaseId: string;
  readonly sequence: number;
  readonly effectId: string;
  readonly attempt: number;
  readonly resuming: boolean;
}

export type DurableEffectResult =
  | { readonly kind: 'applied'; readonly reason: string }
  | {
      readonly kind: 'retryable';
      readonly reason: string;
      readonly retryAfterMs?: number;
    };

export interface DurableReconciliationResult {
  readonly kind: 'applied' | 'not-applied' | 'ambiguous';
  readonly reason: string;
}

export interface DurableRunCallbacks {
  execute(
    phase: Readonly<DurablePhaseDefinition>,
    context: Readonly<DurableEffectContext>,
  ): Promise<unknown>;
  reconcile(
    phase: Readonly<DurablePhaseDefinition>,
    context: Readonly<DurableEffectContext>,
  ): Promise<unknown>;
}

export type DurableRunCheckpoint =
  'after-event-appended' | 'after-state-published' | 'after-effect-applied';

export interface DurableRunOptions {
  readonly pauseAfterPhase?: string;
  readonly onCheckpoint?: (
    checkpoint: DurableRunCheckpoint,
    state: Readonly<DurableRunState>,
  ) => Promise<void>;
  readonly clock?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export interface DurablePhaseState extends DurablePhaseDefinition {
  readonly sequence: number;
  readonly effectId: string;
  readonly status: 'pending' | 'waiting' | 'in-flight' | 'completed';
  readonly attemptsUsed: number;
  readonly nextAttemptAt: string | null;
  readonly reason: string | null;
}

export interface DurableRunState {
  readonly version: 2;
  readonly runId: string;
  readonly definitionSha256: string;
  readonly status:
    'running' | 'waiting' | 'paused' | 'blocked' | 'failed' | 'completed';
  readonly reason: string;
  readonly eventSequence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nextEffectAt: string | null;
  readonly retryPolicy: Readonly<DurableRetryPolicy>;
  readonly phases: readonly Readonly<DurablePhaseState>[];
}

export interface DurableRunResult {
  readonly runDirectory: string;
  readonly outcome: 'paused' | 'blocked' | 'failed' | 'completed';
  readonly state: Readonly<DurableRunState>;
}

type DurableEvent =
  | BaseEvent<'run-created'>
  | BaseEvent<'run-resumed'>
  | PhaseEvent<'effect-started'>
  | RetryScheduledEvent
  | PhaseEvent<'effect-completed'>
  | BaseEvent<'run-paused'>
  | BaseEvent<'run-blocked'>
  | BaseEvent<'run-failed'>
  | BaseEvent<'run-completed'>;

interface BaseEvent<T extends string> {
  readonly version: 1 | 2;
  readonly sequence: number;
  readonly runId: string;
  readonly definitionSha256: string;
  readonly type: T;
  readonly reason: string;
  readonly at: string;
}

interface PhaseEvent<T extends string> extends BaseEvent<T> {
  readonly phaseId: string;
  readonly effectId: string;
}

interface RetryScheduledEvent extends PhaseEvent<'effect-retry-scheduled'> {
  readonly nextAttemptAt: string;
}

type EventInput =
  | {
      readonly type:
        | 'run-created'
        | 'run-resumed'
        | 'run-paused'
        | 'run-blocked'
        | 'run-failed'
        | 'run-completed';
      readonly reason: string;
    }
  | {
      readonly type: 'effect-started' | 'effect-completed';
      readonly reason: string;
      readonly phaseId: string;
      readonly effectId: string;
    }
  | {
      readonly type: 'effect-retry-scheduled';
      readonly reason: string;
      readonly phaseId: string;
      readonly effectId: string;
      readonly nextAttemptAt: string;
    };

interface NormalizedDefinition {
  readonly runId: string;
  readonly definitionSha256: string;
  readonly phases: readonly Readonly<DurablePhaseDefinition>[];
  readonly retryPolicy: Readonly<DurableRetryPolicy>;
  readonly hasExplicitRetryPolicy: boolean;
}

interface NormalizedCallbacks {
  readonly execute: DurableRunCallbacks['execute'];
  readonly reconcile: DurableRunCallbacks['reconcile'];
  readonly receiver: object;
}

interface NormalizedOptions {
  readonly pauseAfterPhase?: string;
  readonly onCheckpoint?: DurableRunOptions['onCheckpoint'];
  readonly clock: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}

interface RunPaths {
  readonly root: string;
  readonly runs: string;
  readonly run: string;
  readonly state: string;
  readonly events: string;
  readonly lock: string;
}

interface ResolvedRun {
  readonly paths: RunPaths;
  readonly workspaceSecrets: readonly string[];
}

type MutablePhaseState = {
  -readonly [Key in keyof DurablePhaseState]: DurablePhaseState[Key];
};

export async function runDurableRun(
  projectDirectory: string,
  definitionValue: DurableRunDefinition,
  callbacksValue: DurableRunCallbacks,
  optionsValue: DurableRunOptions = {},
): Promise<Readonly<DurableRunResult>> {
  const definition = normalizeDefinition(definitionValue);
  const callbacks = normalizeCallbacks(callbacksValue);
  const options = normalizeOptions(optionsValue, definition);
  const { paths, workspaceSecrets } = await resolveRunPaths(
    projectDirectory,
    definition,
  );
  const release = await acquireLock(paths);
  try {
    let state = await loadOrCreateRun(paths, definition, options);
    if (state.status === 'completed' || state.status === 'failed')
      return finish(paths, state);
    if (
      state.status === 'paused' &&
      options.pauseAfterPhase !== undefined &&
      phaseById(state, options.pauseAfterPhase).status === 'completed'
    ) {
      return finish(paths, state);
    }
    if (state.status === 'paused' || state.status === 'blocked') {
      state = await transition(
        paths,
        definition,
        state,
        { type: 'run-resumed', reason: 'run resumed by operator' },
        options,
      );
    }

    while (true) {
      const budgetTime = Math.max(
        readClock(options),
        Date.parse(state.updatedAt),
      );
      if (
        budgetTime >= elapsedDeadline(state, definition.retryPolicy) &&
        !state.phases.some((candidate) => candidate.status === 'in-flight')
      ) {
        state = await transition(
          paths,
          definition,
          state,
          { type: 'run-failed', reason: 'run elapsed-time ceiling exhausted' },
          options,
          false,
          budgetTime,
        );
        return finish(paths, state);
      }
      if (
        options.pauseAfterPhase !== undefined &&
        phaseById(state, options.pauseAfterPhase).status === 'completed' &&
        !state.phases.some((candidate) => candidate.status === 'in-flight')
      ) {
        state = await transition(
          paths,
          definition,
          state,
          {
            type: 'run-paused',
            reason: `paused after phase ${options.pauseAfterPhase}`,
          },
          options,
        );
        return finish(paths, state);
      }
      const phase = state.phases.find(
        (candidate) => candidate.status !== 'completed',
      );
      if (phase === undefined) {
        state = await transition(
          paths,
          definition,
          state,
          { type: 'run-completed', reason: 'all configured phases completed' },
          options,
        );
        return finish(paths, state);
      }

      if (phase.status === 'in-flight') {
        const reconciliation = await invokeReconcile(
          paths,
          callbacks,
          definition,
          phase,
          workspaceSecrets,
        );
        if (reconciliation.kind === 'ambiguous') {
          state = await transition(
            paths,
            definition,
            state,
            { type: 'run-blocked', reason: reconciliation.reason },
            options,
          );
          return finish(paths, state);
        }
        if (reconciliation.kind === 'applied') {
          state = await completeEffect(
            paths,
            definition,
            state,
            phase,
            reconciliation.reason,
            options,
          );
        } else {
          state = await scheduleRetry(
            paths,
            definition,
            state,
            phase,
            options,
            reconciliation.reason,
          );
        }
      } else {
        const eligibleAt =
          phase.status === 'waiting' ? phase.nextAttemptAt : state.nextEffectAt;
        if (eligibleAt !== null) {
          const waited = await waitUntilEligible(
            paths,
            definition,
            state,
            eligibleAt,
            options,
          );
          if (waited.status === 'failed') return finish(paths, waited);
          state = waited;
        }
        const attemptAt = readClock(options);
        if (eligibleAt !== null && attemptAt < Date.parse(eligibleAt)) {
          continue;
        }
        if (attemptAt >= elapsedDeadline(state, definition.retryPolicy)) {
          state = await transition(
            paths,
            definition,
            state,
            {
              type: 'run-failed',
              reason: 'run elapsed-time ceiling exhausted',
            },
            options,
            false,
            attemptAt,
          );
          return finish(paths, state);
        }
        state = await transition(
          paths,
          definition,
          state,
          {
            type: 'effect-started',
            phaseId: phase.id,
            effectId: phase.effectId,
            reason: `effect intent persisted for phase ${phase.id}`,
          },
          options,
          false,
          attemptAt,
        );
        state = await executeEffect(
          paths,
          definition,
          state,
          phaseById(state, phase.id),
          callbacks,
          options,
          workspaceSecrets,
          phase.status === 'waiting',
        );
      }

      if (state.status === 'failed') return finish(paths, state);

      if (
        options.pauseAfterPhase === phase.id &&
        phaseById(state, phase.id).status === 'completed'
      ) {
        state = await transition(
          paths,
          definition,
          state,
          { type: 'run-paused', reason: `paused after phase ${phase.id}` },
          options,
        );
        return finish(paths, state);
      }
    }
  } finally {
    await release();
  }
}

async function executeEffect(
  paths: RunPaths,
  definition: NormalizedDefinition,
  state: DurableRunState,
  phase: DurablePhaseState,
  callbacks: NormalizedCallbacks,
  options: NormalizedOptions,
  secrets: readonly string[],
  resuming: boolean,
): Promise<DurableRunState> {
  const context = effectContext(definition.runId, phase, resuming);
  const callbackSecrets = await refreshWorkspaceSecrets(paths.root, secrets);
  const invocationTime = Math.max(
    readClock(options),
    Date.parse(state.updatedAt),
  );
  if (invocationTime >= elapsedDeadline(state, definition.retryPolicy)) {
    return transition(
      paths,
      definition,
      state,
      {
        type: 'run-failed',
        reason: 'run elapsed-time ceiling exhausted before effect invocation',
      },
      options,
      false,
      invocationTime,
    );
  }
  let candidate: unknown;
  try {
    candidate = await callbacks.execute.call(
      callbacks.receiver,
      phaseDefinition(phase),
      context,
    );
  } catch {
    throw new Error(
      `effect adapter failed for phase ${phase.id}; reconciliation is required before resume`,
    );
  }
  const result = normalizeEffectResult(
    candidate,
    await refreshWorkspaceSecrets(paths.root, callbackSecrets),
  );
  if (result === undefined) {
    throw new Error(
      `effect adapter returned an invalid result for phase ${phase.id}; reconciliation is required before resume`,
    );
  }
  if (result.kind === 'retryable') {
    return scheduleRetry(
      paths,
      definition,
      state,
      phase,
      options,
      result.reason,
      result.retryAfterMs,
    );
  }
  await options.onCheckpoint?.('after-effect-applied', freezeState(state));
  return completeEffect(
    paths,
    definition,
    state,
    phase,
    result.reason,
    options,
  );
}

async function completeEffect(
  paths: RunPaths,
  definition: NormalizedDefinition,
  state: DurableRunState,
  phase: DurablePhaseState,
  reason: string,
  options: NormalizedOptions,
): Promise<DurableRunState> {
  return transition(
    paths,
    definition,
    state,
    {
      type: 'effect-completed',
      phaseId: phase.id,
      effectId: phase.effectId,
      reason,
    },
    options,
  );
}

async function scheduleRetry(
  paths: RunPaths,
  definition: NormalizedDefinition,
  state: DurableRunState,
  phase: DurablePhaseState,
  options: NormalizedOptions,
  reason: string,
  retryAfterMs = 0,
): Promise<DurableRunState> {
  if (phase.attemptsUsed >= definition.retryPolicy.maxAttempts) {
    return transition(
      paths,
      definition,
      state,
      {
        type: 'run-failed',
        reason: `attempt ceiling exhausted for phase ${phase.id} after ${phase.attemptsUsed} attempts`,
      },
      options,
    );
  }
  const now = readClock(options);
  const deadline = elapsedDeadline(state, definition.retryPolicy);
  if (now >= deadline) {
    return transition(
      paths,
      definition,
      state,
      { type: 'run-failed', reason: 'run elapsed-time ceiling exhausted' },
      options,
    );
  }
  const backoff = retryBackoff(phase.attemptsUsed, definition.retryPolicy);
  const nextAttempt = Math.max(
    now + Math.max(backoff, retryAfterMs),
    state.nextEffectAt === null ? 0 : Date.parse(state.nextEffectAt),
  );
  if (!Number.isSafeInteger(nextAttempt) || nextAttempt >= deadline) {
    return transition(
      paths,
      definition,
      state,
      {
        type: 'run-failed',
        reason: 'run elapsed-time ceiling prevents another attempt',
      },
      options,
    );
  }
  return transition(
    paths,
    definition,
    state,
    {
      type: 'effect-retry-scheduled',
      phaseId: phase.id,
      effectId: phase.effectId,
      reason,
      nextAttemptAt: new Date(nextAttempt).toISOString(),
    },
    options,
    false,
    now,
  );
}

async function waitUntilEligible(
  paths: RunPaths,
  definition: NormalizedDefinition,
  state: DurableRunState,
  eligibleAt: string,
  options: NormalizedOptions,
): Promise<DurableRunState> {
  const target = Date.parse(eligibleAt);
  const deadline = elapsedDeadline(state, definition.retryPolicy);
  if (target >= deadline) {
    return transition(
      paths,
      definition,
      state,
      {
        type: 'run-failed',
        reason: 'run elapsed-time ceiling prevents the scheduled attempt',
      },
      options,
    );
  }
  while (true) {
    const before = readClock(options);
    if (before >= target) return state;
    if (before >= deadline) {
      return transition(
        paths,
        definition,
        state,
        { type: 'run-failed', reason: 'run elapsed-time ceiling exhausted' },
        options,
      );
    }
    const milliseconds = Math.min(
      Math.min(target, deadline) - before,
      MAX_TIMER_DELAY_MS,
    );
    try {
      await options.wait(milliseconds);
    } catch {
      throw new Error('durable pacing wait failed');
    }
    if (readClock(options) <= before) {
      throw new Error('durable pacing wait returned without clock progress');
    }
  }
}

function elapsedDeadline(
  state: DurableRunState,
  policy: DurableRetryPolicy,
): number {
  const value = Date.parse(state.createdAt) + policy.maxElapsedMs;
  if (!Number.isSafeInteger(value))
    throw new Error('durable run elapsed-time deadline is invalid');
  return value;
}

function retryBackoff(
  attemptsUsed: number,
  policy: DurableRetryPolicy,
): number {
  if (policy.initialBackoffMs === 0) return 0;
  let delay = policy.initialBackoffMs;
  for (let attempt = 1; attempt < attemptsUsed; attempt += 1) {
    delay = Math.min(delay * policy.backoffMultiplier, policy.maxBackoffMs);
  }
  return Math.min(delay, policy.maxBackoffMs);
}

async function invokeReconcile(
  paths: RunPaths,
  callbacks: NormalizedCallbacks,
  definition: NormalizedDefinition,
  phase: DurablePhaseState,
  secrets: readonly string[],
): Promise<DurableReconciliationResult> {
  const callbackSecrets = await refreshWorkspaceSecrets(paths.root, secrets);
  let candidate: unknown;
  try {
    candidate = await callbacks.reconcile.call(
      callbacks.receiver,
      phaseDefinition(phase),
      effectContext(definition.runId, phase, true),
    );
  } catch {
    throw new Error(`reconciliation adapter failed for phase ${phase.id}`);
  }
  const result = normalizeReconciliationResult(
    candidate,
    await refreshWorkspaceSecrets(paths.root, callbackSecrets),
  );
  if (result === undefined) {
    throw new Error(
      `reconciliation adapter returned an invalid result for phase ${phase.id}`,
    );
  }
  return result;
}

async function refreshWorkspaceSecrets(
  root: string,
  baseline: readonly string[],
): Promise<readonly string[]> {
  const current = (await discoverWorkspaceCredentials(root)).secrets;
  return [...new Set([...baseline, ...current])];
}

function effectContext(
  runId: string,
  phase: DurablePhaseState,
  resuming: boolean,
): Readonly<DurableEffectContext> {
  return Object.freeze({
    runId,
    phaseId: phase.id,
    sequence: phase.sequence,
    effectId: phase.effectId,
    attempt: phase.attemptsUsed,
    resuming,
  });
}

function phaseDefinition(
  phase: DurablePhaseState,
): Readonly<DurablePhaseDefinition> {
  return Object.freeze({ id: phase.id, description: phase.description });
}

async function loadOrCreateRun(
  paths: RunPaths,
  definition: NormalizedDefinition,
  options: NormalizedOptions,
): Promise<DurableRunState> {
  const loaded = await loadRun(paths, definition);
  if (loaded !== undefined) return loaded;
  const createdAt = new Date(readClock(options)).toISOString();
  const initial = initialState(definition, createdAt);
  return transition(
    paths,
    definition,
    initial,
    { type: 'run-created', reason: 'durable run created' },
    options,
    true,
  );
}

async function loadRun(
  paths: RunPaths,
  definition: NormalizedDefinition,
): Promise<DurableRunState | undefined> {
  const eventRead = await readEvents(paths.events, definition);
  const snapshotValue = await readJsonIfPresent(
    paths.state,
    MAX_STATE_BYTES,
    'run snapshot',
  );
  const snapshotVersion =
    snapshotValue === undefined
      ? undefined
      : dataValue(mapping(snapshotValue, 'run snapshot'), 'version');
  if (eventRead.events.length === 0) {
    if (snapshotValue !== undefined)
      throw new Error('run snapshot exists without durable events');
    if (eventRead.hadFile) await unlink(paths.events);
    return undefined;
  }

  let replayed: DurableRunState | undefined;
  let snapshotPrefix: DurableRunState | undefined;
  const snapshotSequence =
    snapshotValue === undefined
      ? undefined
      : snapshotEventSequence(snapshotValue);
  for (const event of eventRead.events) {
    replayed = applyEvent(replayed, event, definition);
    if (event.sequence === snapshotSequence) snapshotPrefix = replayed;
  }
  if (replayed === undefined) throw new Error('run event log is empty');
  if (snapshotValue !== undefined) {
    if (
      snapshotVersion === 1 &&
      eventRead.events.some((event) => event.version !== 1)
    ) {
      throw new Error('legacy run snapshot requires a version 1 event history');
    }
    const snapshot = normalizeState(snapshotValue, definition, snapshotPrefix);
    if (
      snapshotPrefix === undefined ||
      JSON.stringify(snapshot) !== JSON.stringify(snapshotPrefix)
    ) {
      throw new Error('run snapshot does not match its durable event prefix');
    }
  }
  if (eventRead.hadPartialTail) {
    const handle = await openRegularFile(paths.events, 'r+', 'run event log');
    try {
      await handle.truncate(eventRead.completeBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  if (
    snapshotValue === undefined ||
    snapshotSequence !== replayed.eventSequence ||
    snapshotVersion !== 2
  ) {
    await publishState(paths, replayed);
  }
  return replayed;
}

async function transition(
  paths: RunPaths,
  definition: NormalizedDefinition,
  state: DurableRunState,
  input: EventInput,
  options: NormalizedOptions,
  creating = false,
  eventTime?: number,
): Promise<DurableRunState> {
  const now = eventTime ?? readClock(options);
  const safeInput: EventInput =
    input.type === 'run-completed' &&
    Math.max(now, Date.parse(state.updatedAt)) >=
      elapsedDeadline(state, definition.retryPolicy)
      ? { type: 'run-failed', reason: 'run elapsed-time ceiling exhausted' }
      : input;
  const event = createEvent(
    definition,
    state.eventSequence + 1,
    safeInput,
    now,
  );
  await appendEvent(paths, event, creating);
  const next = applyEvent(creating ? undefined : state, event, definition);
  await options.onCheckpoint?.('after-event-appended', freezeState(next));
  await publishState(paths, next);
  await options.onCheckpoint?.('after-state-published', freezeState(next));
  return next;
}

function createEvent(
  definition: NormalizedDefinition,
  sequence: number,
  input: EventInput,
  now: number,
): DurableEvent {
  const base = {
    version: 2 as const,
    sequence,
    runId: definition.runId,
    definitionSha256: definition.definitionSha256,
    reason: input.reason,
    at: new Date(now).toISOString(),
  };
  return input.type === 'effect-started' ||
    input.type === 'effect-completed' ||
    input.type === 'effect-retry-scheduled'
    ? input.type === 'effect-retry-scheduled'
      ? {
          ...base,
          type: input.type,
          phaseId: input.phaseId,
          effectId: input.effectId,
          nextAttemptAt: input.nextAttemptAt,
        }
      : {
          ...base,
          type: input.type,
          phaseId: input.phaseId,
          effectId: input.effectId,
        }
    : { ...base, type: input.type };
}

function applyEvent(
  current: DurableRunState | undefined,
  event: DurableEvent,
  definition: NormalizedDefinition,
): DurableRunState {
  if (
    event.runId !== definition.runId ||
    event.definitionSha256 !== definition.definitionSha256
  ) {
    throw new Error('durable event does not match the current run definition');
  }
  if (current === undefined) {
    if (event.type !== 'run-created' || event.sequence !== 1) {
      throw new Error('durable event log must begin with run-created');
    }
    return {
      ...initialState(definition, event.at),
      reason: event.reason,
      eventSequence: event.sequence,
      updatedAt: event.at,
    };
  }
  if (event.sequence !== current.eventSequence + 1) {
    throw new Error('durable event sequence is not contiguous');
  }
  const phases = current.phases.map((phase) => ({ ...phase }));
  let status = current.status;
  let nextEffectAt = current.nextEffectAt;
  if (event.type === 'run-created')
    throw new Error('run-created may only be the first event');
  if (event.type === 'run-resumed') {
    if (status !== 'paused' && status !== 'blocked')
      throw new Error('only paused or blocked runs can resume');
    status = 'running';
  } else if (event.type === 'effect-started') {
    if (status !== 'running' && status !== 'waiting')
      throw new Error('effects can start only while a run is running');
    const phase = mutablePhase(phases, event);
    if (
      (phase.status !== 'pending' && phase.status !== 'waiting') ||
      !priorPhasesComplete(phases, phase.sequence) ||
      phase.attemptsUsed >= definition.retryPolicy.maxAttempts
    ) {
      throw new Error('effect-started violates phase ordering');
    }
    const eventTime = Date.parse(event.at);
    const eligibleTime =
      phase.status === 'waiting'
        ? Date.parse(phase.nextAttemptAt as string)
        : nextEffectAt === null
          ? 0
          : Date.parse(nextEffectAt);
    if (
      event.version === 2 &&
      (eventTime < eligibleTime ||
        eventTime >= elapsedDeadline(current, definition.retryPolicy))
    ) {
      throw new Error('effect-started violates persisted pacing policy');
    }
    status = 'running';
    phase.status = 'in-flight';
    phase.attemptsUsed += 1;
    phase.nextAttemptAt = null;
    phase.reason = event.reason;
    nextEffectAt = new Date(
      eventTime + definition.retryPolicy.minimumIntervalMs,
    ).toISOString();
  } else if (event.type === 'effect-retry-scheduled') {
    if (status !== 'running')
      throw new Error('retry may be scheduled only while a run is running');
    const phase = mutablePhase(phases, event);
    const nextAttempt = Date.parse(event.nextAttemptAt);
    if (
      phase.status !== 'in-flight' ||
      phase.attemptsUsed >= definition.retryPolicy.maxAttempts ||
      nextAttempt < Date.parse(event.at) ||
      nextAttempt <
        Date.parse(event.at) +
          retryBackoff(phase.attemptsUsed, definition.retryPolicy) ||
      (nextEffectAt !== null && nextAttempt < Date.parse(nextEffectAt)) ||
      nextAttempt >= elapsedDeadline(current, definition.retryPolicy)
    ) {
      throw new Error('effect-retry-scheduled violates retry policy');
    }
    status = 'waiting';
    phase.status = 'waiting';
    phase.nextAttemptAt = event.nextAttemptAt;
    phase.reason = event.reason;
  } else if (event.type === 'effect-completed') {
    if (status !== 'running')
      throw new Error('effects can complete only while a run is running');
    const phase = mutablePhase(phases, event);
    if (phase.status !== 'in-flight')
      throw new Error('effect-completed requires an in-flight effect');
    phase.status = 'completed';
    phase.reason = event.reason;
  } else if (event.type === 'run-paused') {
    if (
      (status !== 'running' && status !== 'waiting') ||
      phases.some((phase) => phase.status === 'in-flight')
    ) {
      throw new Error('run may pause only at a safe phase boundary');
    }
    status = 'paused';
  } else if (event.type === 'run-blocked') {
    if (
      status !== 'running' ||
      !phases.some((phase) => phase.status === 'in-flight')
    ) {
      throw new Error('run may block only on an in-flight effect');
    }
    status = 'blocked';
  } else if (event.type === 'run-failed') {
    if (status !== 'running' && status !== 'waiting') {
      throw new Error('run may fail only while running or waiting');
    }
    status = 'failed';
  } else {
    if (
      status !== 'running' ||
      phases.some((phase) => phase.status !== 'completed') ||
      (event.version === 2 &&
        Math.max(Date.parse(event.at), Date.parse(current.updatedAt)) >=
          elapsedDeadline(current, definition.retryPolicy))
    ) {
      throw new Error('run may complete only after every phase completes');
    }
    status = 'completed';
  }
  return {
    ...current,
    status,
    reason: event.reason,
    eventSequence: event.sequence,
    updatedAt: event.at,
    nextEffectAt,
    phases,
  };
}

function mutablePhase(
  phases: MutablePhaseState[],
  event: PhaseEvent<string>,
): MutablePhaseState {
  const phase = phases.find((candidate) => candidate.id === event.phaseId);
  if (phase === undefined || phase.effectId !== event.effectId) {
    throw new Error('durable phase event has an unknown effect identity');
  }
  return phase;
}

function priorPhasesComplete(
  phases: MutablePhaseState[],
  sequence: number,
): boolean {
  return phases.every(
    (phase) => phase.sequence >= sequence || phase.status === 'completed',
  );
}

function initialState(
  definition: NormalizedDefinition,
  createdAt: string,
): DurableRunState {
  return {
    version: 2,
    runId: definition.runId,
    definitionSha256: definition.definitionSha256,
    status: 'running',
    reason: 'run initialization pending',
    eventSequence: 0,
    createdAt,
    updatedAt: createdAt,
    nextEffectAt: null,
    retryPolicy: definition.retryPolicy,
    phases: definition.phases.map((phase, index) => ({
      sequence: index + 1,
      id: phase.id,
      description: phase.description,
      effectId: createHash('sha256')
        .update(
          `${definition.runId}\0${definition.definitionSha256}\0${phase.id}`,
        )
        .digest('hex'),
      status: 'pending',
      attemptsUsed: 0,
      nextAttemptAt: null,
      reason: null,
    })),
  };
}

async function appendEvent(
  paths: RunPaths,
  event: DurableEvent,
  creating: boolean,
): Promise<void> {
  await assertRunIdentity(paths);
  if (!creating) await rejectSymbolicLink(paths.events, 'run event log');
  const handle = await open(paths.events, creating ? 'wx' : 'a');
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (creating) await syncDirectory(paths.run);
}

async function publishState(
  paths: RunPaths,
  state: DurableRunState,
): Promise<void> {
  await assertRunIdentity(paths);
  await rejectSymbolicLink(paths.state, 'run snapshot');
  const temporary = path.join(
    paths.run,
    `.state.tmp-${process.pid}-${randomUUID()}`,
  );
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertRunIdentity(paths);
    await rename(temporary, paths.state);
    await syncDirectory(paths.run);
  } catch (error: unknown) {
    await unlinkIfPresent(temporary);
    throw error;
  }
}

async function readEvents(
  eventPath: string,
  definition: NormalizedDefinition,
): Promise<{
  events: DurableEvent[];
  hadFile: boolean;
  hadPartialTail: boolean;
  completeBytes: number;
}> {
  let contents: string;
  try {
    contents = await readBoundedFile(
      eventPath,
      MAX_EVENTS_BYTES,
      'run event log',
    );
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT'))
      return {
        events: [],
        hadFile: false,
        hadPartialTail: false,
        completeBytes: 0,
      };
    throw error;
  }
  const hadPartialTail = contents.length > 0 && !contents.endsWith('\n');
  const completeText = hadPartialTail
    ? contents.slice(0, contents.lastIndexOf('\n') + 1)
    : contents;
  const events: DurableEvent[] = [];
  let sawVersion2 = false;
  for (const line of completeText.split('\n')) {
    if (line === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('run event log contains invalid JSON');
    }
    const event = normalizeEvent(value, events.length + 1, definition);
    if (event.version === 1 && sawVersion2) {
      throw new Error('version 1 durable events must form a legacy prefix');
    }
    if (event.version === 2) sawVersion2 = true;
    events.push(event);
  }
  return {
    events,
    hadFile: true,
    hadPartialTail,
    completeBytes: Buffer.byteLength(completeText),
  };
}

function normalizeEvent(
  value: unknown,
  expectedSequence: number,
  definition: NormalizedDefinition,
): DurableEvent {
  const record = mapping(value, 'durable event');
  const type = dataValue(record, 'type');
  const version = dataValue(record, 'version');
  const phaseType =
    type === 'effect-started' ||
    type === 'effect-retry-scheduled' ||
    type === 'effect-completed';
  rejectUnknownKeys(
    record,
    new Set([
      'version',
      'sequence',
      'runId',
      'definitionSha256',
      'type',
      'reason',
      'at',
      ...(phaseType ? ['phaseId', 'effectId'] : []),
      ...(type === 'effect-retry-scheduled' ? ['nextAttemptAt'] : []),
    ]),
    'durable event',
  );
  if (
    dataValue(record, 'runId') !== definition.runId ||
    dataValue(record, 'definitionSha256') !== definition.definitionSha256
  ) {
    throw new Error('durable event does not match the current run definition');
  }
  if (
    (version !== 1 && version !== 2) ||
    dataValue(record, 'sequence') !== expectedSequence ||
    ![
      'run-created',
      'run-resumed',
      'effect-started',
      'effect-retry-scheduled',
      'effect-completed',
      'run-paused',
      'run-blocked',
      'run-failed',
      'run-completed',
    ].includes(String(type))
  ) {
    throw new Error('durable event identity is invalid');
  }
  if (
    version === 1 &&
    (type === 'effect-retry-scheduled' || type === 'run-failed')
  ) {
    throw new Error('durable event type requires version 2');
  }
  const reason = boundedText(
    dataValue(record, 'reason'),
    'durable event reason',
  );
  const at = timestamp(dataValue(record, 'at'), 'durable event timestamp');
  const base = {
    version: version as 1 | 2,
    sequence: expectedSequence,
    runId: definition.runId,
    definitionSha256: definition.definitionSha256,
    reason,
    at,
  };
  if (phaseType) {
    const phase = {
      ...base,
      type,
      phaseId: identifier(
        dataValue(record, 'phaseId'),
        'durable event phaseId',
      ),
      effectId: digest(dataValue(record, 'effectId'), 'durable event effectId'),
    };
    return type === 'effect-retry-scheduled'
      ? {
          ...phase,
          type,
          nextAttemptAt: timestamp(
            dataValue(record, 'nextAttemptAt'),
            'durable event nextAttemptAt',
          ),
        }
      : (phase as PhaseEvent<'effect-started' | 'effect-completed'>);
  }
  return {
    ...base,
    type: type as Exclude<
      DurableEvent['type'],
      'effect-started' | 'effect-retry-scheduled' | 'effect-completed'
    >,
  };
}

function normalizeState(
  value: unknown,
  definition: NormalizedDefinition,
  expectedPrefix: DurableRunState | undefined,
): DurableRunState {
  const record = mapping(value, 'run snapshot');
  if (dataValue(record, 'version') === 1) {
    return normalizeLegacyState(record, definition, expectedPrefix);
  }
  rejectUnknownKeys(
    record,
    new Set([
      'version',
      'runId',
      'definitionSha256',
      'status',
      'reason',
      'eventSequence',
      'createdAt',
      'updatedAt',
      'nextEffectAt',
      'retryPolicy',
      'phases',
    ]),
    'run snapshot',
  );
  const status = dataValue(record, 'status');
  const eventSequence = dataValue(record, 'eventSequence');
  if (
    dataValue(record, 'version') !== 2 ||
    dataValue(record, 'runId') !== definition.runId ||
    dataValue(record, 'definitionSha256') !== definition.definitionSha256 ||
    ![
      'running',
      'waiting',
      'paused',
      'blocked',
      'failed',
      'completed',
    ].includes(String(status)) ||
    !Number.isSafeInteger(eventSequence) ||
    (eventSequence as number) < 1
  )
    throw new Error('run snapshot identity is invalid');
  const phaseValues = arrayValues(dataValue(record, 'phases'), MAX_PHASES);
  if (
    phaseValues === undefined ||
    phaseValues.length !== definition.phases.length
  ) {
    throw new Error('run snapshot phases do not match the definition');
  }
  const phases = phaseValues.map((candidate, index) =>
    normalizePhaseState(candidate, definition, index),
  );
  const policy = normalizeRetryPolicy(
    dataValue(record, 'retryPolicy'),
    'run snapshot retryPolicy',
  );
  if (JSON.stringify(policy) !== JSON.stringify(definition.retryPolicy)) {
    throw new Error('run snapshot retry policy does not match the definition');
  }
  const nextEffectValue = dataValue(record, 'nextEffectAt');
  return {
    version: 2,
    runId: definition.runId,
    definitionSha256: definition.definitionSha256,
    status: status as DurableRunState['status'],
    reason: boundedText(dataValue(record, 'reason'), 'run snapshot reason'),
    eventSequence: eventSequence as number,
    createdAt: timestamp(
      dataValue(record, 'createdAt'),
      'run snapshot createdAt',
    ),
    updatedAt: timestamp(
      dataValue(record, 'updatedAt'),
      'run snapshot updatedAt',
    ),
    nextEffectAt:
      nextEffectValue === null
        ? null
        : timestamp(nextEffectValue, 'run snapshot nextEffectAt'),
    retryPolicy: policy,
    phases,
  };
}

function normalizeLegacyState(
  record: Record<string, unknown>,
  definition: NormalizedDefinition,
  expectedPrefix: DurableRunState | undefined,
): DurableRunState {
  if (definition.hasExplicitRetryPolicy || expectedPrefix === undefined) {
    throw new Error('legacy run snapshot is incompatible with retry policy');
  }
  rejectUnknownKeys(
    record,
    new Set([
      'version',
      'runId',
      'definitionSha256',
      'status',
      'reason',
      'eventSequence',
      'createdAt',
      'updatedAt',
      'phases',
    ]),
    'legacy run snapshot',
  );
  const status = dataValue(record, 'status');
  const eventSequence = dataValue(record, 'eventSequence');
  if (
    dataValue(record, 'runId') !== definition.runId ||
    dataValue(record, 'definitionSha256') !== definition.definitionSha256 ||
    !['running', 'paused', 'blocked', 'completed'].includes(String(status)) ||
    !Number.isSafeInteger(eventSequence) ||
    (eventSequence as number) < 1
  ) {
    throw new Error('legacy run snapshot identity is invalid');
  }
  const phaseValues = arrayValues(dataValue(record, 'phases'), MAX_PHASES);
  if (
    phaseValues === undefined ||
    phaseValues.length !== definition.phases.length
  ) {
    throw new Error('legacy run snapshot phases do not match the definition');
  }
  const phases = phaseValues.map((candidate, index) =>
    normalizeLegacyPhaseState(
      candidate,
      definition,
      index,
      expectedPrefix.phases[index]!,
    ),
  );
  return {
    version: 2,
    runId: definition.runId,
    definitionSha256: definition.definitionSha256,
    status: status as DurableRunState['status'],
    reason: boundedText(dataValue(record, 'reason'), 'run snapshot reason'),
    eventSequence: eventSequence as number,
    createdAt: timestamp(
      dataValue(record, 'createdAt'),
      'run snapshot createdAt',
    ),
    updatedAt: timestamp(
      dataValue(record, 'updatedAt'),
      'run snapshot updatedAt',
    ),
    nextEffectAt: expectedPrefix.nextEffectAt,
    retryPolicy: definition.retryPolicy,
    phases,
  };
}

function normalizeLegacyPhaseState(
  value: unknown,
  definition: NormalizedDefinition,
  index: number,
  expectedPrefix: DurablePhaseState,
): DurablePhaseState {
  const record = mapping(value, `legacy run snapshot phases[${index}]`);
  rejectUnknownKeys(
    record,
    new Set(['sequence', 'id', 'description', 'effectId', 'status', 'reason']),
    `legacy run snapshot phases[${index}]`,
  );
  const expected = initialState(definition, new Date(0).toISOString()).phases[
    index
  ]!;
  const status = dataValue(record, 'status');
  const reason = dataValue(record, 'reason');
  if (
    dataValue(record, 'sequence') !== index + 1 ||
    dataValue(record, 'id') !== expected.id ||
    dataValue(record, 'description') !== expected.description ||
    dataValue(record, 'effectId') !== expected.effectId ||
    !['pending', 'in-flight', 'completed'].includes(String(status)) ||
    (reason !== null && !isBoundedText(reason))
  ) {
    throw new Error(`legacy run snapshot phases[${index}] is invalid`);
  }
  return {
    ...expectedPrefix,
    status: status as DurablePhaseState['status'],
    reason: reason as string | null,
  };
}

function normalizePhaseState(
  value: unknown,
  definition: NormalizedDefinition,
  index: number,
): DurablePhaseState {
  const record = mapping(value, `run snapshot phases[${index}]`);
  rejectUnknownKeys(
    record,
    new Set([
      'sequence',
      'id',
      'description',
      'effectId',
      'status',
      'attemptsUsed',
      'nextAttemptAt',
      'reason',
    ]),
    `run snapshot phases[${index}]`,
  );
  const expected = initialState(definition, new Date(0).toISOString()).phases[
    index
  ]!;
  const status = dataValue(record, 'status');
  const reason = dataValue(record, 'reason');
  const attemptsUsed = dataValue(record, 'attemptsUsed');
  const nextAttemptValue = dataValue(record, 'nextAttemptAt');
  if (
    dataValue(record, 'sequence') !== index + 1 ||
    dataValue(record, 'id') !== expected.id ||
    dataValue(record, 'description') !== expected.description ||
    dataValue(record, 'effectId') !== expected.effectId ||
    !['pending', 'waiting', 'in-flight', 'completed'].includes(
      String(status),
    ) ||
    !Number.isSafeInteger(attemptsUsed) ||
    (attemptsUsed as number) < 0 ||
    (attemptsUsed as number) > definition.retryPolicy.maxAttempts ||
    (status === 'pending' && attemptsUsed !== 0) ||
    (status !== 'pending' && (attemptsUsed as number) < 1) ||
    (status === 'waiting') !== (nextAttemptValue !== null) ||
    (reason !== null && !isBoundedText(reason))
  )
    throw new Error(`run snapshot phases[${index}] is invalid`);
  return {
    ...expected,
    status: status as DurablePhaseState['status'],
    attemptsUsed: attemptsUsed as number,
    nextAttemptAt:
      nextAttemptValue === null
        ? null
        : timestamp(
            nextAttemptValue,
            `run snapshot phases[${index}].nextAttemptAt`,
          ),
    reason: reason as string | null,
  };
}

function snapshotEventSequence(value: unknown): number {
  const record = mapping(value, 'run snapshot');
  const sequence = dataValue(record, 'eventSequence');
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) {
    throw new Error('run snapshot eventSequence is invalid');
  }
  return sequence as number;
}

function normalizeDefinition(value: unknown): NormalizedDefinition {
  const record = mapping(value, 'durable run definition');
  rejectUnknownKeys(
    record,
    new Set(['runId', 'phases', 'retryPolicy']),
    'durable run definition',
  );
  const runId = identifier(dataValue(record, 'runId'), 'durable run id');
  const values = arrayValues(dataValue(record, 'phases'), MAX_PHASES);
  if (values === undefined || values.length === 0) {
    throw new Error(
      `durable run must define between 1 and ${MAX_PHASES} phases`,
    );
  }
  const phases = values.map((candidate, index) => {
    const phase = mapping(candidate, `durable phases[${index}]`);
    rejectUnknownKeys(
      phase,
      new Set(['id', 'description']),
      `durable phases[${index}]`,
    );
    return Object.freeze({
      id: identifier(dataValue(phase, 'id'), `durable phases[${index}].id`),
      description: boundedText(
        dataValue(phase, 'description'),
        `durable phases[${index}].description`,
      ),
    });
  });
  if (new Set(phases.map((phase) => phase.id)).size !== phases.length) {
    throw new Error('durable phase ids must be unique');
  }
  const policyValue = dataValue(record, 'retryPolicy');
  const retryPolicy =
    policyValue === undefined
      ? DEFAULT_RETRY_POLICY
      : normalizeRetryPolicy(policyValue, 'durable retryPolicy');
  const digestInput =
    policyValue === undefined
      ? { runId, phases }
      : { runId, phases, retryPolicy };
  const definitionSha256 = createHash('sha256')
    .update(JSON.stringify(digestInput))
    .digest('hex');
  return Object.freeze({
    runId,
    definitionSha256,
    phases: Object.freeze(phases),
    retryPolicy,
    hasExplicitRetryPolicy: policyValue !== undefined,
  });
}

function normalizeRetryPolicy(
  value: unknown,
  field: string,
): Readonly<DurableRetryPolicy> {
  const record = mapping(value, field);
  rejectUnknownKeys(
    record,
    new Set([
      'maxAttempts',
      'maxElapsedMs',
      'minimumIntervalMs',
      'initialBackoffMs',
      'backoffMultiplier',
      'maxBackoffMs',
    ]),
    field,
  );
  const policy = {
    maxAttempts: boundedInteger(
      dataValue(record, 'maxAttempts'),
      1,
      MAX_ATTEMPTS,
      `${field}.maxAttempts`,
    ),
    maxElapsedMs: boundedInteger(
      dataValue(record, 'maxElapsedMs'),
      1,
      MAX_ELAPSED_MS,
      `${field}.maxElapsedMs`,
    ),
    minimumIntervalMs: boundedInteger(
      dataValue(record, 'minimumIntervalMs'),
      0,
      MAX_DELAY_MS,
      `${field}.minimumIntervalMs`,
    ),
    initialBackoffMs: boundedInteger(
      dataValue(record, 'initialBackoffMs'),
      0,
      MAX_DELAY_MS,
      `${field}.initialBackoffMs`,
    ),
    backoffMultiplier: boundedInteger(
      dataValue(record, 'backoffMultiplier'),
      1,
      MAX_BACKOFF_MULTIPLIER,
      `${field}.backoffMultiplier`,
    ),
    maxBackoffMs: boundedInteger(
      dataValue(record, 'maxBackoffMs'),
      0,
      MAX_DELAY_MS,
      `${field}.maxBackoffMs`,
    ),
  };
  if (policy.maxBackoffMs < policy.initialBackoffMs) {
    throw new Error(
      `${field}.maxBackoffMs must not be less than initialBackoffMs`,
    );
  }
  return Object.freeze(policy);
}

function normalizeCallbacks(value: unknown): NormalizedCallbacks {
  const record = mapping(value, 'durable run callbacks');
  rejectUnknownKeys(
    record,
    new Set(['execute', 'reconcile']),
    'durable run callbacks',
  );
  const execute = dataValue(record, 'execute');
  const reconcile = dataValue(record, 'reconcile');
  if (typeof execute !== 'function' || typeof reconcile !== 'function') {
    throw new Error(
      'durable run callbacks must provide execute and reconcile functions',
    );
  }
  return Object.freeze({
    execute: execute as DurableRunCallbacks['execute'],
    reconcile: reconcile as DurableRunCallbacks['reconcile'],
    receiver: value as object,
  });
}

function normalizeOptions(
  value: unknown,
  definition: NormalizedDefinition,
): NormalizedOptions {
  const record = mapping(value, 'durable run options');
  rejectUnknownKeys(
    record,
    new Set(['pauseAfterPhase', 'onCheckpoint', 'clock', 'wait']),
    'durable run options',
  );
  const pause = dataValue(record, 'pauseAfterPhase');
  const hook = dataValue(record, 'onCheckpoint');
  const clock = dataValue(record, 'clock');
  const wait = dataValue(record, 'wait');
  if (
    pause !== undefined &&
    (typeof pause !== 'string' ||
      !definition.phases.some((phase) => phase.id === pause))
  ) {
    throw new Error('pauseAfterPhase must identify a configured phase');
  }
  if (hook !== undefined && typeof hook !== 'function') {
    throw new Error('onCheckpoint must be a function');
  }
  if (clock !== undefined && typeof clock !== 'function') {
    throw new Error('clock must be a function');
  }
  if (wait !== undefined && typeof wait !== 'function') {
    throw new Error('wait must be a function');
  }
  return Object.freeze({
    ...(pause === undefined ? {} : { pauseAfterPhase: pause }),
    ...(hook === undefined
      ? {}
      : { onCheckpoint: hook as DurableRunOptions['onCheckpoint'] }),
    clock: (clock as (() => number) | undefined) ?? Date.now,
    wait:
      (wait as ((milliseconds: number) => Promise<void>) | undefined) ??
      defaultWait,
  });
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function readClock(options: NormalizedOptions): number {
  let value: unknown;
  try {
    value = options.clock();
  } catch {
    throw new Error('durable pacing clock failed');
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_TIMESTAMP_MS - MAX_ELAPSED_MS
  ) {
    throw new Error('durable pacing clock returned an invalid timestamp');
  }
  return value as number;
}

function normalizeEffectResult(
  value: unknown,
  secrets: readonly string[],
): DurableEffectResult | undefined {
  try {
    const record = mapping(value, 'adapter result');
    rejectUnknownKeys(
      record,
      new Set(['kind', 'reason', 'retryAfterMs']),
      'adapter result',
    );
    const kind = dataValue(record, 'kind');
    const reason = dataValue(record, 'reason');
    const retryAfter = dataValue(record, 'retryAfterMs');
    if (
      (kind !== 'applied' && kind !== 'retryable') ||
      !isBoundedText(reason) ||
      (kind === 'applied' && retryAfter !== undefined)
    ) {
      return undefined;
    }
    const redactedReason = redactSecrets(reason, secrets);
    if (!isBoundedText(redactedReason)) return undefined;
    if (kind === 'applied')
      return Object.freeze({ kind, reason: redactedReason });
    return Object.freeze({
      kind,
      reason: redactedReason,
      ...(retryAfter === undefined
        ? {}
        : {
            retryAfterMs: boundedInteger(
              retryAfter,
              0,
              MAX_DELAY_MS,
              'adapter result retryAfterMs',
            ),
          }),
    });
  } catch {
    return undefined;
  }
}

function normalizeReconciliationResult(
  value: unknown,
  secrets: readonly string[],
): DurableReconciliationResult | undefined {
  return normalizeAdapterResult(
    value,
    new Set(['applied', 'not-applied', 'ambiguous']),
    secrets,
  ) as DurableReconciliationResult | undefined;
}

function normalizeAdapterResult(
  value: unknown,
  kinds: ReadonlySet<string>,
  secrets: readonly string[],
): { kind: string; reason: string } | undefined {
  try {
    const record = mapping(value, 'adapter result');
    rejectUnknownKeys(record, new Set(['kind', 'reason']), 'adapter result');
    const kind = dataValue(record, 'kind');
    const reason = dataValue(record, 'reason');
    if (typeof kind !== 'string' || !kinds.has(kind) || !isBoundedText(reason))
      return undefined;
    const redactedReason = redactSecrets(reason, secrets);
    if (!isBoundedText(redactedReason)) return undefined;
    return Object.freeze({ kind, reason: redactedReason });
  } catch {
    return undefined;
  }
}

async function resolveRunPaths(
  projectDirectory: string,
  definition: NormalizedDefinition,
): Promise<ResolvedRun> {
  const root = await realpath(path.resolve(projectDirectory));
  if (!(await stat(root)).isDirectory())
    throw new Error('project directory must be a directory');
  const state = path.join(root, '.autocode');
  const runs = path.join(state, 'runs');
  await requireRealDirectory(state, 'state directory');
  const runsReal = await requireRealDirectory(runs, 'runs directory');
  if (path.dirname(runsReal) !== (await realpath(state)))
    throw new Error('runs directory escapes state directory');
  const workspaceSecrets = (await discoverWorkspaceCredentials(root)).secrets;
  assertDefinitionContainsNoSecrets(definition, workspaceSecrets);
  const relativeRun = `.autocode/runs/durable-${definition.runId}`;
  await assertRunArtifactsIgnored(root, relativeRun);
  const run = path.join(runs, `durable-${definition.runId}`);
  let created = false;
  try {
    await mkdir(run);
    created = true;
  } catch (error: unknown) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const runReal = await requireRealDirectory(run, 'durable run directory');
  if (path.dirname(runReal) !== runsReal)
    throw new Error('durable run directory escapes runs directory');
  if (created) await syncDirectory(runsReal);
  return {
    paths: {
      root,
      runs: runsReal,
      run: runReal,
      state: path.join(runReal, 'run.json'),
      events: path.join(runReal, 'events.jsonl'),
      lock: path.join(runReal, LOCK_DIRECTORY),
    },
    workspaceSecrets,
  };
}

function assertDefinitionContainsNoSecrets(
  definition: NormalizedDefinition,
  secrets: readonly string[],
): void {
  if (redactSecrets(definition.runId, secrets) !== definition.runId) {
    throw new Error('durable run id must not contain credentials');
  }
  for (const phase of definition.phases) {
    if (
      redactSecrets(phase.id, secrets) !== phase.id ||
      redactSecrets(phase.description, secrets) !== phase.description
    ) {
      throw new Error('durable phase definition must not contain credentials');
    }
  }
}

async function assertRunArtifactsIgnored(
  root: string,
  relativeRun: string,
): Promise<void> {
  const tracked = await gitOutput(root, ['ls-files', '-z', '--', relativeRun]);
  if (tracked.length > 0) {
    throw new Error('durable run artifacts must not be tracked by Git');
  }
  const ignored = await gitExitCode(root, [
    'check-ignore',
    '--quiet',
    '--no-index',
    '--',
    relativeRun,
  ]);
  if (ignored !== 0) {
    if (ignored === 1)
      throw new Error('durable run artifacts must be gitignored');
    throw new Error('could not verify durable run ignore coverage');
  }
}

function gitOutput(
  root: string,
  arguments_: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      arguments_,
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function gitExitCode(
  root: string,
  arguments_: readonly string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      arguments_,
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 4096,
        windowsHide: true,
      },
      (error) => {
        if (error === null) {
          resolve(0);
          return;
        }
        if (typeof error.code === 'number') {
          resolve(error.code);
          return;
        }
        reject(error);
      },
    );
  });
}

async function acquireLock(paths: RunPaths): Promise<() => Promise<void>> {
  const processIdentity = await ownProcessIdentity();
  if (processIdentity === undefined) {
    throw new Error('could not determine durable lock process identity');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    const candidate = path.join(
      paths.run,
      `.run.lock-candidate-${process.pid}-${token}`,
    );
    await mkdir(candidate);
    const owner = {
      version: 1,
      hostname: os.hostname(),
      pid: process.pid,
      processIdentity,
      token,
    };
    try {
      await openWriteExclusive(
        path.join(candidate, LOCK_OWNER_FILE),
        `${JSON.stringify(owner)}\n`,
      );
      await rename(candidate, paths.lock);
    } catch (error: unknown) {
      await removeLockCandidate(candidate);
      if (!(await pathExists(paths.lock))) throw error;
      if (!(await reclaimDeadLocalLock(paths))) {
        throw new Error(
          `durable run ${path.basename(paths.run)} is already locked`,
          { cause: error },
        );
      }
      continue;
    }
    return async () => releaseLock(paths, token);
  }
  throw new Error('could not acquire durable run lock');
}

async function removeLockCandidate(candidate: string): Promise<void> {
  try {
    await unlinkIfPresent(path.join(candidate, LOCK_OWNER_FILE));
    await rmdir(candidate);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

async function reclaimDeadLocalLock(paths: RunPaths): Promise<boolean> {
  const lockReal = await requireRealDirectory(
    paths.lock,
    'durable run lock directory',
  );
  if (lockReal !== paths.lock || path.dirname(lockReal) !== paths.run) {
    throw new Error('durable run lock directory identity changed');
  }
  const ownerPath = path.join(paths.lock, LOCK_OWNER_FILE);
  let owner: unknown;
  try {
    owner = JSON.parse(
      await readBoundedFile(ownerPath, 4096, 'run lock owner'),
    );
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) {
      const stale = `${paths.lock}.stale-${process.pid}-${randomUUID()}`;
      try {
        await rename(paths.lock, stale);
      } catch (renameError: unknown) {
        if (hasCode(renameError, 'ENOENT')) return true;
        throw renameError;
      }
      await rmdir(stale);
      return true;
    }
    throw new Error('run lock owner is invalid', { cause: error });
  }
  const record = mapping(owner, 'run lock owner');
  rejectUnknownKeys(
    record,
    new Set(['version', 'hostname', 'pid', 'processIdentity', 'token']),
    'run lock owner',
  );
  const pid = dataValue(record, 'pid');
  const storedProcessIdentity = dataValue(record, 'processIdentity');
  if (
    dataValue(record, 'version') !== 1 ||
    dataValue(record, 'hostname') !== os.hostname() ||
    !Number.isSafeInteger(pid) ||
    (pid as number) <= 0 ||
    !isBoundedText(storedProcessIdentity) ||
    Buffer.byteLength(storedProcessIdentity) > MAX_PROCESS_IDENTITY_BYTES ||
    typeof dataValue(record, 'token') !== 'string'
  )
    return false;
  if (processAlive(pid as number)) {
    const currentProcessIdentity =
      pid === process.pid
        ? await ownProcessIdentity()
        : await readProcessIdentity(pid as number);
    if (
      currentProcessIdentity === undefined ||
      currentProcessIdentity === storedProcessIdentity
    ) {
      return false;
    }
  }
  const stale = `${paths.lock}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(paths.lock, stale);
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return true;
    throw error;
  }
  await unlink(path.join(stale, LOCK_OWNER_FILE));
  await rmdir(stale);
  return true;
}

async function releaseLock(paths: RunPaths, token: string): Promise<void> {
  const ownerPath = path.join(paths.lock, LOCK_OWNER_FILE);
  const owner = mapping(
    JSON.parse(await readBoundedFile(ownerPath, 4096, 'run lock owner')),
    'run lock owner',
  );
  if (
    dataValue(owner, 'token') !== token ||
    dataValue(owner, 'pid') !== process.pid
  ) {
    throw new Error('durable run lock ownership changed before release');
  }
  const released = `${paths.lock}.released-${process.pid}-${randomUUID()}`;
  await rename(paths.lock, released);
  await unlink(path.join(released, LOCK_OWNER_FILE));
  await rmdir(released);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasCode(error, 'ESRCH');
  }
}

function ownProcessIdentity(): Promise<string | undefined> {
  ownProcessIdentityPromise ??= readProcessIdentity(process.pid);
  return ownProcessIdentityPromise;
}

async function readProcessIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (process.platform === 'linux') {
    try {
      const [statContents, bootIdContents] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      ]);
      const closingParenthesis = statContents.lastIndexOf(')');
      if (closingParenthesis < 0) return undefined;
      const fields = statContents
        .slice(closingParenthesis + 1)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19];
      const bootId = bootIdContents.trim();
      if (
        startTicks === undefined ||
        !/^\d+$/.test(startTicks) ||
        !/^[0-9a-f-]{36}$/i.test(bootId)
      ) {
        return undefined;
      }
      return `linux:${bootId}:${startTicks}`;
    } catch {
      return undefined;
    }
  }
  if (process.platform === 'darwin') {
    const startedAt = await executeIdentityCommand('/bin/ps', [
      '-o',
      'lstart=',
      '-p',
      String(pid),
    ]);
    return startedAt === undefined ? undefined : `darwin:${startedAt}`;
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'];
    if (typeof systemRoot !== 'string' || !path.isAbsolute(systemRoot))
      return undefined;
    const executable = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const startedAt = await executeIdentityCommand(executable, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks`,
    ]);
    return startedAt === undefined ? undefined : `win32:${startedAt}`;
  }
  return undefined;
}

function executeIdentityCommand(
  executable: string,
  arguments_: readonly string[],
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      executable,
      arguments_,
      {
        encoding: 'utf8',
        maxBuffer: MAX_PROCESS_IDENTITY_BYTES,
        timeout: 2_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined);
          return;
        }
        const value = stdout.trim();
        resolve(
          value.length > 0 &&
            Buffer.byteLength(value) <= MAX_PROCESS_IDENTITY_BYTES &&
            !hasControl(value)
            ? value
            : undefined,
        );
      },
    );
  });
}

async function syncDirectory(target: string): Promise<void> {
  // Node cannot flush Windows directory handles; synced files and atomic rename
  // provide the strongest publication primitive exposed by the runtime there.
  if (process.platform === 'win32') return;
  const handle = await open(target, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertRunIdentity(paths: RunPaths): Promise<void> {
  const runReal = await requireRealDirectory(
    paths.run,
    'durable run directory',
  );
  if (runReal !== paths.run || path.dirname(runReal) !== paths.runs) {
    throw new Error('durable run directory identity changed');
  }
}

async function requireRealDirectory(
  target: string,
  field: string,
): Promise<string> {
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`${field} must be a real directory`);
  return realpath(target);
}

async function readJsonIfPresent(
  target: string,
  maximum: number,
  field: string,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readBoundedFile(target, maximum, field));
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return undefined;
    if (error instanceof SyntaxError)
      throw new Error(`${field} contains invalid JSON`, { cause: error });
    throw error;
  }
}

async function readBoundedFile(
  target: string,
  maximum: number,
  field: string,
): Promise<string> {
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(`${field} must be a real file`);
  if (info.size > maximum) throw new Error(`${field} exceeds ${maximum} bytes`);
  return readFile(target, 'utf8');
}

async function openRegularFile(target: string, flags: string, field: string) {
  await rejectSymbolicLink(target, field);
  const handle = await open(target, flags);
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    throw new Error(`${field} must be a real file`);
  }
  return handle;
}

async function openWriteExclusive(
  target: string,
  contents: string,
): Promise<void> {
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function rejectSymbolicLink(
  target: string,
  field: string,
): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new Error(`${field} must not be a symbolic link`);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

async function unlinkIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function finish(
  paths: RunPaths,
  state: DurableRunState,
): Readonly<DurableRunResult> {
  const frozen = freezeState(state);
  return Object.freeze({
    runDirectory: paths.run,
    outcome: frozen.status as DurableRunResult['outcome'],
    state: frozen,
  });
}

function freezeState(state: DurableRunState): Readonly<DurableRunState> {
  const phases = state.phases.map((phase) => Object.freeze({ ...phase }));
  return Object.freeze({
    ...state,
    retryPolicy: Object.freeze({ ...state.retryPolicy }),
    phases: Object.freeze(phases),
  });
}

function phaseById(state: DurableRunState, id: string): DurablePhaseState {
  const phase = state.phases.find((candidate) => candidate.id === id);
  if (phase === undefined) throw new Error(`unknown durable phase: ${id}`);
  return phase;
}

function mapping(value: unknown, field: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    throw new Error(`${field} must be a plain mapping`);
  }
  const record: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new Error(`${field} must expose plain data properties`);
  }
  for (const key of keys) {
    if (typeof key !== 'string')
      throw new Error(`${field} keys must be strings`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor))
      throw new Error(`${field} must expose plain data properties`);
    record[key] = descriptor.value;
  }
  return record;
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function arrayValues(value: unknown, maximum: number): unknown[] | undefined {
  try {
    if (!Array.isArray(value) || utilTypes.isProxy(value)) return undefined;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
      return undefined;
    const allowed = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(value).some(
        (key) => typeof key !== 'string' || !allowed.has(key),
      )
    )
      return undefined;
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

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected !== undefined)
    throw new Error(`unknown ${field} key: ${unexpected}`);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value))
    throw new Error(`${field} is invalid`);
  return value;
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw new Error(`${field} is invalid`);
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(
      `${field} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value as number;
}

function boundedText(value: unknown, field: string): string {
  if (!isBoundedText(value))
    throw new Error(`${field} must be a non-empty bounded string`);
  return value;
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    Buffer.byteLength(value) <= MAX_TEXT_BYTES &&
    !hasControl(value)
  );
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (
      point !== undefined &&
      (point <= 0x1f || (point >= 0x7f && point <= 0x9f))
    )
      return true;
  }
  return false;
}

function timestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
