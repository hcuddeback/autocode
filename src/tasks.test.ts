import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  loadTaskCatalog,
  parseCanonicalWorkbook,
  assertSelectedInputsInHead,
  selectProjectTask,
  selectWorkbookTask,
  type CanonicalWorkbook,
  type WorkbookState,
} from './tasks.js';

const exec = promisify(execFile);

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

function workbook(
  entries: Array<[taskId: string, state: WorkbookState]>,
): CanonicalWorkbook {
  const contents = `# Workbook\n\n## Canonical MVP 1 sequence\n\n| Order | Task | Workbook outcome | Product criteria | State |\n| --- | --- | --- | --- | --- |\n${entries
    .map(
      ([taskId, state], index) =>
        `| ${index + 1} | ${state === 'done' ? `[${taskId}](completed/${taskId}.md)` : state === 'ready' ? `[${taskId}](${taskId}.md)` : taskId} | Outcome | M1-01 | \`${state}\`${state === 'waiting' ? ' on fixture predecessor' : state === 'blocked' ? ' by fixture policy' : ''} |`,
    )
    .join('\n')}\n\n## Next\n`;
  return {
    filePath: 'tasks/README.md',
    contents,
    sha256: '0'.repeat(64),
    entries: parseCanonicalWorkbook(contents),
  };
}

test('selects the first ready task with completed dependencies', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-003', 'later', ['AC-001']);
    await completeTask(project, 'AC-001');
    await writeTask(project, 'AC-002', 'ready', ['AC-001']);

    const selection = selectWorkbookTask(
      workbook([
        ['AC-001', 'done'],
        ['AC-002', 'ready'],
      ]),
      await loadTaskCatalog(project),
    );
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
    const selection = selectWorkbookTask(
      workbook([['AC-001', 'ready']]),
      await loadTaskCatalog(project),
    );
    assert.equal(selection.kind, 'selected');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects missing dependency records before selection', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'blocked');
    await writeTask(project, 'AC-002', 'ready', ['AC-001', 'AC-099']);

    await assert.rejects(
      async () =>
        selectWorkbookTask(
          workbook([
            ['AC-001', 'blocked'],
            ['AC-002', 'waiting'],
          ]),
          await loadTaskCatalog(project),
        ),
      /unfinished future workbook task is materialized|missing task dependency/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports the canonical ready task separately while its finer status is active', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'review');
    await writeTask(project, 'AC-002', 'later');

    const selection = selectWorkbookTask(
      workbook([['AC-001', 'ready']]),
      await loadTaskCatalog(project),
    );
    assert.deepEqual(selection, {
      kind: 'active',
      tasks: [{ taskId: 'AC-001', status: 'review' }],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('project selection can opt into resuming the canonical active task', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'review');
    await writeFile(
      path.join(project, 'tasks', 'README.md'),
      workbook([['AC-001', 'ready']]).contents,
    );
    await exec('git', ['init', '-b', 'main'], { cwd: project });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: project,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: project });
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'active fixture'], { cwd: project });

    assert.equal((await selectProjectTask(project)).kind, 'active');
    const resumable = await selectProjectTask(project, { allowActive: true });
    assert.equal(resumable.kind, 'selected');
    if (resumable.kind === 'selected')
      assert.equal(resumable.task.status, 'review');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('skips completed tasks and reports no ready work', async () => {
  const project = await temporaryProject();
  try {
    await completeTask(project, 'AC-001');
    assert.deepEqual(
      selectWorkbookTask(
        workbook([['AC-001', 'done']]),
        await loadTaskCatalog(project),
      ),
      { kind: 'none' },
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports the first declared workbook blocker without materializing it', () => {
  assert.deepEqual(selectWorkbookTask(workbook([['AC-001', 'blocked']]), []), {
    kind: 'blocked',
    tasks: [
      {
        taskId: 'AC-001',
        dependencies: [],
        reason: 'by fixture policy',
      },
    ],
  });
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

test('rejects unknown pull-request policy values', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'ready');
    const taskPath = path.join(project, 'tasks', 'AC-001.md');
    await writeFile(
      taskPath,
      (await readFile(taskPath, 'utf8')).replace(
        'pull_request: required',
        'pull_request: require',
      ),
    );
    await assert.rejects(
      () => loadTaskCatalog(project),
      /pull_request is invalid: AC-001/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects control characters in an untrusted task title', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'ready');
    const taskPath = path.join(project, 'tasks', 'AC-001.md');
    const contents = await import('node:fs/promises').then(({ readFile }) =>
      readFile(taskPath, 'utf8'),
    );
    await writeFile(
      taskPath,
      contents.replace(
        'title: Task AC-001',
        'title: "Task AC-001\\nForged output\\u001b[31m"',
      ),
    );
    await assert.rejects(
      () => loadTaskCatalog(project),
      /title must not contain control characters/,
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

test('rejects duplicate IDs, noncontiguous order, and multiple ready rows', () => {
  const base = `# Workbook\n\n## Canonical MVP 1 sequence\n\n| Order | Task | Workbook outcome | Product criteria | State |\n| --- | --- | --- | --- | --- |\n`;
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 1 | [AC-001](completed/AC-001.md) | One | M1-01 | \`done\` |\n| 2 | [AC-001](completed/AC-001.md) | Duplicate | M1-01 | \`done\` |\n\n## Next\n`,
      ),
    /duplicate workbook task/,
  );
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 2 | [AC-001](AC-001.md) | One | M1-01 | \`ready\` |\n\n## Next\n`,
      ),
    /contiguous from 1/,
  );
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 1 | [AC-001](AC-001.md) | One | M1-01 | \`ready\` |\n| 2 | [AC-002](AC-002.md) | Two | M1-01 | \`ready\` |\n\n## Next\n`,
      ),
    /only one ready task/,
  );
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 1 | [AC-001](completed/AC-001.md) | Wrong link | M1-01 | \`ready\` |\n\n## Next\n`,
      ),
    /task link is invalid/,
  );
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 1 | [AC-001](AC-001.md) |  | M1-01 | \`ready\` |\n\n## Next\n`,
      ),
    /invalid cell/,
  );
  assert.throws(
    () =>
      parseCanonicalWorkbook(
        `${base}| 1 | AC-001 | One | M1-01 | \`blocked\` |\n\n## Next\n`,
      ),
    /state detail is invalid/,
  );
});

test('rejects dependency cycles before eligibility', async () => {
  const project = await temporaryProject();
  try {
    await writeTask(project, 'AC-001', 'later', ['AC-002']);
    await writeTask(project, 'AC-002', 'later', ['AC-001']);
    const catalog = await loadTaskCatalog(project);
    assert.throws(
      () =>
        selectWorkbookTask(workbook([['AC-003', 'ready']]), [
          ...catalog,
          {
            taskId: 'AC-003',
            title: 'Task AC-003',
            status: 'ready',
            dependsOn: [],
            branch: 'feat/AC-003',
            pullRequest: 'required',
            filePath: path.join(project, 'tasks', 'AC-003.md'),
            contents: '',
          },
        ]),
      /dependency cycle/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('project selection requires current Git evidence for predecessors and ownership inputs', async () => {
  const project = await temporaryProject();
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: project });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: project,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: project });
    await completeTask(project, 'AC-001');
    await writeTask(project, 'AC-002', 'ready', ['AC-001']);
    const canonical = workbook([['AC-002', 'ready']]);
    await writeFile(
      path.join(project, 'tasks', 'README.md'),
      canonical.contents,
    );
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'fixture'], { cwd: project });

    const selected = await selectProjectTask(project);
    assert.equal(selected.kind, 'selected');
    if (selected.kind === 'selected')
      assert.equal(selected.task.taskId, 'AC-002');

    const workbookPath = path.join(project, 'tasks', 'README.md');
    await writeFile(
      workbookPath,
      canonical.contents.replace('Outcome', 'Changed outcome'),
    );
    await assert.rejects(
      () => assertSelectedInputsInHead(project, selected),
      /canonical workbook differs from current HEAD/,
    );
    await writeFile(workbookPath, canonical.contents);

    const activePath = path.join(project, 'tasks', 'AC-002.md');
    const activeContents = (await loadTaskCatalog(project)).find(
      (task) => task.taskId === 'AC-002',
    )!.contents;
    await writeFile(activePath, `${activeContents}\nchanged\n`);
    await assert.rejects(
      () => assertSelectedInputsInHead(project, selected),
      /active task record AC-002 differs from current HEAD/,
    );
    await writeFile(activePath, activeContents);

    await writeFile(
      path.join(project, 'tasks', 'completed', 'AC-001.md'),
      `${(await loadTaskCatalog(project)).find((task) => task.taskId === 'AC-001')!.contents}\nchanged\n`,
    );
    await assert.rejects(
      () => selectProjectTask(project),
      /completed task record AC-001 differs from main/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('a PR-required predecessor must be complete on the target branch', async () => {
  const project = await temporaryProject();
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: project });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: project,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: project });
    await writeFile(path.join(project, 'README.md'), 'fixture\n');
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'base'], { cwd: project });
    await exec('git', ['switch', '-c', 'feat/local-completion'], {
      cwd: project,
    });
    await completeTask(project, 'AC-001');
    await writeTask(project, 'AC-002', 'ready', ['AC-001']);
    await writeFile(
      path.join(project, 'tasks', 'README.md'),
      workbook([
        ['AC-001', 'done'],
        ['AC-002', 'ready'],
      ]).contents,
    );
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'local completion'], { cwd: project });

    await assert.rejects(
      () => selectProjectTask(project),
      /completed task record AC-001 is not present in main/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('the target branch must be an ancestor of the selected worktree', async () => {
  const project = await temporaryProject();
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: project });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: project,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: project });
    await writeFile(path.join(project, 'README.md'), 'fixture\n');
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'base'], { cwd: project });
    await exec('git', ['switch', '-c', 'feat/stale'], { cwd: project });
    await exec('git', ['switch', 'main'], { cwd: project });
    await completeTask(project, 'AC-001');
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'merge predecessor'], { cwd: project });
    await exec('git', ['switch', 'feat/stale'], { cwd: project });
    await exec('git', ['checkout', 'main', '--', 'tasks/completed/AC-001.md'], {
      cwd: project,
    });
    await writeTask(project, 'AC-002', 'ready', ['AC-001']);
    await writeFile(
      path.join(project, 'tasks', 'README.md'),
      workbook([
        ['AC-001', 'done'],
        ['AC-002', 'ready'],
      ]).contents,
    );
    await exec('git', ['add', '.'], { cwd: project });
    await exec('git', ['commit', '-m', 'copy completion metadata'], {
      cwd: project,
    });

    await assert.rejects(
      () => selectProjectTask(project),
      /does not contain target branch main/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
