import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { gitInspectionArguments } from './git-inspection.js';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { CONFIG_FILE, validateConfig } from './config.js';
import { loadTaskCatalog, selectProjectTask } from './tasks.js';
import { prepareImplementationPlan } from './planning.js';
import {
  CodexStateTamperingError,
  assertCredentialFilesUnchanged,
  assertDirectoryUnchanged,
  discoverWorkspaceCredentials,
  redactSecrets,
  runPreparedCodexRole,
  snapshotDirectory,
  type CodexSessionOptions,
  type CodexSessionRecord,
} from './codex.js';
import {
  runDeterministicVerification,
  snapshotWorktree,
  VerificationStateTamperingError,
} from './verification.js';
import {
  runDurableRun,
  type DurableRunOptions,
  type DurableEffectResult,
  type DurableRunResult,
} from './durable-run.js';
import {
  runQaPhase,
  validateQaDecision,
  type QaCallbacks,
  type QaDecision,
} from './qa.js';
import {
  evaluateCompletionGates,
  type CompletionGateInput,
} from './completion-gates.js';
import {
  assertContainedQaAdapter,
  assertSecureProcessPlatform,
} from './qa-process.js';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
class WorkflowReceiptTamperingError extends Error {
  constructor() {
    super('protected workflow receipt already exists during fresh execution');
  }
}
const PAYLOAD_TEXT_FIELDS = new Set([
  'reason',
  'summary',
  'plan',
  'command',
  'arguments',
  'runDirectory',
  'name',
  'description',
  'artifactReferences',
]);

/** Operator policy is protected state, never model output. Missing policy blocks. */
export interface WorkflowPolicy {
  version: 1;
  qa?: QaDecision;
  pullRequest?: { kind: 'not-applicable'; reason: string };
  completion?: CompletionGateInput;
}

export interface WorkflowOptions {
  resumeOnly?: boolean;
  codex?: CodexSessionOptions;
  durable?: DurableRunOptions;
  /** Must be created by createContainedQaAdapter; plain callbacks fail preflight. */
  qa?: QaCallbacks;
}

interface ReviewVerdict {
  outcome: 'passed' | 'changes-requested' | 'blocked';
  findings: {
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    summary: string;
  }[];
}

interface Receipt {
  version: 1;
  phaseId: string;
  binding: string;
  workspace: string;
  result: DurableEffectResult;
  evidence: unknown;
}

/** One prepared task, finite ordered rounds, no automatic Git or remote effects. */
export async function runProjectWorkflow(
  projectDirectory: string,
  options: WorkflowOptions = {},
): Promise<Readonly<DurableRunResult>> {
  assertSecureProcessPlatform();
  const root = await realpath(projectDirectory);
  const selected = await selectProjectTask(root);
  if (selected.kind !== 'selected')
    throw new Error('workflow requires one dependency-ready ready task');
  const task = selected.task;
  const head = await git(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = await git(root, ['branch', '--show-current']);
  const runId = `workflow-${task.taskId.toLowerCase()}-${head.slice(0, 12)}`;
  if (
    options.resumeOnly &&
    (await optionalRead(root, `.autocode/runs/durable-${runId}/run.json`)) ===
      undefined &&
    (await optionalRead(
      root,
      `.autocode/runs/durable-${runId}/events.jsonl`,
    )) === undefined
  )
    throw new Error(
      'resume requires an existing workflow run for the selected task and commit',
    );
  if (branch === 'main' || branch !== task.branch)
    throw new Error('workflow requires the declared isolated feature branch');
  if (
    (await git(root, ['rev-parse', '--git-dir'])) ===
    (await git(root, ['rev-parse', '--git-common-dir']))
  )
    throw new Error('workflow requires a linked worktree');
  const configText = await safeRead(root, CONFIG_FILE);
  const config = validateConfig(parse(configText));
  if (config.fixLoop.maxAttempts > 19)
    throw new Error(
      'integrated workflow supports at most 19 fix rounds within the 64-phase limit',
    );
  if (config.verification.commands.length === 0)
    throw new Error('workflow requires configured deterministic checks');
  const policyText = await optionalRead(root, '.autocode/workflow.json');
  const policy = parsePolicy(policyText);
  if (policy.qa?.kind === 'required' && options.qa)
    assertContainedQaAdapter(root, options.qa);
  const taskPolicy = parse(
    /^---\r?\n([\s\S]*?)\r?\n---/.exec(task.contents)![1]!,
  );
  if (taskPolicy.qa === 'required' && policy.qa?.kind === 'not-applicable')
    throw new Error('operator policy cannot bypass task-required QA');
  if (
    taskPolicy.deployment === 'required' &&
    policy.completion?.production.kind === 'not-applicable'
  )
    throw new Error(
      'operator policy cannot bypass task-required production verification',
    );
  const preparedRelative = `.autocode/runs/${task.taskId}-${head.slice(0, 12)}`;
  if (
    (await optionalRead(root, `${preparedRelative}/planning.json`)) ===
    undefined
  )
    await prepareImplementationPlan(root);
  const planning = JSON.parse(
    await safeRead(root, `${preparedRelative}/planning.json`),
  );
  if (
    planning.taskId !== task.taskId ||
    planning.branch !== branch ||
    planning.headCommit !== head ||
    planning.taskSha256 !== hash(task.contents) ||
    (await safeRead(root, `${preparedRelative}/task.md`)) !== task.contents
  )
    throw new Error('workflow preparation is stale');
  const initialPlan = await safeRead(root, `${preparedRelative}/plan.md`);
  const binding = hash(
    JSON.stringify({
      processContainment: 'windows-appcontainer-job-v4',
      head,
      branch,
      task: hash(task.contents),
      config: hash(configText),
      policy: hash(policyText ?? ''),
      plan: hash(initialPlan),
    }),
  );
  const receiptDirectory = `.autocode/runs/durable-${runId}`;
  const phaseIds = ['planning', 'implementation'];
  for (let round = 0; round <= config.fixLoop.maxAttempts; round++) {
    if (round > 0) phaseIds.push(`fix-${round}`);
    phaseIds.push(`verify-${round}`, `review-${round}`);
  }
  phaseIds.push('qa', 'completion');

  async function currentWorkspace(): Promise<string> {
    if (
      (await git(root, ['rev-parse', '--verify', 'HEAD'])) !== head ||
      (await git(root, ['branch', '--show-current'])) !== branch
    )
      throw new Error('workflow Git identity changed');
    const catalog = await loadTaskCatalog(root);
    if (
      catalog.find((entry) => entry.taskId === task.taskId)?.contents !==
        task.contents ||
      (await selectProjectTask(root)).kind !== 'selected'
    )
      throw new Error('workflow task or readiness changed');
    if (
      (await safeRead(root, CONFIG_FILE)) !== configText ||
      (await optionalRead(root, '.autocode/workflow.json')) !== policyText ||
      (await safeRead(root, `${preparedRelative}/plan.md`)) !== initialPlan
    )
      throw new Error('workflow configuration or prepared plan changed');
    const credentials = await discoverWorkspaceCredentials(root);
    return hash(
      JSON.stringify({
        worktree: await snapshotWorktree(root),
        credentials: [...credentials.files].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      }),
    );
  }

  async function receipt(phaseId: string): Promise<Receipt | undefined> {
    const text = await optionalRead(
      root,
      `${receiptDirectory}/${phaseId}.json`,
    );
    if (text === undefined) return undefined;
    const value = JSON.parse(text) as Receipt;
    if (
      value.version !== 1 ||
      value.phaseId !== phaseId ||
      value.binding !== binding ||
      !/^[a-f0-9]{64}$/.test(value.workspace) ||
      !['applied', 'blocked', 'failed'].includes(value.result?.kind) ||
      typeof value.result.reason !== 'string' ||
      value.result.reason.length === 0
    )
      throw new Error('invalid workflow receipt');
    return value;
  }

  async function latest(): Promise<Receipt | undefined> {
    let last: Receipt | undefined;
    for (const id of phaseIds) {
      const candidate = await receipt(id);
      if (candidate === undefined) break;
      last = candidate;
    }
    return last;
  }

  async function save(
    phaseId: string,
    result: DurableEffectResult,
    evidence: unknown,
  ): Promise<void> {
    const workspace = await currentWorkspace();
    const credentials = await discoverWorkspaceCredentials(root);
    const value: Receipt = {
      version: 1,
      phaseId,
      binding,
      workspace,
      result: {
        ...result,
        reason: redactSecrets(result.reason, credentials.secrets),
      },
      evidence: redactWorkflowPayload(evidence, credentials.secrets),
    };
    const contents = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(contents) > MAX_FILE_BYTES)
      throw new Error('workflow evidence exceeds limit');
    const destination = await safePath(
      root,
      `${receiptDirectory}/${phaseId}.json`,
      false,
    );
    const temporary = `${destination}.tmp-${randomUUID()}`;
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${contents}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await safePath(root, receiptDirectory, true);
    try {
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new WorkflowReceiptTamperingError();
      throw error;
    } finally {
      await unlink(temporary);
    }
  }

  async function roundPassed(round: number): Promise<boolean> {
    const verification = await receipt(`verify-${round}`);
    const review = await receipt(`review-${round}`);
    return (
      verification?.workspace === review?.workspace &&
      (verification?.evidence as { passed?: boolean })?.passed === true &&
      (review?.evidence as ReviewVerdict)?.outcome === 'passed'
    );
  }

  async function anyPassed(): Promise<boolean> {
    for (let round = 0; round <= config.fixLoop.maxAttempts; round++)
      if (await roundPassed(round)) return true;
    return false;
  }

  async function assertFreshSession(record: CodexSessionRecord): Promise<void> {
    for (const id of phaseIds) {
      const stored = (await receipt(id))?.evidence as
        { record?: CodexSessionRecord; sessionId?: string } | undefined;
      if ((stored?.record?.sessionId ?? stored?.sessionId) === record.sessionId)
        throw new Error(
          'all integrated Codex roles require fresh distinct session identities',
        );
    }
  }

  const existing = await latest();
  if (existing && existing.workspace !== (await currentWorkspace()))
    throw new Error('workflow evidence is stale after workspace changes');
  const result = await runDurableRun(
    root,
    {
      runId,
      phases: phaseIds.map((id) => ({
        id,
        description: `${id} for binding ${binding}`,
      })),
    },
    {
      async execute(phase, context) {
        try {
          // Only reconciliation may reuse a receipt for an already in-flight effect.
          if (
            (await optionalRead(
              root,
              `${receiptDirectory}/${phase.id}.json`,
            )) !== undefined
          )
            throw new WorkflowReceiptTamperingError();
          const previous = await latest();
          if (previous && previous.workspace !== (await currentWorkspace()))
            return {
              kind: 'blocked',
              reason: 'workspace changed; evidence requires a new run',
            };
          let result: DurableEffectResult = {
            kind: 'applied',
            reason: `${phase.id} evidence retained`,
          };
          let evidence: unknown;
          if (
            phase.id === 'planning' ||
            phase.id === 'implementation' ||
            phase.id.startsWith('fix-')
          ) {
            if (phase.id.startsWith('fix-') && (await anyPassed()))
              evidence = { skipped: true, reason: 'an earlier round passed' };
            else {
              const role = phase.id.startsWith('fix-')
                ? 'fix'
                : (phase.id as CodexSessionRecord['role']);
              const previousRound =
                role === 'fix' ? Number(phase.id.slice(4)) - 1 : undefined;
              const context =
                previousRound === undefined
                  ? undefined
                  : JSON.stringify({
                      verification: (await receipt(`verify-${previousRound}`))
                        ?.evidence,
                      review: (await receipt(`review-${previousRound}`))
                        ?.evidence,
                    });
              const generatedPlan =
                role === 'planning'
                  ? undefined
                  : ((await receipt('planning'))?.evidence as { plan?: string })
                      ?.plan;
              const record = await runPreparedCodexRole(
                root,
                role,
                `workflow-${phase.id}`,
                {
                  ...options.codex,
                  ...(context === undefined ? {} : { fixContext: context }),
                  ...(generatedPlan === undefined
                    ? {}
                    : { planContent: generatedPlan }),
                },
              );
              await assertFreshSession(record);
              evidence = record;
              if (role === 'planning')
                evidence = {
                  record,
                  plan: await safeRead(
                    root,
                    `${preparedRelative}/workflow-planning/planning/final.txt`,
                  ),
                };
            }
          } else if (phase.id.startsWith('verify-')) {
            if (await anyPassed())
              evidence = { skipped: true, reason: 'an earlier round passed' };
            else {
              try {
                evidence = await runDeterministicVerification(root, {
                  evidenceName: `workflow-${phase.id}`,
                  retainFailure: true,
                  taskId: task.taskId,
                });
              } catch (error) {
                if (error instanceof VerificationStateTamperingError)
                  return { kind: 'failed', reason: error.message };
                throw error;
              }
            }
          } else if (phase.id.startsWith('review-')) {
            if (await anyPassed())
              evidence = { skipped: true, reason: 'an earlier round passed' };
            else {
              const round = Number(phase.id.slice(7));
              const verification = (await receipt(`verify-${round}`))
                ?.evidence as { passed?: boolean } | undefined;
              if (verification?.passed === false)
                evidence = {
                  outcome: 'changes-requested',
                  findings: [],
                  reason:
                    'deterministic checks failed; independent review deferred until fresh checks pass',
                };
              else {
                let verdict: ReviewVerdict | undefined;
                const record = await runPreparedCodexRole(
                  root,
                  'review',
                  `workflow-${phase.id}`,
                  {
                    ...options.codex,
                    validateFinalMessage(message) {
                      verdict = parseReview(message);
                    },
                  },
                );
                await assertFreshSession(record);
                if (verdict === undefined)
                  throw new Error(
                    'independent review did not retain a validated verdict',
                  );
                if (
                  record.sessionId ===
                  (
                    (await receipt('implementation'))
                      ?.evidence as CodexSessionRecord
                  )?.sessionId
                )
                  throw new Error('review must be independent');
                evidence = { ...verdict, record };
                if (verdict.outcome === 'blocked')
                  result = {
                    kind: 'blocked',
                    reason: 'independent review requires operator input',
                  };
              }
            }
          } else if (phase.id === 'qa') {
            if (!(await anyPassed()))
              result = {
                kind: 'failed',
                reason:
                  'bounded fix rounds exhausted without passing verification and review',
              };
            else if (!policy.qa)
              result = {
                kind: 'blocked',
                reason: 'explicit QA applicability policy is required',
              };
            else if (policy.qa.kind === 'required' && !options.qa) {
              result = {
                kind: 'blocked',
                reason: 'required QA needs a scenario adapter',
              };
              // This receipt proves only this attempt stopped before any QA callback.
              await save(`qa-awaiting-adapter-${context.attempt}`, result, {
                prerequisite: 'qa-adapter',
                effectId: context.effectId,
                attempt: context.attempt,
              });
              return result;
            } else {
              const beforeQa = await currentWorkspace();
              const credentialsBeforeQa =
                await discoverWorkspaceCredentials(root);
              const stateDirectory = await safePath(root, '.autocode', true);
              const ignoredStateEntries = new Set<string>();
              const stateSnapshot = await snapshotDirectory(
                stateDirectory,
                ignoredStateEntries,
              );
              evidence = await runQaPhase(
                policy.qa,
                policy.qa.kind === 'required' ? options.qa : undefined,
              );
              try {
                await assertCredentialFilesUnchanged(
                  root,
                  credentialsBeforeQa.files,
                );
              } catch {
                return {
                  kind: 'failed',
                  reason: 'QA changed protected credential state',
                };
              }
              try {
                await safePath(root, '.autocode', true);
                await assertDirectoryUnchanged(
                  stateDirectory,
                  stateSnapshot,
                  ignoredStateEntries,
                );
              } catch {
                return {
                  kind: 'failed',
                  reason: 'QA changed protected AutoCode state',
                };
              }
              if (beforeQa !== (await currentWorkspace()))
                result = {
                  kind: 'blocked',
                  reason:
                    'QA changed the workspace; fresh verification and review are required in a new run',
                };
              const outcome = (evidence as { outcome: string }).outcome;
              if (outcome === 'failed' || outcome === 'blocked')
                result = {
                  kind: outcome,
                  reason: 'QA did not pass; operator disposition is required',
                };
            }
          } else {
            if (
              !policy.pullRequest ||
              taskPolicy.pull_request !== 'not_applicable'
            )
              result = {
                kind: 'blocked',
                reason:
                  'PR publication and exact-head remote review/merge gates require an external adapter; no automatic remote effects are configured',
              };
            else if (!policy.completion)
              result = {
                kind: 'blocked',
                reason:
                  'configured completion and production applicability evidence is required',
              };
            else if (policy.completion.production.kind === 'required')
              result = {
                kind: 'blocked',
                reason:
                  'required production verification needs an external deployment adapter and committed implementation identity',
              };
            else {
              evidence = evaluateCompletionGates(policy.completion);
              if (policy.completion.merge.headCommit !== head)
                result = {
                  kind: 'blocked',
                  reason: 'completion policy is bound to a different commit',
                };
              else if ((evidence as { outcome: string }).outcome !== 'passed')
                result = {
                  kind: (evidence as { outcome: 'blocked' | 'failed' }).outcome,
                  reason: 'configured completion gates did not pass',
                };
            }
          }
          await save(phase.id, result, evidence ?? { reason: result.reason });
          return result;
        } catch (error) {
          if (
            error instanceof CodexStateTamperingError ||
            error instanceof WorkflowReceiptTamperingError
          )
            return { kind: 'failed', reason: error.message };
          throw error;
        }
      },
      async reconcile(phase, context) {
        const own = await receipt(phase.id);
        if (
          phase.id !== 'qa' &&
          phase.id !== 'completion' &&
          own &&
          own.workspace === (await currentWorkspace()) &&
          own.result.kind === 'applied'
        )
          return {
            kind: 'applied',
            reason: 'validated completed phase receipt; effect is not repeated',
          };
        if (
          phase.id === 'qa' &&
          !own &&
          policy.qa?.kind === 'required' &&
          options.qa
        ) {
          const waiting = await receipt(
            `qa-awaiting-adapter-${context.attempt}`,
          );
          const evidence = waiting?.evidence as
            | { prerequisite?: string; effectId?: string; attempt?: number }
            | undefined;
          if (
            waiting?.result.kind === 'blocked' &&
            waiting.workspace === (await currentWorkspace()) &&
            evidence?.prerequisite === 'qa-adapter' &&
            evidence.effectId === context.effectId &&
            evidence.attempt === context.attempt
          )
            return {
              kind: 'not-applied',
              reason:
                'QA adapter supplied; the recorded attempt invoked no QA callback',
            };
        }
        return {
          kind: 'ambiguous',
          reason:
            phase.id === 'qa'
              ? 'QA callback completion cannot be established from a mutable receipt; operator reconciliation is required'
              : phase.id === 'completion'
                ? 'completion gate results cannot be established from a mutable receipt; operator reconciliation is required'
                : 'interrupted or blocked phase lacks successful current evidence; operator reconciliation is required',
        };
      },
    },
    options.durable,
  );
  await currentWorkspace();
  return result;
}

function parsePolicy(text: string | undefined): WorkflowPolicy {
  if (text === undefined) return { version: 1 };
  const value = JSON.parse(text);
  if (
    !value ||
    value.version !== 1 ||
    Object.keys(value).some(
      (key) => !['version', 'qa', 'pullRequest', 'completion'].includes(key),
    )
  )
    throw new Error('invalid operator workflow policy');
  if (
    Object.hasOwn(value, 'pullRequest') &&
    (!value.pullRequest ||
      Object.keys(value.pullRequest).some(
        (key) => !['kind', 'reason'].includes(key),
      ) ||
      value.pullRequest.kind !== 'not-applicable' ||
      typeof value.pullRequest.reason !== 'string' ||
      Buffer.byteLength(value.pullRequest.reason.trim()) < 16)
  )
    throw new Error('PR exception requires a substantive operator reason');
  if (Object.hasOwn(value, 'qa')) value.qa = validateQaDecision(value.qa);
  if (Object.hasOwn(value, 'completion'))
    evaluateCompletionGates(value.completion);
  return value;
}

export function parseReview(text: string): ReviewVerdict {
  const value = JSON.parse(text);
  if (
    !value ||
    Object.keys(value).some((key) => !['outcome', 'findings'].includes(key)) ||
    !['passed', 'changes-requested', 'blocked'].includes(value.outcome) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 64
  )
    throw new Error('invalid structured independent review');
  const ids = new Set<string>();
  for (const finding of value.findings) {
    if (
      !finding ||
      Object.keys(finding).some(
        (key) => !['id', 'severity', 'summary'].includes(key),
      ) ||
      typeof finding.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(finding.id) ||
      ids.has(finding.id) ||
      !['low', 'medium', 'high', 'critical'].includes(finding.severity) ||
      typeof finding.summary !== 'string' ||
      finding.summary.trim().length === 0 ||
      Buffer.byteLength(finding.summary) > 4096
    )
      throw new Error('invalid independent review finding');
    ids.add(finding.id);
  }
  if (
    (value.outcome === 'passed' && value.findings.length !== 0) ||
    (value.outcome === 'changes-requested' && value.findings.length === 0)
  )
    throw new Error('review verdict conflicts with findings');
  return value;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Redact payload text, never JSON syntax, validated controls, or freshness metadata. */
function redactWorkflowPayload(
  value: unknown,
  secrets: readonly string[],
  field = '',
): unknown {
  if (typeof value === 'string') {
    if (field === 'id' && redactSecrets(value, secrets) !== value)
      return `redacted-${hash(value).slice(0, 24)}`;
    return PAYLOAD_TEXT_FIELDS.has(field)
      ? redactSecrets(value, secrets)
      : value;
  }
  if (Array.isArray(value))
    return value.map((entry) => redactWorkflowPayload(entry, secrets, field));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactWorkflowPayload(entry, secrets, key),
      ]),
    );
  return value;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    gitInspectionArguments(root, args),
    {
      cwd: root,
      windowsHide: true,
      maxBuffer: MAX_FILE_BYTES,
    },
  );
  return stdout.trim();
}

async function safePath(
  root: string,
  relative: string,
  mustExist: boolean,
): Promise<string> {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new Error('workflow path escapes project');
  const segments = path.relative(root, target).split(path.sep);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (
        stats.isSymbolicLink() ||
        (index < segments.length - 1 && !stats.isDirectory())
      )
        throw new Error('workflow path contains unsafe entry');
      if ((await realpath(current)) !== current)
        throw new Error('workflow path identity changed');
    } catch (error) {
      if (
        !mustExist &&
        index === segments.length - 1 &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return target;
      throw error;
    }
  }
  return target;
}

async function safeRead(root: string, relative: string): Promise<string> {
  const target = await safePath(root, relative, true);
  const stats = await lstat(target);
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES)
    throw new Error('workflow input must be a bounded regular file');
  const handle = await open(target, 'r');
  let contents: string;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== stats.dev ||
      opened.ino !== stats.ino ||
      opened.size > MAX_FILE_BYTES
    )
      throw new Error('workflow input identity changed');
    contents = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  await safePath(root, relative, true);
  const after = await lstat(target);
  if (after.dev !== stats.dev || after.ino !== stats.ino)
    throw new Error('workflow input identity changed');
  if (Buffer.byteLength(contents) > MAX_FILE_BYTES)
    throw new Error('workflow input exceeds limit');
  return contents;
}

async function optionalRead(
  root: string,
  relative: string,
): Promise<string | undefined> {
  try {
    return await safeRead(root, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
