import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
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

async function fixtureProject(
  branch = 'feat/AC-003',
  linkedWorktree = true,
): Promise<string> {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'autocode-planning-'));
  const repository = path.join(fixture, 'repository');
  const project = linkedWorktree ? path.join(fixture, 'worktree') : repository;
  await mkdir(path.join(repository, 'tasks', 'completed'), { recursive: true });
  await writeTask(repository, 'AC-001', 'done', [], true);
  await writeTask(repository, 'AC-002', 'done', ['AC-001'], true);
  await writeTask(repository, 'AC-003', 'ready', ['AC-002']);
  await writeTask(
    repository,
    'AC-004',
    'later',
    ['AC-003'],
    false,
    'LATER_SECRET_SCOPE',
  );
  await git(repository, ['init', '-b', linkedWorktree ? 'main' : branch]);
  await git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repository, ['config', 'user.name', 'Fixture']);
  await initializeProject(repository);
  await git(repository, ['add', '--', '.']);
  await git(repository, ['commit', '-m', 'fixture']);
  if (linkedWorktree) {
    await git(repository, ['worktree', 'add', '-b', branch, project]);
    await initializeProject(project);
  }
  return project;
}

async function removeFixture(project: string): Promise<void> {
  await rm(path.dirname(project), { recursive: true, force: true });
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
    await removeFixture(project);
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
    await removeFixture(project);
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
    await removeFixture(project);
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
    await removeFixture(project);
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
      await removeFixture(project);
    }
  }
});

test('accepts populated completion-record fields', async () => {
  const project = await fixtureProject();
  try {
    const taskPath = path.join(project, 'tasks', 'AC-003.md');
    await writeFile(
      taskPath,
      `${await readFile(taskPath, 'utf8')}\n## Completion record\n\n- Branch/PR: feat/AC-003; PR #3\n- Final commit: pending final verification\n- Validation evidence: fixture checks\n- Review disposition: no open findings\n- QA evidence or not-applicable reason: not applicable\n- Production evidence or not-applicable reason: not applicable\n- Remaining limitation: later workflow phases\n`,
    );
    await git(project, ['add', '--', 'tasks/AC-003.md']);
    await git(project, ['commit', '-m', 'populate completion record']);
    assert.equal((await prepareImplementationPlan(project)).kind, 'created');
  } finally {
    await removeFixture(project);
  }
});

test('rejects an empty completion-record field', async () => {
  const project = await fixtureProject();
  try {
    const taskPath = path.join(project, 'tasks', 'AC-003.md');
    await writeFile(
      taskPath,
      `${await readFile(taskPath, 'utf8')}\n## Completion record\n\n- Branch/PR:\n`,
    );
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /template placeholder/,
    );
  } finally {
    await removeFixture(project);
  }
});

test('rejects empty required sections and Scope subsections', async () => {
  for (const [content, replacement] of [
    ['Required for the fixture milestone.', ''],
    ['Required for the fixture milestone.', '<!-- TODO -->'],
    ['Required for the fixture milestone.', '- [ ]'],
    ['Required for the fixture milestone.', '1)'],
    ['- This task only.', ''],
  ]) {
    const project = await fixtureProject();
    try {
      const taskPath = path.join(project, 'tasks', 'AC-003.md');
      await writeFile(
        taskPath,
        (await readFile(taskPath, 'utf8')).replace(content!, replacement!),
      );
      await assert.rejects(
        () => prepareImplementationPlan(project),
        /empty required section|empty Scope In subsection/,
      );
    } finally {
      await removeFixture(project);
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
    await removeFixture(project);
  }
});

test("rejects a branch that does not match the selected task's declaration", async () => {
  const project = await fixtureProject('feat/unrelated');
  try {
    await assert.rejects(
      () => prepareImplementationPlan(project),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          'current Git branch does not match the selected task branch',
    );
  } finally {
    await removeFixture(project);
  }
});

test('detects replacement of the runs directory before artifact creation', async () => {
  const project = await fixtureProject();
  const external = await mkdtemp(path.join(os.tmpdir(), 'autocode-runs-race-'));
  try {
    const runs = path.join(project, '.autocode', 'runs');
    await assert.rejects(
      () =>
        prepareImplementationPlan(project, {
          onCheckpoint: async (checkpoint) => {
            if (checkpoint !== 'after-runs-identity') return;
            await rename(runs, `${runs}-original`);
            await symlink(external, runs, 'junction');
          },
        }),
      /runs directory must be a real directory|runs directory changed/,
    );
    assert.deepEqual(await readdir(external), []);
  } finally {
    await removeFixture(project);
    await rm(external, { recursive: true, force: true });
  }
});

test('detects replacement of an existing planning run during validation', async () => {
  const project = await fixtureProject();
  try {
    const first = await prepareImplementationPlan(project);
    const replacement = `${first.runDirectory}-replacement`;
    await assert.rejects(
      () =>
        prepareImplementationPlan(project, {
          onCheckpoint: async (checkpoint) => {
            if (checkpoint !== 'after-existing-run-identity') return;
            await rename(first.runDirectory, replacement);
            await cp(replacement, first.runDirectory, { recursive: true });
          },
        }),
      /planning run directory changed/,
    );
  } finally {
    await removeFixture(project);
  }
});

test('removes its temporary directory after a preparation failure', async () => {
  const project = await fixtureProject();
  try {
    await assert.rejects(
      () =>
        prepareImplementationPlan(project, {
          onCheckpoint: async (checkpoint) => {
            if (checkpoint === 'after-temporary-identity') {
              throw new Error('injected failure');
            }
          },
        }),
      /injected failure/,
    );
    assert.deepEqual(
      await readdir(path.join(project, '.autocode', 'runs')),
      [],
    );
  } finally {
    await removeFixture(project);
  }
});

test('fails safely when Git identity changes after publication', async () => {
  const project = await fixtureProject();
  try {
    await assert.rejects(
      () =>
        prepareImplementationPlan(project, {
          onCheckpoint: async (checkpoint) => {
            if (checkpoint !== 'after-publication') return;
            await writeFile(path.join(project, 'concurrent.txt'), 'change\n');
            await git(project, ['add', '--', 'concurrent.txt']);
            await git(project, ['commit', '-m', 'concurrent change']);
          },
        }),
      /task or Git identity changed/,
    );
    assert.deepEqual(
      await readdir(path.join(project, '.autocode', 'runs')),
      [],
    );
  } finally {
    await removeFixture(project);
  }
});

test('rejects a primary checkout even on the declared feature branch', async () => {
  const project = await fixtureProject('feat/AC-003', false);
  try {
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /requires an isolated linked Git worktree/,
    );
  } finally {
    await removeFixture(project);
  }
});

test('rejects invalid and control-bearing declared branches', async () => {
  for (const branch of ['feat/bad..branch', '"feat/AC-003\\u001b[31m"']) {
    const project = await fixtureProject();
    try {
      const taskPath = path.join(project, 'tasks', 'AC-003.md');
      await writeFile(
        taskPath,
        (await readFile(taskPath, 'utf8')).replace(
          'branch: feat/AC-003',
          `branch: ${branch}`,
        ),
      );
      await assert.rejects(
        () => prepareImplementationPlan(project),
        /invalid Git branch|must not contain control characters/,
      );
    } finally {
      await removeFixture(project);
    }
  }
});

test('rejects planning on main', async () => {
  const project = await fixtureProject('main', false);
  try {
    await assert.rejects(
      () => prepareImplementationPlan(project),
      /requires a non-main Git branch/,
    );
  } finally {
    await removeFixture(project);
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
    await removeFixture(project);
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
