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
  const previousPrivateKey = process.env.AUTOCODE_TEST_PRIVATE_KEY;
  const previousDatabaseUrl = process.env.AUTOCODE_TEST_DATABASE_URL;
  process.env.AUTOCODE_TEST_PRIVATE_KEY = 'line one\n"line two"';
  process.env.AUTOCODE_TEST_DATABASE_URL =
    'postgresql://fixture-user:fixture-password@example.invalid/database';
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
    const events = await readFile(
      path.join(
        result.runDirectory,
        'sessions',
        'implementation',
        'events.jsonl',
      ),
      'utf8',
    );
    assert.ok(!events.includes('sk_fixture_secret_123456789'));
    assert.ok(!events.includes('line one'));
    assert.ok(!events.includes('fixture-password'));
    assert.ok(!events.includes('AKIAABCDEFGHIJKLMNOP'));
    assert.ok(!events.includes('not-in-env-secret'));
    assert.ok(!events.includes('json-file-secret'));
    assert.ok(events.includes('<redacted>'));
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
    assert.deepEqual(implementationRecord.arguments.slice(-1), ['-']);
    assert.ok(reviewRecord.arguments.includes('read-only'));
    assert.deepEqual(reviewRecord.arguments.slice(-1), ['-']);
    assert.ok(!reviewRecord.arguments.includes('--approve-for-me'));
  } finally {
    if (previousPrivateKey === undefined)
      delete process.env.AUTOCODE_TEST_PRIVATE_KEY;
    else process.env.AUTOCODE_TEST_PRIVATE_KEY = previousPrivateKey;
    if (previousDatabaseUrl === undefined)
      delete process.env.AUTOCODE_TEST_DATABASE_URL;
    else process.env.AUTOCODE_TEST_DATABASE_URL = previousDatabaseUrl;
    await fixture.cleanup();
  }
});

test('refuses review when implementation changes the prepared Git identity', async () => {
  const fixture = await sessionFixture('commit');
  try {
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
      /changed the prepared Git identity/,
    );
    await assert.rejects(
      readFile(
        path.join(fixture.runDirectory, 'sessions', 'review', 'session.json'),
      ),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('refuses review when implementation changes a prepared artifact', async () => {
  const fixture = await sessionFixture('mutate-preparation');
  try {
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
      /changed protected AutoCode state/,
    );
    await assert.rejects(
      readFile(
        path.join(fixture.runDirectory, 'sessions', 'review', 'session.json'),
      ),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('refuses review when implementation adds unexpected run-directory state', async () => {
  const fixture = await sessionFixture('mutate-other-state');
  try {
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
      /changed protected AutoCode state/,
    );
    await assert.rejects(
      readFile(
        path.join(fixture.runDirectory, 'sessions', 'review', 'session.json'),
      ),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('refuses review when implementation changes ignored credential state', async () => {
  const fixture = await sessionFixture('mutate-credential-state');
  try {
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
      /changed protected credential state/,
    );
    await assert.rejects(
      readFile(
        path.join(fixture.runDirectory, 'sessions', 'review', 'session.json'),
      ),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

for (const [mode, message] of [
  ['malformed', /valid thread identity/],
  ['missing-final', /did not contain a final message/],
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

test('terminates the process tree even when the direct child exits first', async () => {
  const fixture = await sessionFixture('timeout-tree');
  try {
    await assert.rejects(
      () =>
        runRoleSeparatedCodexSessions(fixture.worktree, {
          ...fixture.options,
          timeoutMs: 100,
        }),
      /timed out/,
    );
    await assert.rejects(
      readFile(path.join(fixture.worktree, 'escaped.txt')),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('terminates leftover helpers after a successful session', async () => {
  const fixture = await sessionFixture('success-tree');
  try {
    await runRoleSeparatedCodexSessions(fixture.worktree, fixture.options);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await assert.rejects(
      readFile(path.join(fixture.worktree, 'escaped.txt')),
      /ENOENT/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test(
  'terminates helpers that leave the original process group on timeout',
  {
    skip: process.platform === 'win32',
  },
  async () => {
    const fixture = await sessionFixture('timeout-detached-tree');
    try {
      await assert.rejects(
        () =>
          runRoleSeparatedCodexSessions(fixture.worktree, {
            ...fixture.options,
            timeoutMs: 100,
          }),
        /timed out/,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await assert.rejects(
        readFile(path.join(fixture.worktree, 'escaped.txt')),
        /ENOENT/,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'terminates helpers that leave the original process group after success',
  {
    skip: process.platform === 'win32',
  },
  async () => {
    const fixture = await sessionFixture('success-detached-tree');
    try {
      await runRoleSeparatedCodexSessions(fixture.worktree, fixture.options);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await assert.rejects(
        readFile(path.join(fixture.worktree, 'escaped.txt')),
        /ENOENT/,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

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
      await readFile(
        path.join(
          fixture.runDirectory,
          'sessions',
          'implementation',
          'events.jsonl',
        ),
        'utf8',
      ),
      '[output omitted: exceeded configured limit]\n',
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

test('reserves the run before launching Codex, rejecting a concurrent duplicate run', async () => {
  const fixture = await sessionFixture('success-slow');
  try {
    const first = runRoleSeparatedCodexSessions(
      fixture.worktree,
      fixture.options,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(
      () => runRoleSeparatedCodexSessions(fixture.worktree, fixture.options),
      /already exist/,
    );
    await first;
  } finally {
    await fixture.cleanup();
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
  await writeFile(
    path.join(repository, '.gitignore'),
    '.autocode/\n.env\n.credentials.json\n',
  );
  await git(repository, ['add', 'README.md', '.gitignore']);
  await git(repository, ['commit', '-m', 'initial']);
  await git(repository, [
    'worktree',
    'add',
    '-b',
    'feat/AC-004-codex-sessions',
    worktree,
  ]);
  await writeFile(
    path.join(worktree, '.env'),
    'DB_PASSWORD=not-in-env-secret\n',
  );
  await writeFile(
    path.join(worktree, '.credentials.json'),
    '{"client_secret":"json-file-secret"}\n',
  );
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
import { writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const review = input.includes('independent critical-review role');
if (mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 10_000));
if (mode === 'success-slow' && !review) await new Promise(resolve => setTimeout(resolve, 400));
if (mode === 'timeout-tree') { spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setTimeout(()=>require('node:fs').writeFileSync('escaped.txt','escaped'),1500); setTimeout(()=>{},10000)"], { stdio: 'ignore' }); await new Promise(resolve => setTimeout(resolve, 10_000)); }
if (mode === 'timeout-detached-tree') { spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setTimeout(()=>require('node:fs').writeFileSync('escaped.txt','escaped'),1500); setTimeout(()=>{},10000)"], { stdio: 'ignore', detached: true }).unref(); await new Promise(resolve => setTimeout(resolve, 10_000)); }
if (!review && mode === 'success-tree') spawn(process.execPath, ['-e', "setTimeout(()=>require('node:fs').writeFileSync('escaped.txt','escaped'),1500); setTimeout(()=>{},10000)"], { stdio: 'ignore' }).unref();
if (!review && mode === 'success-detached-tree') spawn(process.execPath, ['-e', "setTimeout(()=>require('node:fs').writeFileSync('escaped.txt','escaped'),1500); setTimeout(()=>{},10000)"], { stdio: 'ignore', detached: true }).unref();
if (mode === 'overflow') { process.stdout.write('x'.repeat(4096)); await new Promise(resolve => setTimeout(resolve, 10_000)); }
if (!review) await writeFile('implementation.txt', 'changed');
if (!review && mode === 'mutate-preparation') { const { readdir } = await import('node:fs/promises'); const [run] = await readdir('.autocode/runs'); await writeFile('.autocode/runs/' + run + '/plan.md', 'tampered'); }
if (!review && mode === 'mutate-other-state') await writeFile('.autocode/config.yaml', 'changed: true');
if (!review && mode === 'mutate-credential-state') await writeFile('.env', 'DB_PASSWORD=destroyed\\n');
if (!review && mode === 'commit') { spawnSync('git', ['add', 'implementation.txt']); spawnSync('git', ['commit', '-m', 'unexpected']); }
if (mode === 'malformed') { console.log('{bad json'); process.exit(0); }
const id = review && mode !== 'duplicate' ? '${REVIEW_ID}' : '${IMPLEMENTATION_ID}';
console.log(JSON.stringify({ type: 'thread.started', thread_id: id }));
console.log(JSON.stringify({ type: 'diagnostic', text: 'sk_fixture_secret_123456789' }));
console.log(JSON.stringify({ type: 'diagnostic', text: process.env.AUTOCODE_TEST_PRIVATE_KEY }));
console.log(JSON.stringify({ type: 'diagnostic', text: process.env.AUTOCODE_TEST_DATABASE_URL }));
console.log(JSON.stringify({ type: 'diagnostic', text: 'AKIAABCDEFGHIJKLMNOP' }));
console.log(JSON.stringify({ type: 'diagnostic', text: 'not-in-env-secret' }));
console.log(JSON.stringify({ type: 'diagnostic', text: 'json-file-secret' }));
if (mode === 'missing-final') process.exit(0);
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'role=' + (review ? 'review' : 'implementation') + ';task=' + input.includes('<task>') + ';plan=' + input.includes('<plan>') } }));
if (mode === 'nonzero') process.exit(7);
`;
}
