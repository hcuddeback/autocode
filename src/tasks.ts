import { constants, type Stats } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse } from 'yaml';
import { gitInspectionArguments } from './git-inspection.js';
import { readStableRegularFile } from './safe-files.js';

const TASK_DIRECTORY = 'tasks';
const COMPLETED_TASK_DIRECTORY = 'completed';
const TASK_FILE_PATTERN = /^AC-\d{3}\.md$/;
const TASK_LIKE_FILE_PATTERN = /^AC-.*\.md$/i;
const TASK_ID_PATTERN = /^AC-\d{3}$/;
const MAX_TASK_BYTES = 256 * 1024;
const MAX_TASK_RECORDS = 512;
const MAX_WORKBOOK_BYTES = 512 * 1024;
const WORKBOOK_HEADING = '## Canonical MVP 1 sequence';
const WORKBOOK_COLUMNS = [
  'Order',
  'Task',
  'Workbook outcome',
  'Product criteria',
  'State',
] as const;
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
export type PullRequestPolicy = 'required' | 'not_applicable';

export interface TaskRecord {
  taskId: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  branch: string;
  pullRequest: PullRequestPolicy;
  filePath: string;
  contents: string;
}

export type WorkbookState = 'done' | 'ready' | 'waiting' | 'blocked';

export interface WorkbookEntry {
  readonly order: number;
  readonly taskId: string;
  readonly state: WorkbookState;
  readonly reason: string | null;
}

export interface CanonicalWorkbook {
  readonly filePath: string;
  readonly contents: string;
  readonly sha256: string;
  readonly entries: readonly WorkbookEntry[];
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
      tasks: Array<{
        taskId: string;
        dependencies: DependencyBlocker[];
        reason?: string;
      }>;
    }
  | { kind: 'none' };

export type ProjectTaskSelection =
  | ({ kind: 'selected'; workbook: CanonicalWorkbook } & Extract<
      TaskSelection,
      { kind: 'selected' }
    >)
  | Exclude<TaskSelection, { kind: 'selected' }>;

export interface ProjectTaskSelectionOptions {
  readonly allowActive?: boolean;
}

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
  if (tasks.length > MAX_TASK_RECORDS)
    throw new Error(`task catalog exceeds ${MAX_TASK_RECORDS} records`);

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

export async function selectProjectTask(
  projectDirectory: string,
  options: ProjectTaskSelectionOptions = {},
): Promise<ProjectTaskSelection> {
  const root = await realpath(path.resolve(projectDirectory));
  const taskDirectory = path.join(root, TASK_DIRECTORY);
  const before = await stableDirectoryIdentity(
    taskDirectory,
    'tasks directory',
  );
  const tasks = await loadTaskCatalog(root);
  const workbook = await loadCanonicalWorkbook(root);
  const after = await stableDirectoryIdentity(taskDirectory, 'tasks directory');
  if (
    before.canonicalPath !== after.canonicalPath ||
    before.stats.dev !== after.stats.dev ||
    before.stats.ino !== after.stats.ino
  )
    throw new Error('tasks directory changed while project inputs were read');
  const selection = selectWorkbookTask(workbook, tasks);
  const selectedTask =
    selection.kind === 'selected'
      ? selection.task
      : selection.kind === 'active' && options.allowActive
        ? tasks.find((task) => task.taskId === selection.tasks[0]!.taskId)
        : undefined;
  await assertCompletedRecordsInHead(root, workbook, tasks, selectedTask);
  if (selection.kind === 'active' && selectedTask !== undefined)
    return { kind: 'selected', task: selectedTask, workbook };
  if (selection.kind !== 'selected') return selection;
  return { ...selection, workbook };
}

export async function assertSelectedInputsInHead(
  projectDirectory: string,
  selection: Extract<ProjectTaskSelection, { kind: 'selected' }>,
): Promise<void> {
  const root = await realpath(path.resolve(projectDirectory));
  const current = await selectProjectTask(root, { allowActive: true });
  if (current.kind !== 'selected')
    throw new Error('selected workbook inputs changed during intake');
  await assertTrackedInputInHead(
    root,
    'tasks/README.md',
    current.workbook.contents,
    'canonical workbook',
  );
  await assertTrackedInputInHead(
    root,
    `tasks/${selection.task.taskId}.md`,
    current.task.contents,
    `active task record ${selection.task.taskId}`,
  );
  if (
    current.task.taskId !== selection.task.taskId ||
    current.workbook.sha256 !== selection.workbook.sha256 ||
    current.task.contents !== selection.task.contents
  )
    throw new Error('selected workbook inputs changed during intake');
}

export async function loadCanonicalWorkbook(
  projectDirectory: string,
): Promise<CanonicalWorkbook> {
  const root = await realpath(path.resolve(projectDirectory));
  const taskDirectory = path.join(root, TASK_DIRECTORY);
  const taskDirectoryReal = await realpath(taskDirectory);
  if (path.dirname(taskDirectoryReal) !== root)
    throw new Error('tasks directory escapes project');
  const filePath = path.join(taskDirectoryReal, 'README.md');
  const contents = await readBoundedRegularFile(
    filePath,
    MAX_WORKBOOK_BYTES,
    'canonical workbook',
  );
  const entries = parseCanonicalWorkbook(contents);
  return Object.freeze({
    filePath,
    contents,
    sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
    entries,
  });
}

export function parseCanonicalWorkbook(
  contents: string,
): readonly WorkbookEntry[] {
  if (Buffer.byteLength(contents, 'utf8') > MAX_WORKBOOK_BYTES)
    throw new Error('canonical workbook exceeds size limit');
  const lines = contents.replaceAll('\r\n', '\n').split('\n');
  const headings = lines.flatMap((line, index) =>
    line === WORKBOOK_HEADING ? [index] : [],
  );
  if (headings.length !== 1)
    throw new Error(
      'canonical workbook must contain exactly one sequence heading',
    );
  const start = headings[0]! + 1;
  const endOffset = lines.slice(start).findIndex((line) => /^##\s/.test(line));
  const section = lines.slice(
    start,
    endOffset === -1 ? lines.length : start + endOffset,
  );
  const tableLines = section.filter((line) => line.startsWith('|'));
  if (tableLines.length < 3)
    throw new Error('canonical workbook sequence table is missing or empty');
  const rows = tableLines.map(parseWorkbookRow);
  if (
    rows[0]?.length !== WORKBOOK_COLUMNS.length ||
    rows[0].some((cell, index) => cell !== WORKBOOK_COLUMNS[index])
  )
    throw new Error('canonical workbook sequence columns are invalid');
  if (
    rows[1]?.length !== WORKBOOK_COLUMNS.length ||
    rows[1].some((cell) => !/^:?-{3,}:?$/.test(cell))
  )
    throw new Error('canonical workbook sequence separator is invalid');
  const entries = rows.slice(2).map((cells, index) => {
    if (cells.length !== WORKBOOK_COLUMNS.length)
      throw new Error('canonical workbook row has an invalid column count');
    if (
      cells.some(
        (cell) => cell.length === 0 || [...cell].some(isControlCharacter),
      )
    )
      throw new Error('canonical workbook row contains an invalid cell');
    const order = Number(cells[0]);
    if (!Number.isSafeInteger(order) || order !== index + 1)
      throw new Error('canonical workbook order must be contiguous from 1');
    const taskIds = [...cells[1]!.matchAll(/AC-\d{3}/g)].map(
      (match) => match[0],
    );
    const uniqueTaskIds = [...new Set(taskIds)];
    if (uniqueTaskIds.length !== 1)
      throw new Error('canonical workbook task cell must identify one task');
    const taskId = uniqueTaskIds[0]!;
    const stateMatch = /^`(done|ready|waiting|blocked)`(?:\s+(.+))?$/.exec(
      cells[4]!,
    );
    if (stateMatch === null)
      throw new Error(`canonical workbook state is invalid: ${taskId}`);
    const state = stateMatch[1] as WorkbookState;
    const reason = stateMatch[2] ?? null;
    if (
      ((state === 'waiting' || state === 'blocked') && reason === null) ||
      ((state === 'done' || state === 'ready') && reason !== null)
    )
      throw new Error(`canonical workbook state detail is invalid: ${taskId}`);
    assertWorkbookTaskCell(cells[1]!, taskId, state);
    return Object.freeze({
      order,
      taskId,
      state,
      reason,
    });
  });
  if (entries.length > 128)
    throw new Error('canonical workbook contains too many tasks');
  const ids = new Set<string>();
  let phase: WorkbookState = 'done';
  for (const entry of entries) {
    if (ids.has(entry.taskId))
      throw new Error(`duplicate workbook task: ${entry.taskId}`);
    ids.add(entry.taskId);
    if (entry.state === 'done') {
      if (phase !== 'done')
        throw new Error('done workbook tasks must precede unfinished tasks');
    } else if (entry.state === 'ready') {
      if (phase !== 'done')
        throw new Error('canonical workbook may contain only one ready task');
      phase = 'ready';
    } else {
      if (phase === 'done' && entry.state === 'waiting')
        throw new Error(
          'waiting workbook tasks require a ready or blocked predecessor',
        );
      if (phase === 'ready' || phase === 'done') phase = entry.state;
    }
  }
  return Object.freeze(entries);
}

export function selectWorkbookTask(
  workbook: CanonicalWorkbook,
  tasks: TaskRecord[],
): TaskSelection {
  validateTaskGraph(tasks);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  if (byId.size !== tasks.length)
    throw new Error('task catalog contains duplicate task IDs');
  const workbookIds = new Set(workbook.entries.map((entry) => entry.taskId));
  for (const entry of workbook.entries) {
    const task = byId.get(entry.taskId);
    if (entry.state === 'done') {
      if (task?.status !== 'done' || !isCompletedTask(task))
        throw new Error(
          `done workbook task lacks a completed record: ${entry.taskId}`,
        );
    } else if (entry.state === 'ready') {
      if (
        task === undefined ||
        isCompletedTask(task) ||
        !['ready', 'in_progress', 'review'].includes(task.status)
      )
        throw new Error(
          `ready workbook task lacks a matching active record: ${entry.taskId}`,
        );
    } else if (task !== undefined) {
      throw new Error(
        `unfinished future workbook task is materialized: ${entry.taskId}`,
      );
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const dependencyTask = byId.get(dependency);
      if (dependencyTask === undefined)
        throw new Error(
          `missing task dependency ${dependency} for ${task.taskId}`,
        );
      const taskOrder = workbook.entries.find(
        (entry) => entry.taskId === task.taskId,
      )?.order;
      const dependencyOrder = workbook.entries.find(
        (entry) => entry.taskId === dependency,
      )?.order;
      if (
        taskOrder !== undefined &&
        dependencyOrder !== undefined &&
        dependencyOrder >= taskOrder
      )
        throw new Error(
          `task dependency violates workbook order: ${task.taskId}`,
        );
    }
    if (
      !workbookIds.has(task.taskId) &&
      task.status !== 'done' &&
      task.status !== 'later' &&
      task.status !== 'canceled'
    )
      throw new Error(
        `active task is absent from canonical workbook: ${task.taskId}`,
      );
  }
  const activeTasks = tasks.flatMap((task) =>
    task.status === 'in_progress' || task.status === 'review'
      ? [{ taskId: task.taskId, status: task.status }]
      : [],
  );
  if (activeTasks.length > 1)
    throw new Error('multiple active tasks contradict single-task ownership');
  const ready = workbook.entries.find((entry) => entry.state === 'ready');
  if (
    activeTasks.length === 1 &&
    (ready === undefined || activeTasks[0]!.taskId !== ready.taskId)
  )
    throw new Error('active task contradicts the canonical ready task');
  if (ready === undefined) {
    const blocked = workbook.entries.find((entry) => entry.state === 'blocked');
    return blocked === undefined
      ? { kind: 'none' }
      : {
          kind: 'blocked',
          tasks: [
            {
              taskId: blocked.taskId,
              dependencies: [],
              reason: blocked.reason!,
            },
          ],
        };
  }
  const task = byId.get(ready.taskId)!;
  const dependencies = task.dependsOn.flatMap((taskId) => {
    const dependency = byId.get(taskId);
    return dependency?.status === 'done'
      ? []
      : [{ taskId, status: dependency?.status ?? ('missing' as const) }];
  });
  if (dependencies.length > 0)
    return { kind: 'blocked', tasks: [{ taskId: task.taskId, dependencies }] };
  if (activeTasks.length === 1) return { kind: 'active', tasks: activeTasks };
  return { kind: 'selected', task };
}

function parseWorkbookRow(line: string): string[] {
  if (!line.endsWith('|'))
    throw new Error('canonical workbook table row must end with a pipe');
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function assertWorkbookTaskCell(
  cell: string,
  taskId: string,
  state: WorkbookState,
): void {
  const expected =
    state === 'done'
      ? `[${taskId}](completed/${taskId}.md)`
      : state === 'ready'
        ? `[${taskId}](${taskId}.md)`
        : taskId;
  if (cell !== expected)
    throw new Error(`canonical workbook task link is invalid: ${taskId}`);
}

function isCompletedTask(task: TaskRecord): boolean {
  return (
    path.basename(path.dirname(task.filePath)) === COMPLETED_TASK_DIRECTORY
  );
}

export function validateTaskGraph(tasks: TaskRecord[]): void {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: TaskRecord): void => {
    if (visiting.has(task.taskId))
      throw new Error(`task dependency cycle includes ${task.taskId}`);
    if (visited.has(task.taskId)) return;
    visiting.add(task.taskId);
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined)
        throw new Error(
          `missing task dependency ${dependencyId} for ${task.taskId}`,
        );
      visit(dependency);
    }
    visiting.delete(task.taskId);
    visited.add(task.taskId);
  };
  for (const task of tasks) visit(task);
}

async function assertCompletedRecordsInHead(
  projectDirectory: string,
  workbook: CanonicalWorkbook,
  tasks: TaskRecord[],
  selectedTask: TaskRecord | undefined,
): Promise<void> {
  const root = await realpath(path.resolve(projectDirectory));
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const required = new Set(
    workbook.entries
      .filter((entry) => entry.state === 'done')
      .map((entry) => entry.taskId),
  );
  const visited = new Set<string>();
  const visitDependencies = (task: TaskRecord): void => {
    if (visited.has(task.taskId)) return;
    visited.add(task.taskId);
    for (const dependencyId of task.dependsOn) {
      required.add(dependencyId);
      visitDependencies(byId.get(dependencyId)!);
    }
  };
  if (selectedTask !== undefined) visitDependencies(selectedTask);
  for (const taskId of [...required]) visitDependencies(byId.get(taskId)!);
  for (const taskId of required) {
    const task = byId.get(taskId)!;
    if (task.status !== 'done' || !isCompletedTask(task))
      throw new Error(`dependency lacks a completed record: ${taskId}`);
    await assertTrackedInputInHead(
      root,
      `tasks/completed/${taskId}.md`,
      task.contents,
      `completed task record ${taskId}`,
      task.pullRequest === 'required' ? 'main' : undefined,
    );
  }
  if (
    [...required].some((taskId) => byId.get(taskId)!.pullRequest === 'required')
  )
    await assertTargetBranchAncestor(root, 'main');
}

async function assertTargetBranchAncestor(
  root: string,
  targetBranch: string,
): Promise<void> {
  try {
    await gitOutput(root, [
      'merge-base',
      '--is-ancestor',
      targetBranch,
      'HEAD',
    ]);
  } catch (error: unknown) {
    throw new Error(
      `current worktree does not contain target branch ${targetBranch}`,
      { cause: error },
    );
  }
}

async function stableDirectoryIdentity(directory: string, label: string) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory())
    throw new Error(`${label} must be a real directory`);
  const canonicalPath = await realpath(directory);
  const canonicalStats = await stat(canonicalPath);
  if (
    canonicalStats.dev !== stats.dev ||
    canonicalStats.ino !== stats.ino ||
    !canonicalStats.isDirectory()
  )
    throw new Error(`${label} identity changed`);
  return { canonicalPath, stats };
}

async function assertTrackedInputInHead(
  projectDirectory: string,
  relativePath: string,
  contents: string,
  label: string,
  revision = 'HEAD',
): Promise<void> {
  const root = await realpath(path.resolve(projectDirectory));
  const revisionLabel = revision === 'HEAD' ? 'current HEAD' : revision;
  let committed: string;
  try {
    committed = await gitOutput(root, ['show', `${revision}:${relativePath}`]);
  } catch (error: unknown) {
    throw new Error(`${label} is not present in ${revisionLabel}`, {
      cause: error,
    });
  }
  if (committed.replaceAll('\r\n', '\n') !== contents.replaceAll('\r\n', '\n'))
    throw new Error(`${label} differs from ${revisionLabel}`);
}

async function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
): Promise<string> {
  try {
    return await readStableRegularFile(filePath, maximumBytes, label);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      /bounded regular file|changed while/.test(error.message)
    )
      throw error;
    throw new Error(`${label} must be a regular file`, { cause: error });
  }
}

function gitOutput(
  root: string,
  arguments_: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      gitInspectionArguments(root, arguments_),
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_WORKBOOK_BYTES,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
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
  ]) {
    requiredString(fields, field, filePath);
  }
  const branch = requiredString(fields, 'branch', filePath);
  const pullRequestValue = requiredString(fields, 'pull_request', filePath);
  if (pullRequestValue !== 'required' && pullRequestValue !== 'not_applicable')
    throw new Error(`pull_request is invalid: ${taskId}`);
  const pullRequest = pullRequestValue;
  if ([...branch].some(isControlCharacter)) {
    throw new Error(`branch must not contain control characters: ${taskId}`);
  }

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
    pullRequest,
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
