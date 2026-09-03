import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import { initializeProject, validateConfig } from './config.js';
import { runDeterministicVerification } from './verification.js';

const execFileAsync = promisify(execFile);

interface Fixture {
  parent: string;
  worktree: string;
  runDirectory: string;
  taskContents: string;
}

async function createFixture(
  commands: Array<{ name: string; command: string; args: string[] }>,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<Fixture> {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'autocode-verification-'),
  );
  const worktree = `${parent}-worktree`;
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: parent });
  await execFileAsync('git', ['config', 'user.email', 'fixture@example.test'], {
    cwd: parent,
  });
  await execFileAsync('git', ['config', 'user.name', 'Fixture'], {
    cwd: parent,
  });
  await mkdir(path.join(parent, 'tasks', 'completed'), { recursive: true });
  const sourceTaskContents = `---\ntask_id: AC-005\ntitle: Verify\nstatus: in_progress\npriority: high\nrisk: high\ndepends_on: [AC-004]\nbranch: feat/AC-005-test\nowner: unassigned\nlast_updated: 2026-09-03\nqa: not_applicable\ndeployment: not_applicable\npull_request: required\n---\n\n# Outcome\n\nVerify.\n`;
  await writeFile(path.join(parent, 'tasks', 'AC-005.md'), sourceTaskContents);
  await writeFile(
    path.join(parent, 'tasks', 'completed', 'AC-004.md'),
    `---\ntask_id: AC-004\ntitle: Sessions\nstatus: done\npriority: high\nrisk: high\ndepends_on: []\nbranch: feat/AC-004\nowner: unassigned\nlast_updated: 2026-09-03\nqa: not_applicable\ndeployment: not_applicable\npull_request: required\n---\n`,
  );
  await writeFile(path.join(parent, '.gitignore'), '.autocode/\n.env\n');
  await execFileAsync('git', ['add', '.'], { cwd: parent });
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: parent });
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', 'feat/AC-005-test', worktree],
    { cwd: parent },
  );
  await initializeProject(worktree);
  const taskContents = await readFile(
    path.join(worktree, 'tasks', 'AC-005.md'),
    'utf8',
  );
  await writeFile(
    path.join(worktree, '.autocode', 'config.yaml'),
    stringify({
      version: 1,
      stateDirectory: '.autocode',
      telemetry: false,
      verification: {
        commands,
        timeoutMs: options.timeoutMs ?? 5_000,
        maxOutputBytes: options.maxOutputBytes ?? 64 * 1024,
      },
    }),
  );
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: worktree,
  });
  const headCommit = stdout.trim();
  const runDirectory = path.join(
    worktree,
    '.autocode',
    'runs',
    `AC-005-${headCommit.slice(0, 12)}`,
  );
  await mkdir(runDirectory);
  await writeFile(path.join(runDirectory, 'task.md'), taskContents);
  await writeFile(path.join(runDirectory, 'plan.md'), '# Plan\n');
  await writeFile(
    path.join(runDirectory, 'planning.json'),
    `${JSON.stringify({
      version: 1,
      taskId: 'AC-005',
      taskPath: 'tasks/AC-005.md',
      taskSha256: createHash('sha256').update(taskContents).digest('hex'),
      headCommit,
      branch: 'feat/AC-005-test',
    })}\n`,
  );
  return { parent, worktree, runDirectory, taskContents };
}

async function cleanup(fixture: Fixture): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['worktree', 'remove', '--force', fixture.worktree],
      { cwd: fixture.parent },
    );
  } catch {
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!path.resolve(fixture.worktree).startsWith(expectedPrefix)) {
      throw new Error('fixture cleanup target escaped the temporary directory');
    }
  }
  let removalError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await rm(fixture.worktree, { recursive: true, force: true });
      removalError = undefined;
      break;
    } catch (error: unknown) {
      removalError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (removalError !== undefined) throw removalError;
  await rm(fixture.parent, { recursive: true, force: true });
}

test('verification runs commands sequentially and retains bounded commit evidence', async () => {
  const fixture = await createFixture([
    { name: 'first', command: 'node', args: ['-e', "console.log('one')"] },
    { name: 'second', command: 'node', args: ['-e', "console.error('two')"] },
  ]);
  try {
    const result = await runDeterministicVerification(fixture.worktree);
    assert.equal(result.passed, true);
    assert.deepEqual(
      result.checks.map((check) => check.name),
      ['first', 'second'],
    );
    assert.equal(
      await readFile(
        path.join(fixture.runDirectory, 'evidence', 'first', 'stdout.txt'),
        'utf8',
      ),
      'one\n',
    );
    assert.equal(
      await readFile(
        path.join(fixture.runDirectory, 'evidence', 'second', 'stderr.txt'),
        'utf8',
      ),
      'two\n',
    );
    const record = JSON.parse(
      await readFile(
        path.join(fixture.runDirectory, 'evidence', 'first', 'check.json'),
        'utf8',
      ),
    ) as { durationMs: number; headCommit: string; passed: boolean };
    assert.equal(record.passed, true);
    assert.equal(record.durationMs >= 0, true);
    assert.match(record.headCommit, /^[0-9a-f]{40}$/);
  } finally {
    await cleanup(fixture);
  }
});

test('verification stops after a failed command and retains partial evidence', async () => {
  const fixture = await createFixture([
    { name: 'failure', command: 'node', args: ['-e', 'process.exit(7)'] },
    { name: 'not_run', command: 'node', args: ['-e', "console.log('bad')"] },
  ]);
  try {
    await assert.rejects(
      () => runDeterministicVerification(fixture.worktree),
      /verification failed/,
    );
    const summary = JSON.parse(
      await readFile(
        path.join(fixture.runDirectory, 'evidence', 'summary.json'),
        'utf8',
      ),
    ) as { checks: Array<{ exitCode: number }> };
    assert.deepEqual(
      summary.checks.map((check) => check.exitCode),
      [7],
    );
    await assert.rejects(
      () =>
        readFile(
          path.join(fixture.runDirectory, 'evidence', 'not_run', 'check.json'),
        ),
      /ENOENT/,
    );
  } finally {
    await cleanup(fixture);
  }
});

test('verification records timeout and output overflow failures', async () => {
  for (const scenario of [
    {
      name: 'timeout',
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 25,
      maxOutputBytes: 1024,
    },
    {
      name: 'overflow',
      args: ['-e', "process.stdout.write('x'.repeat(4096))"],
      timeoutMs: 5000,
      maxOutputBytes: 32,
    },
  ]) {
    const fixture = await createFixture(
      [{ name: scenario.name, command: 'node', args: scenario.args }],
      scenario,
    );
    try {
      await assert.rejects(
        () => runDeterministicVerification(fixture.worktree),
        /verification failed/,
      );
      const record = JSON.parse(
        await readFile(
          path.join(
            fixture.runDirectory,
            'evidence',
            scenario.name,
            'check.json',
          ),
          'utf8',
        ),
      ) as { timedOut: boolean; overflowed: boolean };
      assert.equal(
        record[scenario.name === 'timeout' ? 'timedOut' : 'overflowed'],
        true,
      );
    } finally {
      await cleanup(fixture);
    }
  }
});

test('verification refuses stale preparation and existing evidence', async () => {
  const stale = await createFixture([
    { name: 'ok', command: 'node', args: ['-e', ''] },
  ]);
  try {
    await writeFile(path.join(stale.runDirectory, 'task.md'), 'changed');
    await assert.rejects(
      () => runDeterministicVerification(stale.worktree),
      /preparation is stale/,
    );
  } finally {
    await cleanup(stale);
  }
  const collision = await createFixture([
    { name: 'ok', command: 'node', args: ['-e', ''] },
  ]);
  try {
    await mkdir(path.join(collision.runDirectory, 'evidence'));
    await assert.rejects(
      () => runDeterministicVerification(collision.worktree),
      /already exists/,
    );
  } finally {
    await cleanup(collision);
  }
});

test('verification redacts workspace secrets and detects worktree drift', async () => {
  const secret = 'fixture-secret-value-123456789';
  const redaction = await createFixture([
    {
      name: 'secret',
      command: 'node',
      args: ['-e', `console.log('${secret}')`],
    },
  ]);
  try {
    await writeFile(path.join(redaction.worktree, '.env'), `TOKEN=${secret}\n`);
    await runDeterministicVerification(redaction.worktree);
    const output = await readFile(
      path.join(redaction.runDirectory, 'evidence', 'secret', 'stdout.txt'),
      'utf8',
    );
    assert.doesNotMatch(output, new RegExp(secret));
    assert.match(output, /<redacted>/);
  } finally {
    await cleanup(redaction);
  }

  const drift = await createFixture([
    {
      name: 'drift',
      command: 'node',
      args: ['-e', "require('fs').writeFileSync('tasks/AC-005.md', 'changed')"],
    },
  ]);
  try {
    await assert.rejects(
      () => runDeterministicVerification(drift.worktree),
      /verification failed/,
    );
    const record = JSON.parse(
      await readFile(
        path.join(drift.runDirectory, 'evidence', 'drift', 'check.json'),
        'utf8',
      ),
    ) as { worktreeUnchanged: boolean; passed: boolean };
    assert.equal(record.worktreeUnchanged, false);
    assert.equal(record.passed, false);
  } finally {
    await cleanup(drift);
  }
});

test('verification detects content changes whose porcelain status is unchanged', async () => {
  const fixture = await createFixture([
    {
      name: 'rewrite',
      command: 'node',
      args: [
        '-e',
        "require('fs').writeFileSync('implementation.txt', 'after')",
      ],
    },
  ]);
  try {
    await writeFile(
      path.join(fixture.worktree, 'implementation.txt'),
      'before',
    );
    await assert.rejects(
      () => runDeterministicVerification(fixture.worktree),
      /verification failed/,
    );
    const record = JSON.parse(
      await readFile(
        path.join(fixture.runDirectory, 'evidence', 'rewrite', 'check.json'),
        'utf8',
      ),
    ) as { worktreeUnchanged: boolean };
    assert.equal(record.worktreeUnchanged, false);
  } finally {
    await cleanup(fixture);
  }
});

test('verification detects a branch change that preserves HEAD', async () => {
  const fixture = await createFixture([
    { name: 'branch_drift', command: 'git', args: ['switch', 'other'] },
  ]);
  try {
    await execFileAsync('git', ['branch', 'other'], { cwd: fixture.worktree });
    await assert.rejects(
      () => runDeterministicVerification(fixture.worktree),
      /verification failed/,
    );
    const record = JSON.parse(
      await readFile(
        path.join(
          fixture.runDirectory,
          'evidence',
          'branch_drift',
          'check.json',
        ),
        'utf8',
      ),
    ) as { gitIdentityUnchanged: boolean };
    assert.equal(record.gitIdentityUnchanged, false);
  } finally {
    await cleanup(fixture);
  }
});

test('verification does not resolve executables from the worktree', async () => {
  const command = 'autocode-shadow-check';
  const fixture = await createFixture([{ name: 'shadow', command, args: [] }]);
  const originalPath = process.env.PATH;
  try {
    const executable = path.join(
      fixture.worktree,
      process.platform === 'win32' ? `${command}.cmd` : command,
    );
    await writeFile(
      executable,
      process.platform === 'win32'
        ? '@echo shadowed>shadow-marker.txt\r\n'
        : '#!/bin/sh\necho shadowed > shadow-marker.txt\n',
    );
    if (process.platform !== 'win32') await chmod(executable, 0o755);
    process.env.PATH = `${fixture.worktree}${path.delimiter}${originalPath ?? ''}`;
    await assert.rejects(
      () => runDeterministicVerification(fixture.worktree),
      /verification failed/,
    );
    await assert.rejects(
      () => readFile(path.join(fixture.worktree, 'shadow-marker.txt')),
      /ENOENT/,
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await cleanup(fixture);
  }
});

test('verification retains spawn errors and detects protected-input drift', async () => {
  const missing = await createFixture([
    {
      name: 'missing',
      command: 'autocode-command-that-does-not-exist',
      args: [],
    },
  ]);
  try {
    await assert.rejects(
      () => runDeterministicVerification(missing.worktree),
      /verification failed/,
    );
    const record = JSON.parse(
      await readFile(
        path.join(missing.runDirectory, 'evidence', 'missing', 'check.json'),
        'utf8',
      ),
    ) as { exitCode: number; passed: boolean };
    assert.equal(record.exitCode, -1);
    assert.equal(record.passed, false);
  } finally {
    await cleanup(missing);
  }

  const protectedDrift = await createFixture([
    {
      name: 'protected_drift',
      command: 'node',
      args: [
        '-e',
        "require('fs').appendFileSync('.autocode/config.yaml', '# changed')",
      ],
    },
  ]);
  try {
    await assert.rejects(
      () => runDeterministicVerification(protectedDrift.worktree),
      /verification failed/,
    );
    const record = JSON.parse(
      await readFile(
        path.join(
          protectedDrift.runDirectory,
          'evidence',
          'protected_drift',
          'check.json',
        ),
        'utf8',
      ),
    ) as { protectedStateUnchanged: boolean };
    assert.equal(record.protectedStateUnchanged, false);
  } finally {
    await cleanup(protectedDrift);
  }
});

test('verification configuration rejects shell-like and malformed commands', () => {
  const base = { version: 1, stateDirectory: '.autocode', telemetry: false };
  assert.throws(
    () =>
      validateConfig({
        ...base,
        verification: {
          commands: [{ name: 'bad', command: './script', args: [] }],
          timeoutMs: 1,
          maxOutputBytes: 1,
        },
      }),
    /command is invalid/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...base,
        verification: { commands: [], timeoutMs: 0, maxOutputBytes: 1 },
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...base,
        verification: {
          commands: [
            { name: 'same', command: 'node', args: [] },
            { name: 'same', command: 'node', args: [] },
          ],
          timeoutMs: 1,
          maxOutputBytes: 1,
        },
      }),
    /names must be unique/,
  );
});
