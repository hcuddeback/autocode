import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initializeProject, validateConfig } from './config.js';

async function temporaryProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'autocode-'));
}

test('initialization creates valid state and is non-destructive on repeat', async () => {
  const project = await temporaryProject();
  try {
    assert.equal(await initializeProject(project), 'created');
    const configPath = path.join(project, '.autocode', 'config.yaml');
    const original = await readFile(configPath, 'utf8');
    assert.equal(
      validateConfig({
        version: 1,
        stateDirectory: '.autocode',
        telemetry: false,
      }).version,
      1,
    );
    assert.equal(await initializeProject(project), 'existing');
    assert.equal(await readFile(configPath, 'utf8'), original);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization rejects an invalid existing configuration', async () => {
  const project = await temporaryProject();
  try {
    await mkdir(path.join(project, '.autocode'), { recursive: true });
    await writeFile(path.join(project, '.autocode', 'config.yaml'), 'invalid');
    await assert.rejects(
      () => initializeProject(project),
      /existing configuration is invalid/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
