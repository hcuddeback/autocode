import { constants, type Stats } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const TASK_DIRECTORY = 'tasks';
const COMPLETED_TASK_DIRECTORY = 'completed';
const TASK_FILE_PATTERN = /^AC-\d{3}\.md$/;
const TASK_LIKE_FILE_PATTERN = /^AC-.*\.md$/i;
const TASK_ID_PATTERN = /^AC-\d{3}$/;
const MAX_TASK_BYTES = 256 * 1024;
const TASK_KEYS = new Set([
  'task_id',
  'title',
  'status',
  'priority',
  'risk',
  'depends_on',
  'branch',
  'owner',
  'last_updated',
  'qa',
  'deployment',
  'pull_request',
]);
const TASK_STATUSES = [
  'ready',
  'in_progress',
  'review',
  'done',
  'blocked',
  'later',
  'canceled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRecord {
  taskId: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  branch: string;
  filePath: string;
  contents: string;
}

export interface DependencyBlocker {
  taskId: string;
  status: TaskStatus | 'missing';
}

export type TaskSelection =
  | { kind: 'selected'; task: TaskRecord }
  | {
      kind: 'active';
      tasks: Array<{ taskId: string; status: 'in_progress' | 'review' }>;
    }
  | {
      kind: 'blocked';
      tasks: Array<{ taskId: string; dependencies: DependencyBlocker[] }>;
    }
  | { kind: 'none' };

export async function loadTaskCatalog(
  projectDirectory: string,
): Promise<TaskRecord[]> {
  const taskDirectory = path.join(projectDirectory, TASK_DIRECTORY);
  const activeTasks = await loadTaskDirectory(taskDirectory, false);
  const completedTasks = await loadTaskDirectory(
    path.join(taskDirectory, COMPLETED_TASK_DIRECTORY),
    true,
  );
  const tasks = [...activeTasks, ...completedTasks];

  const byId = new Map<string, TaskRecord>();
  for (const task of tasks) {
    if (byId.has(task.taskId)) {
      throw new Error(`duplicate task_id: ${task.taskId}`);
    }
    byId.set(task.taskId, task);
  }
  return tasks;
}

async function loadTaskDirectory(
  taskDirectory: string,
  completed: boolean,
): Promise<TaskRecord[]> {
  let directoryStats;
  try {
    directoryStats = await lstat(taskDirectory);
  } catch (error: unknown) {
    if (completed && hasErrorCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(
      `${completed ? 'completed tasks' : 'tasks'} path must be a real directory`,
    );
  }
  const canonicalDirectory = await realpath(taskDirectory);
  const canonicalStats = await stat(canonicalDirectory);
  assertSameDirectory(directoryStats, canonicalStats, completed);

  const entries = await readdir(taskDirectory, { withFileTypes: true });
  await assertDirectoryUnchanged(
    taskDirectory,
    canonicalDirectory,
    directoryStats,
    completed,
  );
  const candidateNames = entries
    .filter((entry) => TASK_LIKE_FILE_PATTERN.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const tasks: TaskRecord[] = [];

  for (const name of candidateNames) {
    if (!TASK_FILE_PATTERN.test(name.name)) {
      throw new Error(`invalid task filename: ${name.name}`);
    }
    const filePath = path.join(taskDirectory, name.name);
    if (name.isSymbolicLink()) {
      throw new Error(`task file must not be a symbolic link: ${name.name}`);
    }
    if (!name.isFile()) {
      throw new Error(`task path must be a regular file: ${name.name}`);
    }
    const task = parseTask(
      await readTaskFile(filePath, name.name, canonicalDirectory),
      filePath,
    );
    if (`${task.taskId}.md` !== name.name) {
      throw new Error(
        `task_id ${task.taskId} does not match filename ${name.name}`,
      );
    }
    if (completed && task.status !== 'done') {
      throw new Error(`completed task must have done status: ${task.taskId}`);
    }
    if (!completed && task.status === 'done') {
      throw new Error(`done task must be in completed folder: ${task.taskId}`);
    }
    tasks.push(task);
  }
  await assertDirectoryUnchanged(
    taskDirectory,
    canonicalDirectory,
    directoryStats,
    completed,
  );
  return tasks;
}

async function assertDirectoryUnchanged(
  taskDirectory: string,
  canonicalDirectory: string,
  originalStats: Stats,
  completed: boolean,
): Promise<void> {
  const currentStats = await lstat(taskDirectory);
  if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
    throw directoryChangedError(completed);
  }
  const currentCanonicalDirectory = await realpath(taskDirectory);
  if (currentCanonicalDirectory !== canonicalDirectory) {
    throw directoryChangedError(completed);
  }
  assertSameDirectory(originalStats, currentStats, completed);
}

function assertSameDirectory(
  originalStats: Stats,
  currentStats: Stats,
  completed: boolean,
): void {
  if (
    !currentStats.isDirectory() ||
    originalStats.dev !== currentStats.dev ||
    originalStats.ino !== currentStats.ino
  ) {
    throw directoryChangedError(completed);
  }
}

function directoryChangedError(completed: boolean): Error {
  return new Error(
    `${completed ? 'completed tasks' : 'tasks'} directory changed while being read`,
  );
}

async function readTaskFile(
  filePath: string,
  fileName: string,
  canonicalDirectory: string,
): Promise<string> {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ELOOP')) {
      throw new Error(`task file must not be a symbolic link: ${fileName}`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) {
      throw new Error(`task path must be a regular file: ${fileName}`);
    }
    if (openedStats.size > MAX_TASK_BYTES) {
      throw new Error(`task file exceeds ${MAX_TASK_BYTES} bytes: ${fileName}`);
    }
    const resolvedPath = await realpath(filePath);
    const relativePath = path.relative(canonicalDirectory, resolvedPath);
    if (
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath) ||
      relativePath.includes(path.sep)
    ) {
      throw new Error(`task file resolves outside its directory: ${fileName}`);
    }
    const resolvedStats = await stat(resolvedPath);
    if (
      openedStats.dev !== resolvedStats.dev ||
      openedStats.ino !== resolvedStats.ino
    ) {
      throw new Error(`task file changed while being read: ${fileName}`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

export function selectReadyTask(tasks: TaskRecord[]): TaskSelection {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const activeTasks = tasks.flatMap((task) =>
    task.status === 'in_progress' || task.status === 'review'
      ? [{ taskId: task.taskId, status: task.status }]
      : [],
  );
  if (activeTasks.length > 0) {
    return { kind: 'active', tasks: activeTasks };
  }
  const blocked: Array<{
    taskId: string;
    dependencies: DependencyBlocker[];
  }> = [];

  for (const task of tasks) {
    if (task.status !== 'ready') {
      continue;
    }
    const dependencies = task.dependsOn.flatMap((taskId) => {
      const dependency = byId.get(taskId);
      return dependency?.status === 'done'
        ? []
        : [{ taskId, status: dependency?.status ?? ('missing' as const) }];
    });
    if (dependencies.length === 0) {
      return { kind: 'selected', task };
    }
    blocked.push({ taskId: task.taskId, dependencies });
  }

  return blocked.length > 0
    ? { kind: 'blocked', tasks: blocked }
    : { kind: 'none' };
}

export async function selectProjectTask(
  projectDirectory: string,
): Promise<TaskSelection> {
  return selectReadyTask(await loadTaskCatalog(projectDirectory));
}

function parseTask(contents: string, filePath: string): TaskRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (match === null) {
    throw new Error(
      `task is missing YAML front matter: ${path.basename(filePath)}`,
    );
  }

  let value: unknown;
  try {
    value = parse(match[1] ?? '');
  } catch (error: unknown) {
    throw new Error(`invalid task YAML in ${path.basename(filePath)}`, {
      cause: error,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `task front matter must be a mapping: ${path.basename(filePath)}`,
    );
  }
  const fields = value as Record<string, unknown>;
  const unexpected = Object.keys(fields).find((key) => !TASK_KEYS.has(key));
  if (unexpected !== undefined) {
    throw new Error(
      `unknown task field ${unexpected}: ${path.basename(filePath)}`,
    );
  }

  const taskId = requiredString(fields, 'task_id', filePath);
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`invalid task_id: ${taskId}`);
  }
  const status = requiredString(fields, 'status', filePath);
  if (!isTaskStatus(status)) {
    throw new Error(`invalid task status for ${taskId}: ${status}`);
  }
  const dependsOn = fields.depends_on;
  if (
    !Array.isArray(dependsOn) ||
    !dependsOn.every(
      (dependency) =>
        typeof dependency === 'string' && TASK_ID_PATTERN.test(dependency),
    )
  ) {
    throw new Error(`depends_on must contain task IDs: ${taskId}`);
  }
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new Error(`depends_on contains duplicates: ${taskId}`);
  }
  if (dependsOn.includes(taskId)) {
    throw new Error(`task cannot depend on itself: ${taskId}`);
  }

  for (const field of [
    'priority',
    'risk',
    'owner',
    'last_updated',
    'qa',
    'deployment',
    'pull_request',
  ]) {
    requiredString(fields, field, filePath);
  }
  const branch = requiredString(fields, 'branch', filePath);

  const title = requiredString(fields, 'title', filePath);
  if ([...title].some(isControlCharacter)) {
    throw new Error(`title must not contain control characters: ${taskId}`);
  }

  return {
    taskId,
    title,
    status,
    dependsOn: [...dependsOn],
    branch,
    filePath,
    contents,
  };
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  );
}

function requiredString(
  fields: Record<string, unknown>,
  field: string,
  filePath: string,
): string {
  const value = fields[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${field} must be a non-empty string: ${path.basename(filePath)}`,
    );
  }
  return value;
}

function isTaskStatus(status: string): status is TaskStatus {
  return TASK_STATUSES.some((candidate) => candidate === status);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
