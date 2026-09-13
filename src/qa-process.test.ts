import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createContainedQaAdapter,
  assertContainedQaAdapter,
  runContainedProcess,
} from './qa-process.js';
import { runProjectWorkflow } from './workflow.js';
import { runRoleSeparatedCodexSessions } from './codex.js';
import { runDeterministicVerification } from './verification.js';

test(
  'Windows sandbox rejects a helper inside an authorized writable directory',
  { skip: process.platform !== 'win32' },
  async () => {
    await assert.rejects(
      () =>
        runContainedProcess(
          process.execPath,
          ['-e', 'process.exit(0)'],
          os.tmpdir(),
          5000,
          1000,
        ),
      /helper must be outside every writable resource/,
    );
  },
);

test(
  'Windows AppContainer denies durable metadata writes before process exit',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-metadata-'),
    );
    try {
      await mkdir(path.join(directory, '.autocode'));
      await mkdir(path.join(directory, '.git'));
      await writeFile(
        path.join(directory, '.autocode', 'events.jsonl'),
        'trusted',
      );
      await writeFile(path.join(directory, '.git', 'HEAD'), 'trusted');
      const aclPaths = Buffer.from(
        JSON.stringify([
          directory,
          path.join(directory, '.autocode'),
          path.join(directory, '.git'),
          path.join(directory, '.autocode', 'events.jsonl'),
          path.join(directory, '.git', 'HEAD'),
        ]),
      ).toString('base64');
      const snapshotAcl = async () =>
        (
          await promisify(execFile)(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${aclPaths}')) | ConvertFrom-Json | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl } | ConvertTo-Json -Compress`,
            ],
            { windowsHide: true },
          )
        ).stdout.trim();
      const originalAcl = await snapshotAcl();
      const result = await runContainedProcess(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs');
const attempts=[()=>fs.writeFileSync('.autocode/events.jsonl','forged'),()=>fs.writeFileSync('.autocode/completion.json','forged'),()=>fs.unlinkSync('.autocode/events.jsonl'),()=>fs.renameSync('.autocode','moved-state'),()=>fs.writeFileSync('.git/HEAD','forged'),()=>fs.renameSync('.git','moved-git')];
for(const [index,attempt] of attempts.entries()){try{attempt();console.error("allowed mutation",index);process.exit(9)}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error}}
fs.writeFileSync('result.txt','initial');fs.writeFileSync('result.txt',fs.readFileSync('result.txt','utf8')==='initial'?'good':'bad');console.log(fs.readFileSync('.autocode/events.jsonl','utf8'));`,
        ],
        directory,
        10_000,
        10_000,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(
        await snapshotAcl(),
        originalAcl,
        'metadata and worktree ACLs must be restored',
      );
      assert.match(result.stdout, /trusted/);
      assert.equal(
        await readFile(
          path.join(directory, '.autocode', 'events.jsonl'),
          'utf8',
        ),
        'trusted',
      );
      assert.equal(
        await readFile(path.join(directory, '.git', 'HEAD'), 'utf8'),
        'trusted',
      );
      assert.equal(
        await readFile(path.join(directory, 'result.txt'), 'utf8'),
        'good',
      );
      await assert.rejects(
        () => readFile(path.join(directory, '.autocode', 'completion.json')),
        { code: 'ENOENT' },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows AppContainer denies Task Scheduler brokers and ungranted files',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-broker-'));
    const vault = await mkdtemp(path.join(os.tmpdir(), 'autocode-vault-'));
    const scheduler = path.join(
      process.env.SystemRoot ?? 'C:/Windows',
      'System32',
      'schtasks.exe',
    );
    const taskName = 'autocode-sandbox-' + path.basename(directory);
    const exec = promisify(execFile);
    try {
      const secret = path.join(vault, 'secret.txt');
      await writeFile(secret, 'operator-private');
      const registration = await runContainedProcess(
        scheduler,
        [
          '/create',
          '/tn',
          taskName,
          '/sc',
          'once',
          '/st',
          '23:59',
          '/sd',
          '12/31/2099',
          '/tr',
          'cmd /c exit 0',
        ],
        directory,
        30000,
        100000,
      );
      assert.notEqual(registration.exitCode, 0, registration.stdout);
      await assert.rejects(
        exec(scheduler, ['/query', '/tn', taskName], { windowsHide: true }),
        /cannot find/i,
      );
      // An existing operator-owned task distinguishes denial from a missing task.
      const marker = path.join(vault, 'scheduler-marker.txt');
      const action = `cmd.exe /d /c echo harmless-control>"${marker}"`;
      await exec(
        scheduler,
        [
          '/create',
          '/tn',
          taskName,
          '/sc',
          'once',
          '/st',
          '23:59',
          '/sd',
          '12/31/2099',
          '/it',
          '/rl',
          'LIMITED',
          '/tr',
          action,
        ],
        { windowsHide: true },
      );
      const launch = await runContainedProcess(
        scheduler,
        ['/run', '/tn', taskName],
        directory,
        30000,
        100000,
      );
      assert.notEqual(launch.exitCode, 0, launch.stdout);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      // The same broker request from the trusted parent must actually run the task.
      await exec(scheduler, ['/run', '/tn', taskName], { windowsHide: true });
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await readFile(marker);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert.match(await readFile(marker, 'utf8'), /harmless-control/);
      const script = `const fs=require('node:fs');let privateRead;try{fs.readFileSync(${JSON.stringify(secret)});privateRead='allowed';}catch(e){privateRead=e.code;}fs.writeFileSync('ordinary-task.txt','allowed');console.log(JSON.stringify({privateRead,runtime:process.env.AUTOCODE_NODE}));`;
      const result = await runContainedProcess(
        process.execPath,
        ['-e', script],
        directory,
        15000,
        100000,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.match(output.privateRead, /EACCES|EPERM/);
      await assert.rejects(readFile(output.runtime), { code: 'ENOENT' });
      assert.equal(
        await readFile(path.join(directory, 'ordinary-task.txt'), 'utf8'),
        'allowed',
      );
    } finally {
      // Even an unexpectedly successful registration is removed by the trusted parent.
      await promisify(execFile)(scheduler, ['/delete', '/tn', taskName, '/f'], {
        windowsHide: true,
      }).catch(() => {});
      await rm(directory, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  },
);

test(
  'Windows batch commands preserve stdin and literal argv inside containment',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode batch&-'));
    const previous = process.env.AUTOCODE_BATCH_VALUE;
    process.env.AUTOCODE_BATCH_VALUE = 'must-not-expand';
    try {
      const bin = path.join(directory, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      const echo = path.join(directory, 'echo.mjs');
      await writeFile(
        echo,
        "let input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify({arguments:process.argv.slice(2),input}));",
      );
      const arguments_ = [
        'spaces é',
        'embedded "quotes"',
        'trailing\\',
        '%AUTOCODE_BATCH_VALUE%',
        '!AUTOCODE_BATCH_VALUE!',
        'a&b|c^d(e)<f>g;h,i',
        '" & echo injected > escaped.txt & "',
        '',
      ];
      const input = 'UTF-8 é prompt\n"%&^!"';
      for (const extension of ['cmd', 'bat'])
        await t.test(extension, async () => {
          const batch = path.join(
            extension === 'cmd' ? bin : directory,
            `fixture.${extension}`,
          );
          await writeFile(
            batch,
            `@echo off\r\n"%AUTOCODE_NODE%" "${echo}" %*\r\n`,
          );
          const result = await runContainedProcess(
            batch,
            arguments_,
            directory,
            10_000,
            100_000,
            input,
          );
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(JSON.parse(result.stdout), {
            arguments: arguments_,
            input,
          });
          await assert.rejects(
            () => readFile(path.join(directory, 'escaped.txt')),
            { code: 'ENOENT' },
          );
          for (const argument of ['line\nbreak', 'line\rbreak', '\0'])
            await assert.rejects(
              () =>
                runContainedProcess(batch, [argument], directory, 1000, 1024),
              /batch arguments cannot contain NUL or line breaks/,
            );
        });
    } finally {
      if (previous === undefined) delete process.env.AUTOCODE_BATCH_VALUE;
      else process.env.AUTOCODE_BATCH_VALUE = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('unsupported platforms cannot execute processes or accept workflow history', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-platform-'));
  const marker = path.join(directory, 'executed');
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const platform of ['linux', 'darwin']) {
      await t.test(platform, async () => {
        Object.defineProperty(process, 'platform', {
          ...descriptor,
          value: platform,
        });
        try {
          const unavailable =
            /secure process containment is currently unavailable/;
          await assert.rejects(
            () =>
              createContainedQaAdapter(directory, {
                command: 'node',
                arguments: [],
              }).run(
                {
                  name: 'blocked',
                  description: 'Unsupported process containment.',
                },
                { sequence: 1 },
              ),
            unavailable,
          );
          await assert.rejects(
            () =>
              runContainedProcess(
                process.execPath,
                [
                  '-e',
                  `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`,
                ],
                directory,
                1000,
                1024,
              ),
            unavailable,
          );
          await assert.rejects(
            () => runProjectWorkflow(directory, { resumeOnly: true }),
            unavailable,
          );
          await assert.rejects(
            () =>
              runRoleSeparatedCodexSessions(directory, {
                command: process.execPath,
              }),
            unavailable,
          );
          await assert.rejects(
            () => runDeterministicVerification(directory),
            unavailable,
          );
          await assert.rejects(() => readFile(marker), { code: 'ENOENT' });
        } finally {
          Object.defineProperty(process, 'platform', descriptor);
        }
      });
    }
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
    await rm(directory, { recursive: true, force: true });
  }
});

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
      const grandchild = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready + '.runtime')},process.env.AUTOCODE_NODE);fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)})){fs.writeFileSync(${JSON.stringify(escaped)},'escaped');process.exit(0);}},10);`;
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
      await assert.rejects(
        readFile(await readFile(ready + '.runtime', 'utf8')),
        { code: 'ENOENT' },
      );
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
