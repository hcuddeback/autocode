import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { CONFIG_FILE, STATE_DIRECTORY, validateConfig } from './config.js';
import { selectProjectTask, type TaskRecord } from './tasks.js';

const execFileAsync = promisify(execFile);
const REQUIRED_SECTIONS = [
  'Outcome',
  'Why now',
  'Required context',
  'Scope',
  'Implementation constraints',
  'Done when',
  'Deterministic validation',
  'Independent critical-review focus',
  'QA',
  'PR, merge, and production gates',
  'Files/areas expected',
  'Manual owner steps or blockers',
] as const;
const TEMPLATE_PLACEHOLDERS = [
  'Replace with one observable outcome',
  'YYYY-MM-DD',
  'Describe one observable user or system result.',
  'Link this task to the MVP milestone, evidence, defect, security need, or release gate.',
  'relevant sections only.',
  'affected phases/gates only.',
  'relevant sections or not applicable.',
  'Remove unneeded documents.',
  'Specific behavior or deliverable.',
  'Important integration boundaries.',
  'Adjacent work excluded.',
  'Later outcome not to implement early.',
  'Observable positive result.',
  'Important failure, empty, interruption, or recovery result.',
  'Applicable data, authorization, process, or provider boundary.',
  'PENDING_REAL_COMMAND',
  'Replace pending commands before marking ready',
  'Assumptions, edge cases, safety boundaries, and regression surfaces to challenge.',
  'Runtime/user-journey scenarios and required evidence if applicable.',
  'PR applicability: required | not applicable',
  'Codex PR review: required | not applicable | auto',
  'Merge authorization: human | policy | not applicable',
  'Production verification: required | not applicable | auto',
  'Task-specific CI, freshness, deployment, smoke, or rollback evidence.',
  'Likely paths/components',
  '`None`, or account/provider/credential/approval work',
  '- Branch/PR:',
  '- Final commit:',
  '- Validation evidence:',
  '- Review disposition:',
  '- QA evidence or not-applicable reason:',
  '- Production evidence or not-applicable reason:',
  '- Remaining limitation:',
] as const;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;

export interface PlanningMetadata {
  version: 1;
  taskId: string;
  taskPath: string;
  taskSha256: string;
  headCommit: string;
  branch: string;
}

export interface PlanningResult {
  kind: 'created' | 'existing';
  runDirectory: string;
  metadata: PlanningMetadata;
}

export async function prepareImplementationPlan(
  projectDirectory: string,
): Promise<PlanningResult> {
  const root = await verifiedProjectRoot(projectDirectory);
  await validateInitializedState(root);
  const selection = await selectProjectTask(root);
  if (selection.kind !== 'selected') {
    throw new Error(selectionFailure(selection.kind));
  }
  validateTaskContract(selection.task);

  const branch = await gitOutput(root, ['branch', '--show-current']);
  if (branch === '' || branch === 'main') {
    throw new Error(
      'planning requires a non-main Git branch in an isolated worktree',
    );
  }
  if (branch !== selection.task.branch) {
    throw new Error(
      `planning requires the selected task branch ${selection.task.branch}; current branch is ${branch}`,
    );
  }
  await assertCleanWorktree(root);
  const headCommit = await gitOutput(root, ['rev-parse', '--verify', 'HEAD']);
  if (!/^[0-9a-f]{40,64}$/.test(headCommit)) {
    throw new Error('Git returned an invalid HEAD commit identity');
  }

  const taskPath = normalizedRelativePath(root, selection.task.filePath);
  const taskSha256 = createHash('sha256')
    .update(selection.task.contents, 'utf8')
    .digest('hex');
  const metadata: PlanningMetadata = {
    version: 1,
    taskId: selection.task.taskId,
    taskPath,
    taskSha256,
    headCommit,
    branch,
  };
  const runName = `${selection.task.taskId}-${headCommit.slice(0, 12)}`;
  const runsDirectory = path.join(root, STATE_DIRECTORY, 'runs');
  const runDirectory = path.join(runsDirectory, runName);
  const expectedMetadata = `${JSON.stringify(metadata, null, 2)}\n`;

  const currentSelection = await selectProjectTask(root);
  if (
    currentSelection.kind !== 'selected' ||
    currentSelection.task.taskId !== selection.task.taskId ||
    currentSelection.task.contents !== selection.task.contents
  ) {
    throw new Error('selected task changed while planning was prepared');
  }

  if (await pathExists(runDirectory)) {
    await validateExistingRun(runDirectory, expectedMetadata, selection.task);
    return { kind: 'existing', runDirectory, metadata };
  }

  const temporaryDirectory = path.join(
    runsDirectory,
    `.${runName}.tmp-${process.pid}-${Date.now()}`,
  );
  await assertRealDirectory(runsDirectory, 'runs directory');
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    await writeFile(
      path.join(temporaryDirectory, 'planning.json'),
      expectedMetadata,
      { encoding: 'utf8', flag: 'wx' },
    );
    await writeFile(
      path.join(temporaryDirectory, 'task.md'),
      selection.task.contents,
      { encoding: 'utf8', flag: 'wx' },
    );
    await writeFile(
      path.join(temporaryDirectory, 'plan.md'),
      planTemplate(metadata),
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporaryDirectory, runDirectory);
  } catch (error: unknown) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (await pathExists(runDirectory)) {
      await validateExistingRun(runDirectory, expectedMetadata, selection.task);
      return { kind: 'existing', runDirectory, metadata };
    }
    throw error;
  }
  return { kind: 'created', runDirectory, metadata };
}

function validateTaskContract(task: TaskRecord): void {
  for (const section of REQUIRED_SECTIONS) {
    const heading = section === 'Outcome' ? '#' : '##';
    if (
      !new RegExp(`^${heading} ${escapeRegExp(section)}\\s*$`, 'm').test(
        task.contents,
      )
    ) {
      throw new Error(`task contract is missing required section: ${section}`);
    }
  }
  if (
    TEMPLATE_PLACEHOLDERS.some((placeholder) =>
      task.contents.includes(placeholder),
    )
  ) {
    throw new Error('task contract contains template placeholder content');
  }
}

async function assertCleanWorktree(root: string): Promise<void> {
  const status = await gitOutput(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (status !== '') {
    throw new Error('planning requires a clean Git worktree');
  }
}

async function validateInitializedState(root: string): Promise<void> {
  const stateDirectory = path.join(root, STATE_DIRECTORY);
  const runsDirectory = path.join(stateDirectory, 'runs');
  await assertRealDirectory(stateDirectory, 'state directory');
  await assertRealDirectory(runsDirectory, 'runs directory');
  const configPath = path.join(root, CONFIG_FILE);
  const configStats = await lstat(configPath);
  if (configStats.isSymbolicLink() || !configStats.isFile()) {
    throw new Error('configuration file must be a real file');
  }
  if (configStats.size > MAX_CONFIG_BYTES) {
    throw new Error(`configuration exceeds ${MAX_CONFIG_BYTES} bytes`);
  }
  validateConfig(parse(await readFile(configPath, 'utf8')));
}

async function verifiedProjectRoot(projectDirectory: string): Promise<string> {
  const requested = await realpath(projectDirectory);
  const root = await gitOutput(requested, ['rev-parse', '--show-toplevel']);
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== requested) {
    throw new Error('project directory must be the Git worktree root');
  }
  return canonicalRoot;
}

async function assertRealDirectory(target: string, description: string) {
  const targetStats = await lstat(target);
  if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
    throw new Error(`${description} must be a real directory`);
  }
  const resolvedStats = await stat(await realpath(target));
  if (
    targetStats.dev !== resolvedStats.dev ||
    targetStats.ino !== resolvedStats.ino
  ) {
    throw new Error(`${description} changed while being inspected`);
  }
}

async function validateExistingRun(
  runDirectory: string,
  expectedMetadata: string,
  task: TaskRecord,
): Promise<void> {
  await assertRealDirectory(runDirectory, 'planning run directory');
  const metadata = await readRealFile(
    path.join(runDirectory, 'planning.json'),
    'planning metadata',
  );
  const snapshot = await readRealFile(
    path.join(runDirectory, 'task.md'),
    'task snapshot',
  );
  await readRealFile(path.join(runDirectory, 'plan.md'), 'implementation plan');
  if (metadata !== expectedMetadata || snapshot !== task.contents) {
    throw new Error(
      'existing planning artifacts conflict with the selected task and commit',
    );
  }
}

async function readRealFile(
  target: string,
  description: string,
): Promise<string> {
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ELOOP')) {
      throw new Error(`${description} must be a real file`, { cause: error });
    }
    throw error;
  }
  try {
    const targetStats = await handle.stat();
    if (!targetStats.isFile()) {
      throw new Error(`${description} must be a real file`);
    }
    if (targetStats.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`${description} exceeds ${MAX_ARTIFACT_BYTES} bytes`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function planTemplate(metadata: PlanningMetadata): string {
  return `# Implementation plan — ${metadata.taskId}\n\n- Task snapshot: \`task.md\`\n- Source task: \`${metadata.taskPath}\`\n- Git branch: \`${metadata.branch}\`\n- Git commit: \`${metadata.headCommit}\`\n- Task SHA-256: \`${metadata.taskSha256}\`\n\n## Intended changes\n\n- [ ] Describe only changes required by ${metadata.taskId}.\n\n## Sequence\n\n1. [ ] Add implementation steps against the recorded commit.\n\n## Risks and mitigations\n\n- [ ] Record task-specific risks and mitigations.\n\n## Verification\n\n- [ ] Copy the deterministic commands required by the task contract.\n`;
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

function normalizedRelativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('selected task path is outside the project root');
  }
  return relative.split(path.sep).join('/');
}

function selectionFailure(kind: 'active' | 'blocked' | 'none'): string {
  if (kind === 'active')
    return 'cannot prepare a plan while another task is active';
  if (kind === 'blocked')
    return 'cannot prepare a plan because ready tasks have incomplete dependencies';
  return 'cannot prepare a plan because no ready task exists';
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
