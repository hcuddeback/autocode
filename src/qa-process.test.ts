import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import {
  createContainedQaAdapter,
  assertContainedQaAdapter,
} from './qa-process.js';

test(
  'Windows QA job is terminated if its operator process dies',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-parent-'),
    );
    let worker: ReturnType<typeof spawn> | undefined;
    try {
      const ready = path.join(directory, 'ready'),
        trigger = path.join(directory, 'trigger'),
        escaped = path.join(directory, 'escaped');
      const child = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)}))fs.writeFileSync(${JSON.stringify(escaped)},'escaped');},10);`;
      const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();setInterval(()=>{},1000);`;
      const workerPath = path.join(directory, 'worker.mjs');
      await writeFile(
        workerPath,
        `import {createContainedQaAdapter} from ${JSON.stringify(new URL('./qa-process.ts', import.meta.url).href)};
await createContainedQaAdapter(${JSON.stringify(directory)},{command:'node',arguments:['-e',${JSON.stringify(script)}],timeoutMs:60_000}).run({name:'fixture',description:'Observe contained descendant lifetime.'},{sequence:1});`,
      );
      worker = spawn(process.execPath, ['--import', 'tsx', workerPath], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          await readFile(ready);
          break;
        } catch {
          if (Date.now() > deadline)
            throw new Error('QA descendant did not start');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const closed = new Promise((resolve) => worker!.once('close', resolve));
      worker.kill('SIGKILL');
      await closed;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await writeFile(trigger, 'trigger');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
    } finally {
      worker?.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('contained QA adapters reject unregistered callbacks and mismatched workspaces', () => {
  const root = process.cwd();
  assert.throws(
    () =>
      assertContainedQaAdapter(root, {
        async run() {
          return {};
        },
      }),
    /contained process adapter/,
  );
  const adapter = createContainedQaAdapter(root, {
    command: 'node',
    arguments: [],
  });
  assertContainedQaAdapter(root, adapter);
  assert.throws(
    () => assertContainedQaAdapter(path.join(root, 'other'), adapter),
    /contained process adapter/,
  );
  assert.equal(Object.isFrozen(adapter), true);
});

test(
  'Windows QA Job Object captures output and kills orphaned detached grandchildren',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-fixture-'),
    );
    try {
      const ready = path.join(directory, 'ready');
      const trigger = path.join(directory, 'trigger');
      const escaped = path.join(directory, 'escaped');
      const grandchild = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)})){fs.writeFileSync(${JSON.stringify(escaped)},'escaped');process.exit(0);}},10);`;
      const intermediary = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();`;
      const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(intermediary)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(timer);console.log(JSON.stringify({kind:'passed',reason:'Observed contained fixture result.'}));}},10);`;
      const adapter = createContainedQaAdapter(directory, {
        command: 'node',
        arguments: ['-e', script],
        timeoutMs: 20_000,
      });
      const result = await adapter.run(
        {
          name: 'fixture',
          description: 'Exercise the contained process fixture.',
        },
        { sequence: 1 },
      );
      assert.deepEqual(result, {
        kind: 'passed',
        reason: 'Observed contained fixture result.',
      });
      assert.equal(await readFile(ready, 'utf8'), 'ready');
      await writeFile(trigger, 'trigger');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows QA containment preserves argv and bounds timeout/output failures',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-failures-'),
    );
    try {
      const argument = 'spaces é "quoted" and trailing\\';
      const echo = createContainedQaAdapter(directory, {
        command: 'node',
        arguments: [
          '-e',
          "console.log(JSON.stringify({kind:'passed',reason:process.argv[1]}))",
          argument,
        ],
      });
      assert.deepEqual(
        await echo.run(
          { name: 'argv', description: 'Check preserved process arguments.' },
          { sequence: 1 },
        ),
        { kind: 'passed', reason: argument },
      );
      for (const failure of ['timeout', 'overflow']) {
        await t.test(failure, async () => {
          const ready = path.join(directory, failure + '-ready');
          const trigger = path.join(directory, failure + '-trigger');
          const escaped = path.join(directory, failure + '-escaped');
          const child = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)}))fs.writeFileSync(${JSON.stringify(escaped)},'escaped');},10);`;
          const script = `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(timer);${failure === 'overflow' ? "process.stdout.write('x'.repeat(64*1024));setInterval(()=>{},1000);" : 'setInterval(()=>{},1000);'}}},10);`;
          const adapter = createContainedQaAdapter(directory, {
            command: 'node',
            arguments: ['-e', script],
            timeoutMs: 8_000,
            maxOutputBytes: 1024,
          });
          await assert.rejects(
            () =>
              adapter.run(
                {
                  name: 'failure',
                  description: 'Check cleanup after contained process failure.',
                },
                { sequence: 1 },
              ),
            /contained QA process failed/,
          );
          assert.equal(await readFile(ready, 'utf8'), 'ready');
          await writeFile(trigger, 'trigger');
          await new Promise((resolve) => setTimeout(resolve, 200));
          await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
