import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadTaskCatalog, selectProjectTask } from './tasks.js';

async function temporaryProject(): Promise<string> {
  const project = await mkdtemp(path.join(os.tmpdir(), 'autocode-tasks-'));
  await mkdir(path.join(project, 'tasks'));
  await mkdir(path.join(project, 'tasks', 'completed'));
  return project;
}

async function writeTask(
  project: string,
  taskId: string,
  status: string,
  dependsOn: string[] = [],
): Promise<void> {
  await writeFile(
    path.join(project, 'tasks', `${taskId}.md`),
    `---\ntask_id: ${taskId}\ntitle: Task ${taskId}\nstatus: ${status}\npriority: high\nrisk: low\ndepends_on: [${dependsOn.join(', ')}]\nbranch: feat/${taskId}\nowner: unassigned\nlast_updated: 2026-09-02\nqa: not_applicable\ndeployment: not_applicable\npull_request: required\n---\n`,
  );
}

async function completeTask(project: string, taskId: string): Promise<void> {
  await writeTask(project, taskId, 'done');
  await import('node:fs/promises').then(({ rename }) =>
    rename(
      path.join(project, 'tasks', `${taskId}.md`),
      path.join(project, 'tasks', 'completed', `${taskId}.md`),
    ),
  );
}

test('selects the first ready task with completed dependencies', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-003', 'ready', ['AC-001']);
    await completeTask(project, 'AC-001');
    await writeTask(project, 'AC-002', 'ready', ['AC-001']);

    const selection = await selectProjectTask(project);
    assert.equal(selection.kind, 'selected');
    if (selection.kind === 'selected') {
      assert.equal(selection.task.taskId, 'AC-002');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('selects an independent task before a completed folder exists', async () => {
  const project = await temporaryProject();
  try {
    await rm(path.join(project, 'tasks', 'completed'), { recursive: true });
    await writeTask(project, 'AC-001', 'ready');
    const selection = await selectProjectTask(project);
    assert.equal(selection.kind, 'selected');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports missing and incomplete dependencies without selecting', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'review');
    await writeTask(project, 'AC-002', 'ready', ['AC-001', 'AC-099']);

    assert.deepEqual(await selectProjectTask(project), {
      kind: 'blocked',
      tasks: [
        {
          taskId: 'AC-002',
          dependencies: [
            { taskId: 'AC-001', status: 'review' },
            { taskId: 'AC-099', status: 'missing' },
          ],
        },
      ],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('skips completed tasks and reports no ready work', async () => {
  const project = await temporaryProject();
  try {
    await completeTask(project, 'AC-001');
    assert.deepEqual(await selectProjectTask(project), { kind: 'none' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects malformed task front matter', async () => {
  const project = await temporaryProject();
  try {
    await writeFile(path.join(project, 'tasks', 'AC-001.md'), 'not a task');
    await assert.rejects(
      () => loadTaskCatalog(project),
      /missing YAML front matter/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a task whose identity does not match its filename', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'ready');
    const contents = await import('node:fs/promises').then(({ readFile }) =>
      readFile(path.join(project, 'tasks', 'AC-001.md'), 'utf8'),
    );
    await writeFile(
      path.join(project, 'tasks', 'AC-001.md'),
      contents.replace('task_id: AC-001', 'task_id: AC-002'),
    );
    await assert.rejects(
      () => loadTaskCatalog(project),
      /does not match filename/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects malformed task-like filenames instead of omitting them', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'ready');
    await writeFile(path.join(project, 'tasks', 'AC-02.md'), 'malformed');
    await assert.rejects(
      () => loadTaskCatalog(project),
      /invalid task filename/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link task directory', async () => {
  const project = await temporaryProject();
  const external = await temporaryProject();
  try {
    await writeTask(external, 'AC-001', 'ready');
    await rm(path.join(project, 'tasks'), { recursive: true });
    await symlink(
      path.join(external, 'tasks'),
      path.join(project, 'tasks'),
      'junction',
    );
    await assert.rejects(() => loadTaskCatalog(project), /real directory/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link completed-task directory', async () => {
  const project = await temporaryProject();
  const external = await temporaryProject();
  try {
    await completeTask(external, 'AC-001');
    await rm(path.join(project, 'tasks', 'completed'), { recursive: true });
    await symlink(
      path.join(external, 'tasks', 'completed'),
      path.join(project, 'tasks', 'completed'),
      'junction',
    );
    await assert.rejects(() => loadTaskCatalog(project), /real directory/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('rejects a non-done task in the completed folder', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'ready');
    await import('node:fs/promises').then(({ rename }) =>
      rename(
        path.join(project, 'tasks', 'AC-001.md'),
        path.join(project, 'tasks', 'completed', 'AC-001.md'),
      ),
    );
    await assert.rejects(
      () => loadTaskCatalog(project),
      /completed task must have done status/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a done task left in the active folder', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'done');
    await assert.rejects(
      () => loadTaskCatalog(project),
      /done task must be in completed folder/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
