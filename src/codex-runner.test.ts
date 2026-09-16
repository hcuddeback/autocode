import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
        runnerResourceFiles: [executable, helper],
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
        runnerResourceFiles: [executable, path.join(root, 'helper.mjs')],
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
  'Codex adapters track commented dynamic runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      const helper = path.join(root, 'helper.mjs');
      await writeFile(
        executable,
        "await import /* dependency */ ('./helper.mjs');\n",
      );
      await writeFile(helper, 'export const helper = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
        runnerResourceFiles: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependency is absent from its manifest/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters track commented static runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      const helper = path.join(root, 'helper.mjs');
      await writeFile(executable, "import /* dependency */ './helper.mjs';\n");
      await writeFile(helper, 'export const helper = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
        runnerResourceFiles: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependency is absent from its manifest/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters track compact static runner dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      const helper = path.join(root, 'helper.mjs');
      await writeFile(helper, 'export const helper = 1;\n');
      for (const source of [
        "import'./helper.mjs';\n",
        "import{helper}from'./helper.mjs';\n",
      ]) {
        await writeFile(executable, source);
        const adapter = new CodexRunnerAdapter({
          command: process.execPath,
          commandPrefixArguments: [executable],
          runnerResourceFiles: [executable],
        });
        await assert.rejects(
          () => adapter.prepare(root, 'planner', { runner: 'codex' }),
          /Codex runner dependency is absent from its manifest/,
        );
      }
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
        runnerResourceFiles: [executable],
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
        runnerResourceFiles: [executable, path.join(root, 'helper.cjs')],
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
  'Codex adapters require and bind manifests for filesystem-loaded dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.mjs');
      const helper = path.join(root, 'helper.js');
      await writeFile(
        executable,
        "import { readFileSync } from 'node:fs';\neval(readFileSync('./helper.js', 'utf8'));\n",
      );
      await writeFile(helper, 'globalThis.runnerRevision = 1;\n');
      const missingManifest = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
      });
      await assert.rejects(
        () => missingManifest.prepare(root, 'planner', { runner: 'codex' }),
        /Codex executable or resources could not be resolved safely/,
      );
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
        runnerResourceFiles: [executable, helper],
      });
      await adapter.prepare(root, 'planner', { runner: 'codex' });
      await writeFile(helper, 'globalThis.runnerRevision = 2;\n');
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
        runnerResourceFiles: [executable, helper],
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
        runnerResourceFiles: [executable],
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
        runnerResourceFiles: [executable, path.join(root, 'helper.cjs')],
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
  'Codex adapters reject Unicode-escaped runner loader identifiers',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cjs');
      const helper = path.join(root, 'helper.cjs');
      await writeFile(executable, "requ\\u0069re('./helper.cjs');\n");
      await writeFile(helper, 'module.exports = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
        runnerResourceFiles: [executable],
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
  'runner resource identity preserves case-sensitive canonical paths',
  { skip: process.platform !== 'win32' },
  async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'Runner.mjs');
      const helper = path.join(root, 'runner.mjs');
      await writeFile(executable, "import './runner.mjs';\n");
      await writeFile(helper, 'export const helper = 1;\n');
      const executableCanonical = await realpath(executable);
      const helperCanonical = await realpath(helper);
      if (executableCanonical === helperCanonical) {
        context.skip('fixture directory is not case-sensitive');
        return;
      }
      const adapter = new CodexRunnerAdapter({
        command: process.execPath,
        commandPrefixArguments: [executable],
        runnerResourceFiles: [executable, helper],
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
  'Codex adapters require and bind manifests for batch command wrappers',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'helper.cmd');
      await writeFile(executable, '@call "%~dp0helper.cmd"\r\n');
      await writeFile(helper, '@exit /b 0\r\n');
      const missingManifest = new CodexRunnerAdapter({ command: executable });
      await assert.rejects(
        () => missingManifest.prepare(root, 'planner', { runner: 'codex' }),
        /Codex executable or resources could not be resolved safely/,
      );
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable, helper],
      });
      await adapter.prepare(root, 'planner', { runner: 'codex' });
      await writeFile(helper, '@exit /b 1\r\n');
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
  'default Codex batch shims bind their discovered resources automatically',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    const root = path.join(directory, 'worktree');
    const bin = path.join(directory, 'bin');
    const originalPath = process.env.PATH;
    try {
      await mkdir(root);
      await mkdir(bin);
      const executable = path.join(bin, 'codex.cmd');
      const helper = path.join(bin, 'helper.cmd');
      await writeFile(executable, '@call "%~dp0helper.cmd" %*\r\n');
      await writeFile(helper, '@exit /b 0\r\n');
      process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
      const prepared = await preflightCodexSession(root);
      assert.deepEqual(prepared.runnerResourceFiles, [executable, helper]);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'reused Codex adapters reject newly created batch dependencies',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'late.cmd');
      await writeFile(
        executable,
        '@if exist "%~dp0late.cmd" call "%~dp0late.cmd"\r\n',
      );
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable],
      });
      await adapter.prepare(root, 'implementer', { runner: 'codex' });
      await writeFile(helper, '@exit /b 0\r\n');
      await assert.rejects(
        () => adapter.prepare(root, 'reviewer', { runner: 'codex' }),
        /Codex executable or resources could not be resolved safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'prepared Codex roles rediscover batch dependencies before invocation',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'late.cmd');
      await writeFile(
        executable,
        '@if exist "%~dp0late.cmd" call "%~dp0late.cmd"\r\n',
      );
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable],
      });
      const reviewer = await adapter.prepare(root, 'reviewer', {
        runner: 'codex',
      });
      await writeFile(helper, '@exit /b 0\r\n');
      await assert.rejects(
        () =>
          reviewer.invoke({
            role: 'reviewer',
            effectId: 'review-effect',
            artifactName: 'review',
          }),
        /Codex runner resources changed/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters require transitive batch dependencies in the manifest',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'helper.cmd');
      const nested = path.join(root, 'nested.cmd');
      await writeFile(executable, '@call "%~dp0helper.cmd"\r\n');
      await writeFile(helper, '@call "%~dp0nested.cmd"\r\n');
      await writeFile(nested, '@exit /b 0\r\n');
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable, helper],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex executable or resources could not be resolved safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters traverse scripts reached through batch wrappers',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'helper.mjs');
      const nested = path.join(root, 'nested.mjs');
      await writeFile(executable, '@node "%~dp0helper.mjs"\r\n');
      await writeFile(helper, "import './nested.mjs';\n");
      await writeFile(nested, 'export const nested = 1;\n');
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable, helper],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex runner dependency is absent from its manifest/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'Codex adapters reject dynamic batch dependencies after directory prefixes',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autocode-runner-'));
    try {
      const executable = path.join(root, 'runner.cmd');
      const helper = path.join(root, 'helper.cmd');
      await writeFile(
        executable,
        '@set "DEP=helper"\r\n@call "%~dp0%DEP%.cmd"\r\n',
      );
      await writeFile(helper, '@exit /b 0\r\n');
      const adapter = new CodexRunnerAdapter({
        command: executable,
        runnerResourceFiles: [executable],
      });
      await assert.rejects(
        () => adapter.prepare(root, 'planner', { runner: 'codex' }),
        /Codex executable or resources could not be resolved safely/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
