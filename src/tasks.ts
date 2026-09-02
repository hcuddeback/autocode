import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const TASK_DIRECTORY = 'tasks';
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
  filePath: string;
}

export interface DependencyBlocker {
  taskId: string;
  status: TaskStatus | 'missing';
}

export type TaskSelection =
  | { kind: 'selected'; task: TaskRecord }
  | {
      kind: 'blocked';
      tasks: Array<{ taskId: string; dependencies: DependencyBlocker[] }>;
    }
  | { kind: 'none' };

export async function loadTaskCatalog(
  projectDirectory: string,
): Promise<TaskRecord[]> {
  const taskDirectory = path.join(projectDirectory, TASK_DIRECTORY);
  const directoryStats = await lstat(taskDirectory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error('tasks path must be a real directory');
  }

  const entries = await readdir(taskDirectory, { withFileTypes: true });
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
    const task = parseTask(await readTaskFile(filePath, name.name), filePath);
    if (`${task.taskId}.md` !== name.name) {
      throw new Error(
        `task_id ${task.taskId} does not match filename ${name.name}`,
      );
    }
    tasks.push(task);
  }

  const byId = new Map<string, TaskRecord>();
  for (const task of tasks) {
    if (byId.has(task.taskId)) {
      throw new Error(`duplicate task_id: ${task.taskId}`);
    }
    byId.set(task.taskId, task);
  }
  return tasks;
}

async function readTaskFile(
  filePath: string,
  fileName: string,
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
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(`task path must be a regular file: ${fileName}`);
    }
    if (stats.size > MAX_TASK_BYTES) {
      throw new Error(`task file exceeds ${MAX_TASK_BYTES} bytes: ${fileName}`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

export function selectReadyTask(tasks: TaskRecord[]): TaskSelection {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
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
    'branch',
    'owner',
    'last_updated',
    'qa',
    'deployment',
    'pull_request',
  ]) {
    requiredString(fields, field, filePath);
  }

  return {
    taskId,
    title: requiredString(fields, 'title', filePath),
    status,
    dependsOn: [...dependsOn],
    filePath,
  };
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
