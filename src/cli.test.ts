import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));

function workbook(rows: string): string {
  return `# Workbook\n\n## Canonical MVP 1 sequence\n\n| Order | Task | Workbook outcome | Product criteria | State |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Next\n`;
}

test('CLI selects canonical work, reports a declared blocker, and rejects duplicate IDs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-cli-workbook-'));
  const tasks = path.join(root, 'tasks');
  try {
    await mkdir(tasks);
    await writeFile(
      path.join(tasks, 'AC-001.md'),
      `---\ntask_id: AC-001\ntitle: CLI fixture\nstatus: ready\npriority: high\nrisk: low\ndepends_on: []\nbranch: feat/AC-001\nowner: fixture\nlast_updated: 2026-09-16\nqa: not_applicable\ndeployment: not_applicable\npull_request: not_applicable\n---\n`,
    );
    await writeFile(
      path.join(tasks, 'README.md'),
      workbook(
        '| 1 | [AC-001](AC-001.md) | Select the fixture | M1-01 | `ready` |',
      ),
    );
    await exec('git', ['init', '-b', 'main'], { cwd: root });
    await exec('git', ['config', 'user.email', 'fixture@example.invalid'], {
      cwd: root,
    });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'fixture'], { cwd: root });

    const selected = await exec(
      process.execPath,
      ['--import', 'tsx', cli, 'select', root],
      { cwd: fileURLToPath(new URL('..', import.meta.url)) },
    );
    assert.equal(selected.stdout.trim(), 'AC-001: CLI fixture');

    await unlink(path.join(tasks, 'AC-001.md'));
    await writeFile(
      path.join(tasks, 'README.md'),
      workbook('| 1 | AC-001 | Await policy | M1-01 | `blocked` by policy |'),
    );
    await assert.rejects(
      () =>
        exec(process.execPath, ['--import', 'tsx', cli, 'select', root], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
        }),
      (error: unknown) => {
        const blocked = error as { code?: number; stdout?: string };
        assert.equal(blocked.code, 1);
        assert.equal(
          blocked.stdout?.trim(),
          'No task is selectable; blocked dependencies: AC-001 (by policy)',
        );
        return true;
      },
    );

    await writeFile(
      path.join(tasks, 'README.md'),
      workbook(
        '| 1 | AC-001 | Await policy | M1-01 | `blocked` by policy |\n| 2 | AC-001 | Duplicate | M1-01 | `waiting` on policy |',
      ),
    );
    await assert.rejects(
      () =>
        exec(process.execPath, ['--import', 'tsx', cli, 'select', root], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
        }),
      (error: unknown) => {
        const failure = error as { code?: number; stderr?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? '', /duplicate workbook task/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
