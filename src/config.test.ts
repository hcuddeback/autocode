import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { initializeProject, validateConfig } from './config.js';

const execFileAsync = promisify(execFile);

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
      await readFile(path.join(project, '.gitignore'), 'utf8'),
      '.autocode/\n',
    );
    assert.equal(
      (await stat(path.join(project, '.autocode', 'runs'))).isDirectory(),
      true,
    );
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
    await assert.rejects(
      () => readFile(path.join(project, '.gitignore')),
      /ENOENT/,
    );
    await assert.rejects(
      () => stat(path.join(project, '.autocode', 'runs')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization preserves gitignore content and adds the rule once', async () => {
  const project = await temporaryProject();
  try {
    await writeFile(path.join(project, '.gitignore'), 'dist/');
    await initializeProject(project);
    await initializeProject(project);
    assert.equal(
      await readFile(path.join(project, '.gitignore'), 'utf8'),
      'dist/\n.autocode/\n',
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('validation rejects unknown configuration keys', () => {
  assert.throws(
    () =>
      validateConfig({
        version: 1,
        stateDirectory: '.autocode',
        telemetry: false,
        token: 'must-not-be-accepted',
      }),
    /unknown configuration key: token/,
  );
});

test('initialization rejects a missing project directory', async () => {
  const parent = await temporaryProject();
  const missing = path.join(parent, 'missing');
  try {
    await assert.rejects(() => initializeProject(missing), /ENOENT/);
    await assert.rejects(() => stat(missing), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('concurrent initialization remains idempotent', async () => {
  const project = await temporaryProject();
  try {
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => initializeProject(project)),
    );
    assert.equal(results.includes('created'), true);
    assert.equal(
      await readFile(path.join(project, '.gitignore'), 'utf8'),
      'dist/\n.autocode/\n',
    );
    validateConfig(
      parse(
        await readFile(path.join(project, '.autocode', 'config.yaml'), 'utf8'),
      ),
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization refuses a symbolic-link state directory', async () => {
  const project = await temporaryProject();
  const externalState = await temporaryProject();
  try {
    await symlink(externalState, path.join(project, '.autocode'), 'junction');
    await assert.rejects(
      () => initializeProject(project),
      /state directory must not be a symbolic link/,
    );
    await assert.rejects(
      () => stat(path.join(externalState, 'config.yaml')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(externalState, { recursive: true, force: true });
  }
});

test('initialization refuses a symbolic-link runs directory', async () => {
  const project = await temporaryProject();
  const externalRuns = await temporaryProject();
  try {
    await mkdir(path.join(project, '.autocode'));
    await symlink(
      externalRuns,
      path.join(project, '.autocode', 'runs'),
      'junction',
    );
    await assert.rejects(
      () => initializeProject(project),
      /runs directory must not be a symbolic link/,
    );
    await assert.rejects(
      () => stat(path.join(project, '.autocode', 'config.yaml')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(externalRuns, { recursive: true, force: true });
  }
});

test('initialization refuses AutoCode files already tracked by Git', async () => {
  const project = await temporaryProject();
  try {
    await execFileAsync('git', ['init'], { cwd: project });
    await mkdir(path.join(project, '.autocode'));
    const configPath = path.join(project, '.autocode', 'config.yaml');
    await writeFile(configPath, 'tracked placeholder\n');
    await execFileAsync('git', ['add', '--', '.autocode/config.yaml'], {
      cwd: project,
    });

    await assert.rejects(
      () => initializeProject(project),
      /contains files tracked by Git/,
    );
    assert.equal(await readFile(configPath, 'utf8'), 'tracked placeholder\n');
    await assert.rejects(
      () => stat(path.join(project, '.autocode', 'runs')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization reclaims a lock owned by a terminated process', async () => {
  const project = await temporaryProject();
  try {
    await mkdir(path.join(project, '.autocode', 'init.lock'), {
      recursive: true,
    });
    await writeFile(
      path.join(project, '.autocode', 'init.lock', 'owner.json'),
      JSON.stringify({ hostname: os.hostname(), pid: 2_147_483_647 }),
    );

    assert.equal(await initializeProject(project), 'created');
    await assert.rejects(
      () => stat(path.join(project, '.autocode', 'init.lock')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization appends a rule after a Git ignore negation', async () => {
  const project = await temporaryProject();
  try {
    await execFileAsync('git', ['init'], { cwd: project });
    await writeFile(
      path.join(project, '.gitignore'),
      '.autocode/\n!.autocode/\n!.autocode/config.yaml\n',
    );

    await initializeProject(project);

    assert.equal(
      await readFile(path.join(project, '.gitignore'), 'utf8'),
      '.autocode/\n!.autocode/\n!.autocode/config.yaml\n.autocode/\n',
    );
    await execFileAsync(
      'git',
      ['check-ignore', '--quiet', '--no-index', '--', '.autocode/config.yaml'],
      { cwd: project },
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization restores ignore coverage for run evidence', async () => {
  const project = await temporaryProject();
  try {
    await execFileAsync('git', ['init'], { cwd: project });
    await writeFile(
      path.join(project, '.gitignore'),
      '.autocode/\n!.autocode/\n.autocode/config.yaml\n!.autocode/runs/\n!.autocode/runs/**\n',
    );

    await initializeProject(project);

    await execFileAsync(
      'git',
      [
        'check-ignore',
        '--quiet',
        '--no-index',
        '--',
        '.autocode/runs/evidence.txt',
      ],
      { cwd: project },
    );
    assert.equal(
      (await readFile(path.join(project, '.gitignore'), 'utf8')).endsWith(
        '.autocode/\n',
      ),
      true,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('initialization reclaims an expired lock from another host', async () => {
  const project = await temporaryProject();
  try {
    await mkdir(path.join(project, '.autocode', 'init.lock'), {
      recursive: true,
    });
    const ownerPath = path.join(
      project,
      '.autocode',
      'init.lock',
      'owner.json',
    );
    await writeFile(
      ownerPath,
      JSON.stringify({ hostname: 'previous-host', pid: process.pid }),
    );
    const expired = new Date(Date.now() - 120_000);
    await utimes(ownerPath, expired, expired);

    assert.equal(await initializeProject(project), 'created');
    await assert.rejects(
      () => stat(path.join(project, '.autocode', 'init.lock')),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
