import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
  'Required execution sequence',
  'Done when',
  'Deterministic validation',
  'Independent critical-review focus',
  'QA',
  'PR, merge, and production gates',
  'Files/areas expected',
  'Manual owner steps or blockers',
] as const;
const SECTION_PLACEHOLDER_LINES: Readonly<Record<string, readonly string[]>> = {
  Outcome: ['Describe one observable user or system result.'],
  'Why now': [
    'Link this task to the MVP milestone, evidence, defect, security need, or release gate.',
  ],
  'Required context': [
    '- `docs/PRODUCT.md` — relevant sections only.',
    '- `docs/ARCHITECTURE.md` — relevant sections only.',
    '- `docs/WORKFLOW.md` — affected phases/gates only.',
    '- `docs/SECURITY.md` — relevant sections or not applicable.',
    'Remove unneeded documents. Do not import the whole roadmap into implementation context.',
  ],
  'Scope In': [
    '- Specific behavior or deliverable.',
    '- Important integration boundaries.',
  ],
  'Scope Out': [
    '- Adjacent work excluded.',
    '- Later outcome not to implement early.',
  ],
  'Done when': [
    '- [ ] Observable positive result.',
    '- [ ] Important failure, empty, interruption, or recovery result.',
    '- [ ] Applicable data, authorization, process, or provider boundary.',
  ],
  'Deterministic validation': [
    '- [ ] Formatting/lint: `PENDING_REAL_COMMAND`',
    '- [ ] Typecheck: `PENDING_REAL_COMMAND`',
    '- [ ] Tests: `PENDING_REAL_COMMAND`',
    '- [ ] Build/package smoke: `PENDING_REAL_COMMAND`',
    'Replace pending commands before marking ready once the repository provides them.',
  ],
  'Independent critical-review focus': [
    '- Assumptions, edge cases, safety boundaries, and regression surfaces to challenge.',
  ],
  QA: [
    '**Applicability:** `auto`',
    '- Runtime/user-journey scenarios and required evidence if applicable.',
    '- Persist a reason when not applicable.',
  ],
  'PR, merge, and production gates': [
    '- PR applicability: required | not applicable (include a reason when not applicable)',
    '- Codex PR review: required | not applicable | auto',
    '- Merge authorization: human | policy | not applicable',
    '- Production verification: required | not applicable | auto',
    '- Task-specific CI, freshness, deployment, smoke, or rollback evidence.',
  ],
  'Files/areas expected': [
    '- Likely paths/components; this does not authorize unrelated cleanup.',
  ],
  'Manual owner steps or blockers': [
    '- `None`, or account/provider/credential/approval work and what it blocks. Never include secrets.',
  ],
};
const EMPTY_COMPLETION_FIELD_PATTERN =
  /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:Branch\/PR|Final commit|Validation evidence|Review disposition|QA evidence or not-applicable reason|Production evidence or not-applicable reason|Remaining limitation):[ \t]*$/m;
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

export type PlanningCheckpoint =
  | 'after-runs-identity'
  | 'after-temporary-identity'
  | 'after-existing-run-identity'
  | 'after-publication';

export interface PlanningOptions {
  onCheckpoint?: (checkpoint: PlanningCheckpoint) => Promise<void>;
}

export async function prepareImplementationPlan(
  projectDirectory: string,
  options: PlanningOptions = {},
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
  await assertLinkedWorktree(root);
  await validateDeclaredBranch(root, selection.task.branch);
  if (branch !== selection.task.branch) {
    throw new Error(
      'current Git branch does not match the selected task branch',
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

  const runsIdentity = await directoryIdentity(runsDirectory, 'runs directory');
  await options.onCheckpoint?.('after-runs-identity');
  await assertDirectoryIdentity(runsIdentity, 'runs directory');
  if (await pathExists(runDirectory)) {
    await assertPlanningIdentity(root, selection.task, branch, headCommit);
    await validateExistingRun(
      root,
      runDirectory,
      expectedMetadata,
      selection.task,
      branch,
      headCommit,
      runsIdentity,
      options,
    );
    return { kind: 'existing', runDirectory, metadata };
  }

  const temporaryDirectory = path.join(
    runsDirectory,
    `.${runName}.tmp-${process.pid}-${Date.now()}`,
  );
  await mkdir(temporaryDirectory, { recursive: false });
  let temporaryIdentity: DirectoryIdentity | undefined;
  let publishedIdentity: DirectoryIdentity | undefined;
  try {
    temporaryIdentity = await directoryIdentity(
      temporaryDirectory,
      'temporary planning directory',
    );
    await options.onCheckpoint?.('after-temporary-identity');
    await assertDirectoryIdentity(runsIdentity, 'runs directory');
    await assertDirectoryIdentity(
      temporaryIdentity,
      'temporary planning directory',
    );
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
    await assertDirectoryIdentity(runsIdentity, 'runs directory');
    await assertDirectoryIdentity(
      temporaryIdentity,
      'temporary planning directory',
    );
    await assertPlanningIdentity(root, selection.task, branch, headCommit);
    await rename(temporaryDirectory, runDirectory);
    publishedIdentity = await directoryIdentity(
      runDirectory,
      'planning run directory',
    );
    await options.onCheckpoint?.('after-publication');
    await assertDirectoryIdentity(runsIdentity, 'runs directory');
    await assertDirectoryIdentity(publishedIdentity, 'planning run directory');
    await assertPlanningIdentity(root, selection.task, branch, headCommit);
  } catch (error: unknown) {
    if (publishedIdentity !== undefined) {
      await removeOwnedDirectory(
        publishedIdentity,
        runsIdentity,
        'planning run directory',
      );
      throw error;
    }
    if (temporaryIdentity !== undefined) {
      await removeOwnedDirectory(
        temporaryIdentity,
        runsIdentity,
        'temporary planning directory',
      );
    }
    await assertDirectoryIdentity(runsIdentity, 'runs directory');
    if (await pathExists(runDirectory)) {
      await validateExistingRun(
        root,
        runDirectory,
        expectedMetadata,
        selection.task,
        branch,
        headCommit,
        runsIdentity,
        options,
      );
      return { kind: 'existing', runDirectory, metadata };
    }
    throw error;
  }
  return { kind: 'created', runDirectory, metadata };
}

function validateTaskContract(task: TaskRecord): void {
  const sectionBodies = new Map<string, string>();
  for (const section of REQUIRED_SECTIONS) {
    const heading = section === 'Outcome' ? '#' : '##';
    const match = new RegExp(
      `^${heading} ${escapeRegExp(section)}\\s*$([\\s\\S]*?)(?=^#{1,${heading.length}} |(?![\\s\\S]))`,
      'm',
    ).exec(task.contents);
    if (match === null) {
      throw new Error(`task contract is missing required section: ${section}`);
    }
    if (!hasSubstantiveContent(match[1] ?? '')) {
      throw new Error(
        `task contract has an empty required section: ${section}`,
      );
    }
    sectionBodies.set(section, match[1] ?? '');
  }
  const scopeBody = sectionBodies.get('Scope') ?? '';
  const scopeIn = validateScopeSubsection(scopeBody, 'In');
  const scopeOut = validateScopeSubsection(scopeBody, 'Out');
  const title = task.title.trim();
  const lastUpdated = taskFrontmatterValue(task.contents, 'last_updated');
  const qa = taskFrontmatterValue(task.contents, 'qa');
  const deployment = taskFrontmatterValue(task.contents, 'deployment');
  const completionRecord = optionalSectionBody(
    task.contents,
    'Completion record',
  );
  if (
    title === 'Replace with one observable outcome' ||
    (typeof lastUpdated === 'string' && lastUpdated.trim() === 'YYYY-MM-DD') ||
    qa === 'auto' ||
    deployment === 'auto' ||
    containsScopedTemplatePlaceholder(sectionBodies, scopeIn, scopeOut) ||
    (completionRecord !== undefined &&
      EMPTY_COMPLETION_FIELD_PATTERN.test(completionRecord))
  ) {
    throw new Error('task contract contains template placeholder content');
  }
}

function optionalSectionBody(
  contents: string,
  section: string,
): string | undefined {
  return new RegExp(
    `^## ${escapeRegExp(section)}\\s*$([\\s\\S]*?)(?=^#{1,2} |(?![\\s\\S]))`,
    'm',
  ).exec(contents)?.[1];
}

function containsScopedTemplatePlaceholder(
  sections: ReadonlyMap<string, string>,
  scopeIn: string,
  scopeOut: string,
): boolean {
  for (const [section, placeholders] of Object.entries(
    SECTION_PLACEHOLDER_LINES,
  )) {
    const body =
      section === 'Scope In'
        ? scopeIn
        : section === 'Scope Out'
          ? scopeOut
          : (sections.get(section) ?? '');
    const lines = body.split(/\r?\n/).map((line) => line.trim());
    if (placeholders.some((placeholder) => lines.includes(placeholder))) {
      return true;
    }
  }
  return false;
}

function taskFrontmatterValue(contents: string, field: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (match === null) return undefined;
  const value: unknown = parse(match[1] ?? '');
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function validateScopeSubsection(
  scopeBody: string,
  subsection: 'In' | 'Out',
): string {
  const match = new RegExp(
    `^### ${subsection}\\s*$([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
    'm',
  ).exec(scopeBody);
  if (match === null || !hasSubstantiveContent(match[1] ?? '')) {
    throw new Error(
      `task contract has an empty Scope ${subsection} subsection`,
    );
  }
  return match[1] ?? '';
}

function hasSubstantiveContent(contents: string): boolean {
  const normalized = contents
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6} .*$/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]*/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]*/gm, '')
    .trim();
  return /[\p{L}\p{N}]/u.test(normalized);
}

async function validateDeclaredBranch(root: string, branch: string) {
  try {
    await gitOutput(root, ['check-ref-format', '--branch', branch]);
  } catch (error: unknown) {
    throw new Error('selected task declares an invalid Git branch', {
      cause: error,
    });
  }
}

async function assertLinkedWorktree(root: string): Promise<void> {
  const gitDirectory = await canonicalGitPath(
    root,
    await gitOutput(root, ['rev-parse', '--git-dir']),
  );
  const commonDirectory = await canonicalGitPath(
    root,
    await gitOutput(root, ['rev-parse', '--git-common-dir']),
  );
  if (gitDirectory === commonDirectory) {
    throw new Error('planning requires an isolated linked Git worktree');
  }
}

async function canonicalGitPath(root: string, target: string): Promise<string> {
  return realpath(path.resolve(root, target));
}

async function assertPlanningIdentity(
  root: string,
  task: TaskRecord,
  branch: string,
  headCommit: string,
): Promise<void> {
  const [currentBranch, currentHead, currentSelection] = await Promise.all([
    gitOutput(root, ['branch', '--show-current']),
    gitOutput(root, ['rev-parse', '--verify', 'HEAD']),
    selectProjectTask(root),
  ]);
  await assertCleanWorktree(root);
  const [confirmedBranch, confirmedHead] = await Promise.all([
    gitOutput(root, ['branch', '--show-current']),
    gitOutput(root, ['rev-parse', '--verify', 'HEAD']),
  ]);
  const confirmedSelection = await selectProjectTask(root);
  await assertCleanWorktree(root);
  if (
    currentBranch !== branch ||
    currentHead !== headCommit ||
    confirmedBranch !== branch ||
    confirmedHead !== headCommit ||
    currentSelection.kind !== 'selected' ||
    currentSelection.task.taskId !== task.taskId ||
    currentSelection.task.contents !== task.contents ||
    confirmedSelection.kind !== 'selected' ||
    confirmedSelection.task.taskId !== task.taskId ||
    confirmedSelection.task.contents !== task.contents
  ) {
    throw new Error('task or Git identity changed while planning was prepared');
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

interface DirectoryIdentity {
  target: string;
  canonicalPath: string;
  dev: number;
  ino: number;
}

async function directoryIdentity(
  target: string,
  description: string,
): Promise<DirectoryIdentity> {
  const targetStats = await lstat(target);
  if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
    throw new Error(`${description} must be a real directory`);
  }
  const canonicalPath = await realpath(target);
  const resolvedStats = await stat(canonicalPath);
  if (
    targetStats.dev !== resolvedStats.dev ||
    targetStats.ino !== resolvedStats.ino
  ) {
    throw new Error(`${description} changed while being inspected`);
  }
  return {
    target,
    canonicalPath,
    dev: targetStats.dev,
    ino: targetStats.ino,
  };
}

async function assertRealDirectory(target: string, description: string) {
  await directoryIdentity(target, description);
}

async function assertDirectoryIdentity(
  expected: DirectoryIdentity,
  description: string,
): Promise<void> {
  const current = await directoryIdentity(expected.target, description);
  if (
    current.canonicalPath !== expected.canonicalPath ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new Error(`${description} changed while planning was prepared`);
  }
}

async function removeOwnedDirectory(
  owned: DirectoryIdentity,
  parent: DirectoryIdentity,
  description: string,
): Promise<void> {
  await assertDirectoryIdentity(parent, 'runs directory');
  await assertDirectoryIdentity(owned, description);
  const quarantine = `${owned.target}.cleanup-${process.pid}-${randomUUID()}`;
  await rename(owned.target, quarantine);
  const movedStats = await lstat(quarantine);
  if (
    movedStats.isSymbolicLink() ||
    !movedStats.isDirectory() ||
    movedStats.dev !== owned.dev ||
    movedStats.ino !== owned.ino
  ) {
    throw new Error(`${description} changed while cleanup was prepared`);
  }
  await assertDirectoryIdentity(parent, 'runs directory');
  await rm(quarantine, { recursive: true, force: false });
}

async function validateExistingRun(
  root: string,
  runDirectory: string,
  expectedMetadata: string,
  task: TaskRecord,
  branch: string,
  headCommit: string,
  runsIdentity: DirectoryIdentity,
  options: PlanningOptions,
): Promise<void> {
  await assertDirectoryIdentity(runsIdentity, 'runs directory');
  const runIdentity = await directoryIdentity(
    runDirectory,
    'planning run directory',
  );
  await options.onCheckpoint?.('after-existing-run-identity');
  await assertDirectoryIdentity(runIdentity, 'planning run directory');
  const metadata = await readRealFile(
    path.join(runDirectory, 'planning.json'),
    'planning metadata',
  );
  const snapshot = await readRealFile(
    path.join(runDirectory, 'task.md'),
    'task snapshot',
  );
  await readRealFile(path.join(runDirectory, 'plan.md'), 'implementation plan');
  await assertDirectoryIdentity(runIdentity, 'planning run directory');
  await assertDirectoryIdentity(runsIdentity, 'runs directory');
  if (metadata !== expectedMetadata || snapshot !== task.contents) {
    throw new Error(
      'existing planning artifacts conflict with the selected task and commit',
    );
  }
  await assertPlanningIdentity(root, task, branch, headCommit);
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
