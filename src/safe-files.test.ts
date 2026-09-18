import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readStableRegularFile } from './safe-files.js';

test('bounded reads consume no more than the configured byte limit', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'autocode-safe-file-'),
  );
  const file = path.join(directory, 'input');
  try {
    await writeFile(file, '12345678');
    assert.equal(await readStableRegularFile(file, 8, 'fixture'), '12345678');
    await writeFile(file, '123456789');
    await assert.rejects(
      () => readStableRegularFile(file, 8, 'fixture'),
      /bounded regular file/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
