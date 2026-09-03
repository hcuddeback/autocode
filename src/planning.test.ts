import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { initializeProject } from './config.js';
import { prepareImplementationPlan } from './planning.js';

const execFileAsync = promisify(execFile);

async function fixtureProject(branch = 'feat/AC-003'): Promise<string> {
  const project = await mkdtemp(path.join(os.tmpdir(), 'autocode-planning-'));
  await mkdir(path.join(project, 'tasks', 'completed'), { recursive: true });
  await writeTask(project, 'AC-001', 'done', [], true);
  await writeTask(project, 'AC-002', 'done', ['AC-001'], true);
  await writeTask(project, 'AC-003', 'ready', ['AC-002']);
  await writeTask(
    project,
    'AC-004',
    'later',
    ['AC-003'],
    false,
    'LATER_SECRET_SCOPE',
  );
  await git(project, ['init', '-b', branch]);
  await git(project, ['config', 'user.email', 'fixture@example.invalid']);
  await git(project, ['config', 'user.name', 'Fixture']);
  await initializeProject(project);
  await git(project, ['add', '--', '.']);
  await git(project, ['commit', '-m', 'fixture']);
  return project;
}

async function writeTask(
  project: string,
  taskId: string,
  status: string,
  dependsOn: string[],
  completed = false,
  uniqueText = '',
): Promise<void> {
  const directory = completed
    ? path.join(project, 'tasks', 'completed')
    : path.join(project, 'tasks');
  await writeFile(
    path.join(directory, `${taskId}.md`),
    `---
task_id: ${taskId}
title: Task ${taskId}
status: ${status}
priority: high
risk: low
depends_on: [${dependsOn.join(', ')}]
branch: feat/${taskId}
owner: unassigned
last_updated: 2026-09-02
qa: not_applicable
deployment: not_applicable
pull_request: required
---

# Outcome

Deliver ${taskId}. ${uniqueText}

## Why now

Required for the fixture milestone.

## Required context

- docs/PRODUCT.md

## Scope

### In

- This task only.

### Out

- Later tasks.

## Implementation constraints

- Preserve project boundaries.

## Done when

- [ ] The task result is observable.

## Deterministic validation

- [ ] Tests: pnpm test

## Independent critical-review focus

- Safety and correctness.

## QA

Not applicable.

## PR, merge, and production gates

- PR required.

## Files/areas expected

- src/

## Manual owner steps or blockers

None.
`,
  );
}

test('creates commit-bound artifacts for only the selected task', async () => {
  const project = await fixtureProject();
  try {
    const result = await prepareImplementationPlan(project);
    assert.equal(result.kind, 'created');
    assert.equal(result.metadata.taskId, 'AC-003');
    assert.equal(result.metadata.taskPath, 'tasks/AC-003.md');
    assert.match(result.metadata.headCommit, /^[0-9a-f]{40}$/);

    const snapshot = await readFile(
      path.join(result.runDirectory, 'task.md'),
      'utf8',
    );
    const plan = await readFile(
      path.join(result.runDirectory, 'plan.md'),
      'utf8',
    );
    assert.match(snapshot, /Deliver AC-003/);
    assert.doesNotMatch(snapshot, /LATER_SECRET_SCOPE/);
    assert.doesNotMatch(plan, /AC-004|LATER_SECRET_SCOPE/);
    assert.match(plan, new RegExp(result.metadata.headCommit));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reuses matching artifacts without overwriting an edited plan', async () => {
  const project = await fixtureProject();
  try {
    const first = await prepareImplementationPlan(project);
    const planPath = path.join(first.runDirectory, 'plan.md');
    await writeFile(planPath, '# Operator plan\n');

    const second = await prepareImplementationPlan(project);
    assert.equal(second.kind, 'existing');
    assert.equal(second.runDirectory, first.runDirectory);
    assert.equal(await readFile(planPath, 'utf8'), '# Operator plan\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects conflicting existing artifacts', async () => {
  const project = await fixtureProject();
  try {
    const result = await prepareImplementationPlan(project);
    await writeFile(path.join(result.runDirectory, 'task.md'), 'changed\n');
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /artifacts conflict/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects task contracts with template placeholders', async () => {
  const project = await fixtureProject();
  try {
    const taskPath = path.join(project, 'tasks', 'AC-003.md');
    await writeFile(
      taskPath,
      (await readFile(taskPath, 'utf8')).replace(
        'pnpm test',
        'PENDING_REAL_COMMAND',
      ),
    );
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /template placeholder/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects remaining editable placeholders copied from the task template', async () => {
  const placeholders = [
    'Describe one observable user or system result.',
    'Important integration boundaries.',
    'Likely paths/components',
  ];
  for (const placeholder of placeholders) {
    const project = await fixtureProject();
    try {
      const taskPath = path.join(project, 'tasks', 'AC-003.md');
      await writeFile(
        taskPath,
        (await readFile(taskPath, 'utf8')).replace(
          'Deliver AC-003.',
          placeholder,
        ),
      );
      await assert.rejects(
        () => prepareImplementationPlan(project),
        /template placeholder/,
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('rejects a dirty worktree without creating planning artifacts', async () => {
  const project = await fixtureProject();
  try {
    await writeFile(path.join(project, 'untracked.txt'), 'uncommitted\n');
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /requires a clean Git worktree/,
    );
    assert.deepEqual(
      await readdir(path.join(project, '.autocode', 'runs')),
      [],
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rejects a branch that does not match the selected task's declaration", async () => {
  const project = await fixtureProject('feat/unrelated');
  try {
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /requires the selected task branch feat\/AC-003; current branch is feat\/unrelated/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects planning on main', async () => {
  const project = await fixtureProject('main');
  try {
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /requires a non-main Git branch/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link planning run directory', async () => {
  const project = await fixtureProject();
  const external = await mkdtemp(
    path.join(os.tmpdir(), 'autocode-external-run-'),
  );
  try {
    const commit = (await git(project, ['rev-parse', 'HEAD'])).trim();
    await symlink(
      external,
      path.join(project, '.autocode', 'runs', `AC-003-${commit.slice(0, 12)}`),
      'junction',
    );
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /planning run directory must be a real directory/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

async function git(project: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: project,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout;
}
