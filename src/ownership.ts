import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { gitInspectionArguments } from './git-inspection.js';
import { publishExclusiveFile, readStableRegularFile } from './safe-files.js';

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_PATTERN = /^AC-\d{3}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_RECORD_BYTES = 16 * 1024;
const OWNERSHIP_DIRECTORY = 'ownership';

export interface TaskOwnershipRequest {
  readonly runId: string;
  readonly taskId: string;
  readonly workbookSha256: string;
  readonly taskSha256: string;
  readonly headCommit: string;
  readonly branch: string;
}

export interface TaskOwnershipRecord extends TaskOwnershipRequest {
  readonly version: 1;
  readonly projectRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  readonly ownershipId: string;
}

export interface TaskOwnershipResult {
  readonly kind: 'created' | 'resumed';
  readonly filePath: string;
  readonly record: Readonly<TaskOwnershipRecord>;
}

export async function acquireTaskOwnership(
  projectDirectory: string,
  requestValue: TaskOwnershipRequest,
): Promise<Readonly<TaskOwnershipResult>> {
  const request = validateRequest(requestValue);
  const paths = await resolveOwnershipPaths(projectDirectory, request.taskId);
  const identity = paths.identity;
  const expected = {
    version: 1 as const,
    ...request,
    ...identity,
  };
  const ownershipId = createHash('sha256')
    .update(JSON.stringify(expected), 'utf8')
    .digest('hex');
  const record = Object.freeze({ ...expected, ownershipId });
  const created = await publishExclusiveFile(
    paths.record,
    `${JSON.stringify(record, null, 2)}\n`,
    () => assertOwnershipDirectory(paths),
  );
  await assertOwnershipDirectory(paths);
  if (created)
    return Object.freeze({ kind: 'created', filePath: paths.record, record });
  const existing = await readOwnershipRecord(paths.record);
  if (JSON.stringify(existing) !== JSON.stringify(record))
    throw new Error(`task ${request.taskId} is owned by another workbook run`);
  return Object.freeze({ kind: 'resumed', filePath: paths.record, record });
}

export async function assertTaskOwnership(
  projectDirectory: string,
  expected: Readonly<TaskOwnershipRecord>,
): Promise<void> {
  validateRecord(expected);
  const paths = await resolveOwnershipPaths(projectDirectory, expected.taskId);
  await assertOwnershipDirectory(paths);
  const actual = await readOwnershipRecord(paths.record);
  await assertOwnershipDirectory(paths);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('durable task ownership changed');
  const identity = paths.identity;
  if (
    identity.projectRoot !== expected.projectRoot ||
    identity.gitDirectory !== expected.gitDirectory ||
    identity.gitCommonDirectory !== expected.gitCommonDirectory
  )
    throw new Error('durable task ownership worktree identity changed');
}

async function resolveOwnershipPaths(projectDirectory: string, taskId: string) {
  const root = await realpath(path.resolve(projectDirectory));
  if (!(await stat(root)).isDirectory())
    throw new Error('project directory must be a directory');
  const identity = await projectIdentity(root);
  if (path.basename(identity.gitCommonDirectory) !== '.git')
    throw new Error('repository uses an unsupported shared Git directory');
  const coordinationRoot = await realpath(
    path.dirname(identity.gitCommonDirectory),
  );
  const state = path.join(coordinationRoot, '.autocode');
  const stateReal = await requireRealDirectory(state, 'state directory');
  if (path.dirname(stateReal) !== coordinationRoot)
    throw new Error('state directory escapes repository coordination root');
  await assertOwnershipIgnored(
    coordinationRoot,
    `.autocode/${OWNERSHIP_DIRECTORY}/${taskId}.json`,
  );
  const directory = path.join(stateReal, OWNERSHIP_DIRECTORY);
  try {
    await mkdir(directory);
  } catch (error: unknown) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const directoryReal = await requireRealDirectory(
    directory,
    'ownership directory',
  );
  if (path.dirname(directoryReal) !== stateReal)
    throw new Error('ownership directory escapes state directory');
  const directoryStats = await stat(directoryReal);
  return {
    root,
    identity,
    directory: directoryReal,
    record: path.join(directoryReal, `${taskId}.json`),
    directoryDev: directoryStats.dev,
    directoryIno: directoryStats.ino,
  };
}

async function assertOwnershipDirectory(paths: {
  directory: string;
  directoryDev: number;
  directoryIno: number;
}): Promise<void> {
  const info = await lstat(paths.directory);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.dev !== paths.directoryDev ||
    info.ino !== paths.directoryIno ||
    (await realpath(paths.directory)) !== paths.directory
  )
    throw new Error('ownership directory identity changed');
}

async function assertOwnershipIgnored(
  root: string,
  relativePath: string,
): Promise<void> {
  const exitCode = await new Promise<number>((resolve, reject) => {
    execFile(
      'git',
      gitInspectionArguments(root, [
        'check-ignore',
        '--quiet',
        '--no-index',
        '--',
        relativePath,
      ]),
      { cwd: root, encoding: 'utf8', maxBuffer: 4096, windowsHide: true },
      (error) => {
        if (error === null) return resolve(0);
        if (typeof error.code === 'number') return resolve(error.code);
        reject(error);
      },
    );
  });
  if (exitCode !== 0) {
    if (exitCode === 1)
      throw new Error('durable task ownership must be gitignored');
    throw new Error('could not verify durable task ownership ignore coverage');
  }
}

async function projectIdentity(root: string) {
  const gitDirectory = await resolveGitPath(root, '--git-dir');
  const commonDirectory = await resolveGitPath(root, '--git-common-dir');
  return Object.freeze({
    projectRoot: root,
    gitDirectory,
    gitCommonDirectory: commonDirectory,
  });
}

export async function releaseTaskOwnership(
  projectDirectory: string,
  expected: Readonly<TaskOwnershipRecord>,
): Promise<void> {
  validateRecord(expected);
  const paths = await resolveOwnershipPaths(projectDirectory, expected.taskId);
  await assertOwnershipDirectory(paths);
  const actual = await readOwnershipRecord(paths.record);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('durable task ownership changed before release');
  await unlink(paths.record);
  await syncDirectory(paths.directory);
  await assertOwnershipDirectory(paths);
}

async function resolveGitPath(root: string, argument: string): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      gitInspectionArguments(root, ['rev-parse', argument]),
      { cwd: root, encoding: 'utf8', maxBuffer: 4096, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
  return await realpath(path.resolve(root, output));
}

async function readOwnershipRecord(
  filePath: string,
): Promise<TaskOwnershipRecord> {
  let text: string;
  try {
    text = await readStableRegularFile(
      filePath,
      MAX_RECORD_BYTES,
      'durable task ownership',
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      /bounded regular file|changed while/.test(error.message)
    )
      throw error;
    throw new Error('durable task ownership is unavailable', { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error('durable task ownership is invalid', { cause: error });
  }
  return validateRecord(value);
}

function validateRequest(value: TaskOwnershipRequest): TaskOwnershipRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('task ownership request must be a mapping');
  if (!RUN_ID_PATTERN.test(value.runId))
    throw new Error('task ownership run ID is invalid');
  if (!TASK_ID_PATTERN.test(value.taskId))
    throw new Error('task ownership task ID is invalid');
  if (
    !HASH_PATTERN.test(value.workbookSha256) ||
    !HASH_PATTERN.test(value.taskSha256)
  )
    throw new Error('task ownership content binding is invalid');
  if (!COMMIT_PATTERN.test(value.headCommit))
    throw new Error('task ownership Git commit is invalid');
  if (
    typeof value.branch !== 'string' ||
    value.branch.length === 0 ||
    Buffer.byteLength(value.branch, 'utf8') > 256 ||
    [...value.branch].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  )
    throw new Error('task ownership branch is invalid');
  return Object.freeze({
    runId: value.runId,
    taskId: value.taskId,
    workbookSha256: value.workbookSha256,
    taskSha256: value.taskSha256,
    headCommit: value.headCommit,
    branch: value.branch,
  });
}

function validateRecord(value: unknown): TaskOwnershipRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('durable task ownership must be a mapping');
  const record = value as Record<string, unknown>;
  const keys = [
    'version',
    'runId',
    'taskId',
    'workbookSha256',
    'taskSha256',
    'headCommit',
    'branch',
    'projectRoot',
    'gitDirectory',
    'gitCommonDirectory',
    'ownershipId',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !keys.includes(key)) ||
    record.version !== 1
  )
    throw new Error('durable task ownership schema is invalid');
  const request = validateRequest(record as unknown as TaskOwnershipRequest);
  for (const key of [
    'projectRoot',
    'gitDirectory',
    'gitCommonDirectory',
  ] as const) {
    if (
      typeof record[key] !== 'string' ||
      record[key].length === 0 ||
      Buffer.byteLength(record[key], 'utf8') > 4096
    )
      throw new Error(`durable task ownership ${key} is invalid`);
  }
  if (
    typeof record.ownershipId !== 'string' ||
    !HASH_PATTERN.test(record.ownershipId)
  )
    throw new Error('durable task ownership ID is invalid');
  const expectedId = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        ...request,
        projectRoot: record.projectRoot,
        gitDirectory: record.gitDirectory,
        gitCommonDirectory: record.gitCommonDirectory,
      }),
      'utf8',
    )
    .digest('hex');
  if (record.ownershipId !== expectedId)
    throw new Error('durable task ownership binding is invalid');
  return Object.freeze(record as unknown as TaskOwnershipRecord);
}

async function requireRealDirectory(
  directory: string,
  label: string,
): Promise<string> {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory())
    throw new Error(`${label} must be a real directory`);
  const canonical = await realpath(directory);
  const canonicalStats = await stat(canonical);
  if (stats.dev !== canonicalStats.dev || stats.ino !== canonicalStats.ino)
    throw new Error(`${label} identity changed`);
  return canonical;
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
