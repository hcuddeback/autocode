import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { snapshotWorktree } from './verification.js';

test('Git snapshots disable external text conversion, filters and fsmonitor hooks and hash raw changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-git-boundary-'));
  const exec = promisify(execFile);
  const git = (args: string[]) =>
    exec('git', args, { cwd: root, windowsHide: true });
  try {
    await git(['init', '-b', 'main']);
    await git(['config', 'user.email', 'fixture@example.invalid']);
    await git(['config', 'user.name', 'Fixture']);
    await mkdir(path.join(root, '.autocode'));
    await writeFile(path.join(root, '.gitignore'), '.autocode/\n');
    await writeFile(path.join(root, '.gitattributes'), '*.txt diff=probe\n');
    await writeFile(path.join(root, 'sample.txt'), 'initial');
    await writeFile(
      path.join(root, 'textconv.cjs'),
      "require('node:fs').writeFileSync('.autocode/textconv-marker','outside');process.stdout.write('masked');",
    );
    await writeFile(
      path.join(root, 'fsmonitor.cjs'),
      "require('node:fs').writeFileSync('.autocode/fsmonitor-marker','outside');process.stdout.write(Date.now()+'\\0');",
    );
    await git(['add', '.']);
    await git(['commit', '-m', 'fixture']);
    await git(['config', 'diff.probe.textconv', 'node textconv.cjs']);
    await writeFile(path.join(root, 'sample.txt'), 'first change');
    // Positive controls reproduce execution outside AppContainer and a hidden diff.
    const unsafe = await git(['diff', '--binary', '--no-ext-diff', 'HEAD']);
    assert.equal(unsafe.stdout, '');
    assert.equal(
      await readFile(path.join(root, '.autocode', 'textconv-marker'), 'utf8'),
      'outside',
    );
    await unlink(path.join(root, '.autocode', 'textconv-marker'));
    await git(['config', 'core.fsmonitor', 'node fsmonitor.cjs']);
    await git(['status', '--porcelain']);
    assert.equal(
      await readFile(path.join(root, '.autocode', 'fsmonitor-marker'), 'utf8'),
      'outside',
    );
    await unlink(path.join(root, '.autocode', 'fsmonitor-marker'));
    await writeFile(
      path.join(root, '.gitattributes'),
      '*.txt diff=probe filter=probe\n',
    );
    await writeFile(
      path.join(root, 'clean.cjs'),
      "require('node:fs').writeFileSync('.autocode/clean-marker','outside');process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('initial'));",
    );
    await git(['config', 'filter.probe.clean', 'node clean.cjs']);
    await git(['config', 'filter.probe.required', 'true']);
    await git([
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--no-textconv',
      '--no-ext-diff',
      'HEAD',
    ]);
    assert.equal(
      await readFile(path.join(root, '.autocode/clean-marker'), 'utf8'),
      'outside',
    );
    await unlink(path.join(root, '.autocode/clean-marker'));
    await writeFile(
      path.join(root, 'process.cjs'),
      "require('node:fs').writeFileSync('.autocode/process-marker','outside');process.exit(1);",
    );
    await git(['config', 'filter.probe.process', 'node process.cjs']);
    await git([
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--no-textconv',
      '--no-ext-diff',
      'HEAD',
    ]).catch(() => undefined);
    assert.equal(
      await readFile(path.join(root, '.autocode/process-marker'), 'utf8'),
      'outside',
    );
    await unlink(path.join(root, '.autocode/process-marker'));
    const before = await snapshotWorktree(root);
    await writeFile(path.join(root, 'sample.txt'), 'second change');
    assert.notEqual(
      await snapshotWorktree(root),
      before,
      'raw changes must invalidate evidence even when textconv hides them',
    );
    for (const marker of [
      'textconv-marker',
      'fsmonitor-marker',
      'clean-marker',
      'process-marker',
    ])
      await assert.rejects(
        () => readFile(path.join(root, '.autocode', marker)),
        { code: 'ENOENT' },
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
