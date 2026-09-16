import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertRunnerResourcesUnchanged } from './codex-runner.js';
import { preflightCodexSession } from './codex.js';
import { snapshotQaInputs } from './qa-inputs.js';

test('runner resource freshness rejects executable content changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
  try {
    const executable = path.join(root, 'runner.mjs');
    await writeFile(executable, 'export const revision = 1;\n');
    const configuration = createHash('sha256')
      .update('runner-test')
      .digest('hex');
    const snapshot = await snapshotQaInputs(root, configuration, [executable]);
    await assertRunnerResourcesUnchanged(root, snapshot);
    await writeFile(executable, 'export const revision = 2;\n');
    await assert.rejects(
      () => assertRunnerResourcesUnchanged(root, snapshot),
      /Codex runner resources changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex preflight rejects an existing relative prefix resource', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
  try {
    await writeFile(path.join(root, 'runner.mjs'), 'export {}\n');
    await assert.rejects(
      () =>
        preflightCodexSession(root, {
          command: process.execPath,
          commandPrefixArguments: ['runner.mjs'],
        }),
      /Codex executable or resources could not be resolved safely/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
