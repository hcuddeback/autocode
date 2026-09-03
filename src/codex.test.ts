import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { runRoleSeparatedCodexSessions } from './codex.js';

const execFileAsync = promisify(execFile);
const IMPLEMENTATION_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';

test('runs scoped implementation and independent read-only review sessions', async () => {
  const fixture = await sessionFixture('success');
  try {
    const result = await runRoleSeparatedCodexSessions(
      fixture.worktree,
      fixture.options,
    );
    assert.equal(result.implementation.sessionId, IMPLEMENTATION_ID);
    assert.equal(result.review.sessionId, REVIEW_ID);
    const implementation = await readFile(
      path.join(result.runDirectory, 'sessions', 'implementation', 'final.txt'),
      'utf8',
    );
    const review = await readFile(
      path.join(result.runDirectory, 'sessions', 'review', 'final.txt'),
      'utf8',
    );
    assert.equal(implementation, 'role=implementation;task=true;plan=true');
    assert.equal(review, 'role=review;task=true;plan=false');
    const implementationRecord = JSON.parse(
      await readFile(
        path.join(
          result.runDirectory,
          'sessions',
          'implementation',
          'session.json',
        ),
        'utf8',
      ),
    ) as { arguments: string[] };
    const reviewRecord = JSON.parse(
      await readFile(
        path.join(result.runDirectory, 'sessions', 'review', 'session.json'),
        'utf8',
      ),
    ) as { arguments: string[] };
    assert.deepEqual(implementationRecord.arguments.slice(-2), [
      '--approve-for-me',
      '-',
    ]);
    assert.ok(reviewRecord.arguments.includes('read-only'));
    assert.ok(reviewRecord.arguments.includes('--uncommitted'));
    assert.ok(!reviewRecord.arguments.includes('--approve-for-me'));
  } finally {
    await fixture.cleanup();
  }
});

for (const [mode, message] of [
  ['malformed', /valid thread identity/],
  ['nonzero', /exited with code 7/],
  ['duplicate', /distinct Codex sessions/],
] as const) {
  test(`fails safely for ${mode} Codex output`, async () => {
    const fixture = await sessionFixture(mode);
    try {
      await assert.rejects(
        () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
        message,
      );
    } finally {
      await fixture.cleanup();
    }
  });
}

test('terminates a timed-out Codex session and preserves failure artifacts', async () => {
  const fixture = await sessionFixture('timeout');
  try {
    await assert.rejects(
      () =>
        runRoleSeparatedCodexSessions(fixture.worktree, {
          ...fixture.options,
          timeoutMs: 100,
        }),
      /timed out/,
    );
    await readFile(
      path.join(
        fixture.runDirectory,
        'sessions',
        'implementation',
        'session.json',
      ),
    );
  } finally {
    await fixture.cleanup();
  }
});

test('terminates a Codex session whose output exceeds the configured bound', async () => {
  const fixture = await sessionFixture('overflow');
  try {
    await assert.rejects(
      () =>
        runRoleSeparatedCodexSessions(fixture.worktree, {
          ...fixture.options,
          maxOutputBytes: 128,
        }),
      /output limit/,
    );
    assert.equal(
      (
        await readFile(
          path.join(
            fixture.runDirectory,
            'sessions',
            'implementation',
            'events.jsonl',
          ),
        )
      ).length,
      128,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects stale preparation and existing session artifacts', async () => {
  const stale = await sessionFixture('success');
  try {
    const metadataPath = path.join(stale.runDirectory, 'planning.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
      taskSha256: string;
    };
    metadata.taskSha256 = '0'.repeat(64);
    await writeFile(metadataPath, JSON.stringify(metadata));
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(stale.worktree, stale.options),
      /does not match/,
    );
  } finally {
    await stale.cleanup();
  }

  const existing = await sessionFixture('success');
  try {
    await mkdir(path.join(existing.runDirectory, 'sessions'));
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(existing.worktree, existing.options),
      /already exist/,
    );
  } finally {
    await existing.cleanup();
  }
});

async function sessionFixture(mode: string) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'autocode-codex-'));
  const repository = path.join(base, 'repository');
  const worktree = path.join(base, 'worktree');
  await mkdir(repository);
  await git(repository, ['init', '-b', 'main']);
  await git(repository, ['config', 'user.email', 'fixture@example.com']);
  await git(repository, ['config', 'user.name', 'Fixture']);
  await writeFile(path.join(repository, 'README.md'), 'fixture\n');
  await writeFile(path.join(repository, '.gitignore'), '.autocode/\n');
  await git(repository, ['add', 'README.md', '.gitignore']);
  await git(repository, ['commit', '-m', 'initial']);
  await git(repository, [
    'worktree',
    'add',
    '-b',
    'feat/AC-004-codex-sessions',
    worktree,
  ]);
  await mkdir(path.join(worktree, 'tasks', 'completed'), { recursive: true });
  await writeFile(
    path.join(worktree, 'tasks', 'completed', 'AC-003.md'),
    completedTask(),
  );
  const task = selectedTask();
  await writeFile(path.join(worktree, 'tasks', 'AC-004.md'), task);
  await git(worktree, ['add', 'tasks']);
  await git(worktree, ['commit', '-m', 'select task']);
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
  const runDirectory = path.join(
    worktree,
    '.autocode',
    'runs',
    `AC-004-${head.slice(0, 12)}`,
  );
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, 'task.md'), task);
  await writeFile(
    path.join(runDirectory, 'plan.md'),
    '# Plan\n\nImplement only AC-004.\n',
  );
  await writeFile(
    path.join(runDirectory, 'planning.json'),
    `${JSON.stringify({ version: 1, taskId: 'AC-004', taskPath: 'tasks/AC-004.md', taskSha256: createHash('sha256').update(task).digest('hex'), headCommit: head, branch: 'feat/AC-004-codex-sessions' }, null, 2)}\n`,
  );
  const fake = path.join(base, 'fake-codex.mjs');
  await writeFile(fake, fakeCodex());
  return {
    worktree,
    runDirectory,
    options: {
      command: process.execPath,
      commandPrefixArguments: [fake, mode],
      timeoutMs: 2_000,
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
}

function completedTask(): string {
  return `---\ntask_id: AC-003\ntitle: Completed dependency\nstatus: done\npriority: high\nrisk: low\ndepends_on: []\nbranch: feat/ac-003\nowner: none\nlast_updated: 2026-09-02\nqa: not_applicable\ndeployment: not_applicable\npull_request: required\n---\n\n# Outcome\n\nDone.\n`;
}

function selectedTask(): string {
  return `---\ntask_id: AC-004\ntitle: Run sessions\nstatus: ready\npriority: high\nrisk: high\ndepends_on: [AC-003]\nbranch: feat/AC-004-codex-sessions\nowner: none\nlast_updated: 2026-09-02\nqa: not_applicable\ndeployment: not_applicable\npull_request: required\n---\n\n# Outcome\n\nRun role-separated sessions.\n`;
}

function fakeCodex(): string {
  return `const mode = process.argv[2];
let input = '';
for await (const chunk of process.stdin) input += chunk;
const review = process.argv.includes('review');
if (mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 10_000));
if (mode === 'overflow') { process.stdout.write('x'.repeat(4096)); await new Promise(resolve => setTimeout(resolve, 10_000)); }
if (mode === 'malformed') { console.log('{bad json'); process.exit(0); }
const id = review && mode !== 'duplicate' ? '${REVIEW_ID}' : '${IMPLEMENTATION_ID}';
console.log(JSON.stringify({ type: 'thread.started', thread_id: id }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'role=' + (review ? 'review' : 'implementation') + ';task=' + input.includes('<task>') + ';plan=' + input.includes('<plan>') } }));
if (mode === 'nonzero') process.exit(7);
`;
}
