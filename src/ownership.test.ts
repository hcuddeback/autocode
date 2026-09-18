import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  acquireTaskOwnership,
  assertTaskOwnership,
  releaseTaskOwnership,
  type TaskOwnershipRequest,
} from './ownership.js';

const exec = promisify(execFile);

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-ownership-'));
  await exec('git', ['init'], { cwd: root });
  await writeFile(path.join(root, '.gitignore'), '.autocode/\n');
  await mkdir(path.join(root, '.autocode'));
  return root;
}

function request(
  overrides: Partial<TaskOwnershipRequest> = {},
): TaskOwnershipRequest {
  return {
    runId: 'workflow-ac-016-0123456789ab',
    taskId: 'AC-016',
    workbookSha256: '1'.repeat(64),
    taskSha256: '2'.repeat(64),
    headCommit: '3'.repeat(40),
    branch: 'feat/AC-016-workbook-ownership',
    ...overrides,
  };
}

test('creates durable ownership once and resumes the same bound run', async () => {
  const root = await fixture();
  try {
    const created = await acquireTaskOwnership(root, request());
    const resumed = await acquireTaskOwnership(root, request());
    assert.equal(created.kind, 'created');
    assert.equal(resumed.kind, 'resumed');
    assert.deepEqual(resumed.record, created.record);
    await assertTaskOwnership(root, created.record);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts SHA-256 Git object identifiers', async () => {
  const root = await fixture();
  try {
    const created = await acquireTaskOwnership(
      root,
      request({ headCommit: 'a'.repeat(64) }),
    );
    assert.equal(created.record.headCommit.length, 64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds ownership to the linked worktree Git directory', async () => {
  const repository = await mkdtemp(
    path.join(os.tmpdir(), 'autocode-ownership-repository-'),
  );
  const worktree = `${repository}-worktree`;
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: repository });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: repository,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: repository });
    await writeFile(path.join(repository, '.gitignore'), '.autocode/\n');
    await exec('git', ['add', '.gitignore'], { cwd: repository });
    await exec('git', ['commit', '-m', 'fixture'], { cwd: repository });
    await exec('git', ['worktree', 'add', '-b', 'feat/ownership', worktree], {
      cwd: repository,
    });
    await mkdir(path.join(worktree, '.autocode'));

    const created = await acquireTaskOwnership(worktree, request());
    const { stdout } = await exec('git', ['rev-parse', '--git-dir'], {
      cwd: worktree,
    });
    assert.equal(
      created.record.gitDirectory,
      await import('node:fs/promises').then(({ realpath }) =>
        realpath(path.resolve(worktree, stdout.trim())),
      ),
    );
  } finally {
    await rm(worktree, { recursive: true, force: true });
    await rm(repository, { recursive: true, force: true });
  }
});

test('concurrent acquisition publishes one complete ownership record', async () => {
  const root = await fixture();
  try {
    const results = await Promise.all([
      acquireTaskOwnership(root, request()),
      acquireTaskOwnership(root, request()),
    ]);
    assert.deepEqual(results.map((result) => result.kind).sort(), [
      'created',
      'resumed',
    ]);
    assert.deepEqual(results[0]?.record, results[1]?.record);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a different run or changed input cannot steal task ownership', async () => {
  const root = await fixture();
  try {
    await acquireTaskOwnership(root, request());
    await assert.rejects(
      () =>
        acquireTaskOwnership(
          root,
          request({ runId: 'workflow-ac-016-fedcba987654' }),
        ),
      /owned by another workbook run/,
    );
    await assert.rejects(
      () =>
        acquireTaskOwnership(root, request({ workbookSha256: '4'.repeat(64) })),
      /owned by another workbook run/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a newly created stale intake can release only its own ownership', async () => {
  const root = await fixture();
  try {
    const created = await acquireTaskOwnership(root, request());
    await releaseTaskOwnership(root, created.record);
    const replacement = await acquireTaskOwnership(
      root,
      request({ headCommit: '4'.repeat(40) }),
    );
    assert.equal(replacement.kind, 'created');
    await assert.rejects(
      () => releaseTaskOwnership(root, created.record),
      /changed before release/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('corrupt or forged ownership blocks resume', async () => {
  const root = await fixture();
  try {
    const created = await acquireTaskOwnership(root, request());
    const parsed = JSON.parse(
      await readFile(created.filePath, 'utf8'),
    ) as Record<string, unknown>;
    parsed.branch = 'feat/forged';
    await writeFile(created.filePath, `${JSON.stringify(parsed)}\n`);
    await assert.rejects(
      () => acquireTaskOwnership(root, request()),
      /binding is invalid/,
    );
    await assert.rejects(
      () => assertTaskOwnership(root, created.record),
      /binding is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a linked ownership record cannot be used for resume', async (context) => {
  const root = await fixture();
  try {
    const created = await acquireTaskOwnership(root, request());
    const moved = `${created.filePath}.moved`;
    await rename(created.filePath, moved);
    try {
      await symlink(moved, created.filePath, 'file');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      context.skip('file symlinks require an unavailable Windows privilege');
      return;
    }
    await assert.rejects(
      () => assertTaskOwnership(root, created.record),
      /bounded regular file/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses ownership state without Git ignore coverage', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, '.gitignore'), 'dist/\n');
    await assert.rejects(
      () => acquireTaskOwnership(root, request()),
      /ownership must be gitignored/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
