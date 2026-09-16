import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertRunnerResourcesUnchanged,
  CodexRunnerAdapter,
} from './codex-runner.js';
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

test('Codex preflight rejects direct and indirect relative prefix resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
  try {
    await writeFile(path.join(root, 'runner.mjs'), 'export {}\n');
    for (const commandPrefixArguments of [['runner.mjs'], ['-m', 'runner']])
      await assert.rejects(
        () =>
          preflightCodexSession(root, {
            command: process.execPath,
            commandPrefixArguments,
          }),
        /Codex executable or resources could not be resolved safely/,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'reused Codex adapters reject changed transitive resources during preflight',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const runnerDirectory = path.join(root, 'runner');
      await mkdir(runnerDirectory);
      const executable = path.join(runnerDirectory, 'runner.mjs');
      const helper = path.join(runnerDirectory, 'helper.mjs');
      await writeFile(
        executable,
        "import './helper.mjs';\nexport const revision = 1;\n",
      );
      await writeFile(helper, 'export const helper = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await adapter.prepare(root, 'planner', { runner: 'codex' });
      await writeFile(helper, 'export const helper = 2;\n');
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner resources changed/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject nonliteral dynamic runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      await writeFile(
        executable,
        "const dependency = './helper.mjs';\nawait import(dependency);\n",
      );
      await writeFile(
        path.join(root, 'helper.mjs'),
        'export const helper = 1;\n',
      );
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependencies could not be inspected safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject package-resolved runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      await writeFile(
        executable,
        "import 'runner-helper';\nimport 'node:crypto';\n",
      );
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependencies could not be inspected safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject alternate runner dependency loaders',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      await writeFile(
        executable,
        "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nload('./helper.cjs');\n",
      );
      await writeFile(path.join(root, 'helper.cjs'), 'module.exports = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependencies could not be inspected safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'reused Codex adapters reject changed absolute imported resources',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      const helper = path.join(root, 'helper.mjs');
      await writeFile(
        executable,
        `import ${JSON.stringify(helper)};\nexport const revision = 1;\n`,
      );
      await writeFile(helper, 'export const helper = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await adapter.prepare(root, 'planner', { runner: 'codex' });
      await writeFile(helper, 'export const helper = 2;\n');
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner resources changed/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject entry scripts with unsupported dependency semantics',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.py');
      await writeFile(executable, 'import helper\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependencies could not be inspected safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject optional-chained runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cjs');
      await writeFile(executable, "require?.('./helper.cjs');\n");
      await writeFile(path.join(root, 'helper.cjs'), 'module.exports = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependencies could not be inspected safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
