import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { gitInspectionArguments } from './git-inspection.js';

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_PATTERN = /^AC-\d{3}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
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
  const identity = await projectIdentity(paths.root);
  const expected = {
    version: 1 as const,
    ...request,
    ...identity,
  };
  const ownershipId = createHash('sha256')
    .update(JSON.stringify(expected), 'utf8')
    .digest('hex');
  const record = Object.freeze({ ...expected, ownershipId });
  const candidate = path.join(
    paths.directory,
    `.${request.taskId}.${process.pid}.${randomUUID()}.candidate`,
  );
  let alreadyExists = false;
  try {
    await assertOwnershipDirectory(paths);
    const handle = await open(candidate, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await assertOwnershipDirectory(paths);
      await link(candidate, paths.record);
      await assertOwnershipDirectory(paths);
      await syncDirectory(paths.directory);
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error;
      alreadyExists = true;
    }
  } catch (error: unknown) {
    await removeCandidate(candidate);
    throw error;
  }
  await removeCandidate(candidate);
  await syncDirectory(paths.directory);
  await assertOwnershipDirectory(paths);
  if (!alreadyExists)
    return Object.freeze({ kind: 'created', filePath: paths.record, record });
  const existing = await readOwnershipRecord(paths.record);
  if (JSON.stringify(existing) !== JSON.stringify(record))
    throw new Error(`task ${request.taskId} is owned by another workbook run`);
  return Object.freeze({ kind: 'resumed', filePath: paths.record, record });
}

async function removeCandidate(candidate: string): Promise<void> {
  try {
    await unlink(candidate);
  } catch (error: unknown) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
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
  const identity = await projectIdentity(paths.root);
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
  const state = path.join(root, '.autocode');
  const stateReal = await requireRealDirectory(state, 'state directory');
  if (path.dirname(stateReal) !== root)
    throw new Error('state directory escapes project');
  await assertOwnershipIgnored(
    root,
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
  const gitDirectory = await resolveGitPath(root, '.git');
  const commonDirectory = await resolveGitPath(root, '--git-common-dir');
  return Object.freeze({
    projectRoot: root,
    gitDirectory,
    gitCommonDirectory: commonDirectory,
  });
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
  let pathStats;
  try {
    pathStats = await lstat(filePath);
  } catch (error: unknown) {
    throw new Error('durable task ownership is unavailable', { cause: error });
  }
  if (pathStats.isSymbolicLink() || !pathStats.isFile())
    throw new Error('durable task ownership must be a bounded regular file');
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    throw new Error('durable task ownership is unavailable', { cause: error });
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino ||
      before.size > MAX_RECORD_BYTES
    )
      throw new Error('durable task ownership must be a bounded regular file');
    const text = await handle.readFile('utf8');
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('durable task ownership changed while being read');
    const currentPathStats = await lstat(filePath);
    if (
      currentPathStats.isSymbolicLink() ||
      !currentPathStats.isFile() ||
      currentPathStats.dev !== before.dev ||
      currentPathStats.ino !== before.ino
    )
      throw new Error('durable task ownership changed while being read');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error: unknown) {
      throw new Error('durable task ownership is invalid', { cause: error });
    }
    return validateRecord(value);
  } finally {
    await handle.close();
  }
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
