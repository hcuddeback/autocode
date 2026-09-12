import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stringify } from 'yaml';
import { initializeProject } from './config.js';
import { runProjectWorkflow, parseReview } from './workflow.js';

const execFileAsync = promisify(execFile);

async function fixture(mode = 'success', policyKind = 'local') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-workflow-'));
  const repository = path.join(directory, 'repository');
  const root = path.join(directory, 'worktree');
  await mkdir(path.join(repository, 'tasks'), { recursive: true });
  const sections = [
    'Why now',
    'Required context',
    'Implementation constraints',
    'Required execution sequence',
    'Done when',
    'Deterministic validation',
    'Independent critical-review focus',
    'QA',
    'PR, merge, and production gates',
    'Files/areas expected',
    'Manual owner steps or blockers',
  ];
  await writeFile(
    path.join(repository, 'tasks', 'AC-001.md'),
    `---\ntask_id: AC-001\ntitle: Deliver fixture result\nstatus: ready\npriority: high\nrisk: low\nowner: fixture\nlast_updated: 2026-09-11\ndepends_on: []\nbranch: feat/AC-001\nqa: not_applicable\ndeployment: not_applicable\npull_request: ${policyKind === 'remote' ? 'required' : 'not_applicable'}\n---\n\n# Outcome\n\nDeliver a correct fixture result.\n\n## Scope\n\n### In\n\n- Write the fixture result.\n\n### Out\n\n- External changes.\n\n${sections.map((section) => `## ${section}\n\nFixture contract for ${section}.\n`).join('\n')}`,
  );
  await writeFile(path.join(repository, 'result.txt'), 'initial');
  if (mode === 'queue') {
    const first = await readFile(
      path.join(repository, 'tasks', 'AC-001.md'),
      'utf8',
    );
    await writeFile(
      path.join(repository, 'tasks', 'AC-002.md'),
      first.replaceAll('AC-001', 'AC-002'),
    );
  }
  await git(repository, ['init', '-b', 'main']);
  await git(repository, ['config', 'user.email', 'fixture@example.invalid']);
  await git(repository, ['config', 'user.name', 'Fixture']);
  await initializeProject(repository);
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'fixture']);
  await git(repository, ['worktree', 'add', '-b', 'feat/AC-001', root]);
  await initializeProject(root);
  const config = JSON.parse(
    JSON.stringify({
      version: 1,
      stateDirectory: '.autocode',
      telemetry: false,
      verification: {
        commands: [
          {
            name: 'fixture-result',
            command: 'node',
            args: [
              '-e',
              "const fs = require('node:fs'); process.exit(fs.readFileSync('result.txt', 'utf8') === 'broken' ? 1 : 0)",
            ],
          },
        ],
        timeoutMs: 10_000,
        maxOutputBytes: 100_000,
      },
      fixLoop: { maxAttempts: 2 },
    }),
  );
  await writeFile(
    path.join(root, '.autocode', 'config.yaml'),
    stringify(config),
  );
  const head = await git(root, ['rev-parse', 'HEAD']);
  const policy = {
    version: 1,
    qa: {
      kind: 'not-applicable',
      reason:
        'This internal fixture is fully covered by deterministic result checks.',
    },
    pullRequest: {
      kind: 'not-applicable',
      reason:
        'Disposable local fixture has no remote repository or publication target.',
    },
    completion: {
      merge: {
        headCommit: head,
        requirements: [
          {
            id: 'local-fixture',
            description: 'Operator-authorized disposable fixture completion',
          },
        ],
        signals: [
          {
            id: 'local-fixture',
            status: 'passed',
            reason: 'Explicit local fixture exception',
            headCommit: head,
          },
        ],
      },
      production: {
        kind: 'not-applicable',
        reason: 'Disposable local fixture has no production deployment.',
      },
    },
  };
  if (policyKind !== 'missing')
    await writeFile(
      path.join(root, '.autocode', 'workflow.json'),
      JSON.stringify(policy),
    );
  const fake = path.join(directory, 'fake-codex.mjs');
  const calls = path.join(directory, 'calls.jsonl');
  await writeFile(
    fake,
    `import fs from 'node:fs'; import {randomUUID} from 'node:crypto';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const role = input.includes('planning role') ? 'planning' : input.includes('critical-review role') ? 'review' : input.includes('Address only these') ? 'fix' : 'implementation';
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({role}) + '\\n');
const mode = ${JSON.stringify(mode)};
if (role === 'implementation' && !input.includes('GENERATED_PLAN_MARKER')) process.exit(9);
if (role === 'implementation') fs.writeFileSync('result.txt', mode === 'fix' || mode === 'never' ? 'broken' : mode === 'review-fix' ? 'needs-review' : 'good');
if (role === 'fix') fs.writeFileSync('result.txt', mode === 'never' ? 'broken' : 'good');
let final = role === 'planning' ? 'GENERATED_PLAN_MARKER: write result.txt then verify its content.' : 'Implemented only the fixture result.';
if (role === 'review') final = mode === 'malformed' ? 'Looks fine' : JSON.stringify(fs.readFileSync('result.txt','utf8') === 'needs-review' ? {outcome:'changes-requested',findings:[{id:'result',severity:'high',summary:'result.txt:1 still needs the fixture fix'}]} : {outcome:'passed',findings:[]});
console.log(JSON.stringify({type:'thread.started',thread_id:randomUUID()}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:final}}));
console.log(JSON.stringify({type:'turn.completed'}));
`,
  );
  return {
    directory,
    root,
    options: {
      codex: {
        command: process.execPath,
        commandPrefixArguments: [fake],
        timeoutMs: 10_000,
      },
    },
    calls: async () =>
      (await readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).role as string),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('integrated workflow plans, implements, verifies, reviews and completes without repeated effects', async () => {
  const f = await fixture();
  try {
    const result = await runProjectWorkflow(f.root, f.options);
    assert.equal(result.outcome, 'completed');
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'completed',
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
    const qa = JSON.parse(
      await readFile(path.join(result.runDirectory, 'qa.json'), 'utf8'),
    );
    assert.equal(qa.evidence.outcome, 'not-applicable');
    assert.equal(
      await readFile(path.join(f.root, 'result.txt'), 'utf8'),
      'good',
    );
  } finally {
    await f.cleanup();
  }
});

test('failed deterministic checks receive bounded fixes and fresh independent review', async () => {
  const f = await fixture('fix');
  try {
    const paused = await runProjectWorkflow(f.root, {
      ...f.options,
      durable: { pauseAfterPhase: 'verify-0' },
    });
    assert.equal(paused.outcome, 'paused');
    assert.deepEqual(await f.calls(), ['planning', 'implementation']);
    const resumed = await runProjectWorkflow(f.root, f.options);
    assert.equal(resumed.outcome, 'completed');
    assert.deepEqual(await f.calls(), [
      'planning',
      'implementation',
      'fix',
      'review',
    ]);
    const first = JSON.parse(
      await readFile(path.join(resumed.runDirectory, 'verify-0.json'), 'utf8'),
    );
    const second = JSON.parse(
      await readFile(path.join(resumed.runDirectory, 'verify-1.json'), 'utf8'),
    );
    assert.equal(first.evidence.passed, false);
    assert.equal(second.evidence.passed, true);
  } finally {
    await f.cleanup();
  }
});

test('actionable structured review requires a fix, fresh checks, and another independent review', async () => {
  const f = await fixture('review-fix');
  try {
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'completed',
    );
    assert.deepEqual(await f.calls(), [
      'planning',
      'implementation',
      'review',
      'fix',
      'review',
    ]);
  } finally {
    await f.cleanup();
  }
});

test('fix ceiling remains exhausted after restarting a failed workflow', async () => {
  const f = await fixture('never');
  try {
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'failed',
    );
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'failed',
    );
    assert.deepEqual(await f.calls(), [
      'planning',
      'implementation',
      'fix',
      'fix',
    ]);
  } finally {
    await f.cleanup();
  }
});

test('missing QA and required remote gates block completion', async () => {
  for (const kind of ['missing', 'remote']) {
    const f = await fixture('success', kind);
    try {
      assert.equal(
        (await runProjectWorkflow(f.root, f.options)).outcome,
        'blocked',
      );
    } finally {
      await f.cleanup();
    }
  }
});

test('workspace changes invalidate paused evidence', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await runProjectWorkflow(f.root, {
          ...f.options,
          durable: { pauseAfterPhase: 'implementation' },
        })
      ).outcome,
      'paused',
    );
    await writeFile(path.join(f.root, 'result.txt'), 'operator-edited');
    await assert.rejects(
      () => runProjectWorkflow(f.root, f.options),
      /stale after workspace changes/,
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation']);
  } finally {
    await f.cleanup();
  }
});

test('malformed agent review cannot pass and resume requires reconciliation', async () => {
  const f = await fixture('malformed');
  try {
    await assert.rejects(
      () => runProjectWorkflow(f.root, f.options),
      /reconciliation is required/,
    );
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'blocked',
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
  } finally {
    await f.cleanup();
  }
});

test('forced process interruption after an implementation receipt reconciles without another implementation', async () => {
  const f = await fixture();
  try {
    const child = path.join(f.directory, 'interrupt.mjs');
    await writeFile(
      child,
      `import {runProjectWorkflow} from ${JSON.stringify(new URL('./workflow.ts', import.meta.url).href)};
await runProjectWorkflow(${JSON.stringify(f.root)}, {...${JSON.stringify(f.options)}, durable:{onCheckpoint:async(checkpoint,state)=>{if(checkpoint==='after-effect-applied' && state.phases.find(p=>p.id==='implementation').status==='in-flight') process.exit(0)}}});`,
    );
    await execFileAsync(process.execPath, ['--import', 'tsx', child], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 30_000,
    });
    assert.deepEqual(await f.calls(), ['planning', 'implementation']);
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'completed',
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
  } finally {
    await f.cleanup();
  }
});

test('review schema rejects conflicting outcomes, duplicate findings and unknown fields', () => {
  for (const value of [
    {
      outcome: 'passed',
      findings: [{ id: 'a', severity: 'low', summary: 'file:1' }],
    },
    { outcome: 'changes-requested', findings: [] },
    { outcome: 'passed', findings: [], ignoreChecks: true },
    {
      outcome: 'changes-requested',
      findings: [
        { id: 'a', severity: 'high', summary: 'file:1' },
        { id: 'a', severity: 'high', summary: 'file:2' },
      ],
    },
  ])
    assert.throws(() => parseReview(JSON.stringify(value)));
});

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    windowsHide: true,
  });
  return stdout.trim();
}

test('workflow verification binds the selected task when another task is ready', async () => {
  const f = await fixture('queue');
  try {
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'completed',
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
  } finally {
    await f.cleanup();
  }
});

test('required QA records scenario evidence and blocks code changes that stale prior checks', async () => {
  for (const mutate of [false, true]) {
    const f = await fixture();
    try {
      const policyPath = path.join(f.root, '.autocode', 'workflow.json');
      const policy = JSON.parse(await readFile(policyPath, 'utf8'));
      policy.qa = {
        kind: 'required',
        reason: 'Observe the fixture result through a runtime scenario.',
        scenarios: [
          {
            name: 'result',
            description: 'Read the implemented fixture result.',
          },
        ],
      };
      await writeFile(policyPath, JSON.stringify(policy));
      let scenarios = 0;
      const result = await runProjectWorkflow(f.root, {
        ...f.options,
        qa: {
          async run() {
            scenarios++;
            assert.equal(
              await readFile(path.join(f.root, 'result.txt'), 'utf8'),
              'good',
            );
            if (mutate)
              await writeFile(path.join(f.root, 'result.txt'), 'changed-by-qa');
            return {
              kind: 'passed',
              reason: 'Observed the expected fixture result.',
            };
          },
        },
      });
      assert.equal(result.outcome, mutate ? 'blocked' : 'completed');
      assert.equal(scenarios, 1);
      const evidence = JSON.parse(
        await readFile(path.join(result.runDirectory, 'qa.json'), 'utf8'),
      );
      assert.equal(evidence.evidence.applicability, 'required');
    } finally {
      await f.cleanup();
    }
  }
});

test('stale completion signals and changed operator configuration prevent completion', async () => {
  const f = await fixture();
  try {
    const policyPath = path.join(f.root, '.autocode', 'workflow.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.completion.merge.signals[0].headCommit = 'a'.repeat(40);
    await writeFile(policyPath, JSON.stringify(policy));
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'blocked',
    );
    await writeFile(policyPath, JSON.stringify({ ...policy, qa: undefined }));
    await assert.rejects(
      () => runProjectWorkflow(f.root, f.options),
      /invalid workflow receipt|definition|configuration/,
    );
  } finally {
    await f.cleanup();
  }
});

test('required production cannot complete from static base-commit signals', async () => {
  const f = await fixture();
  try {
    const policyPath = path.join(f.root, '.autocode', 'workflow.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    const head = policy.completion.merge.headCommit;
    policy.completion.production = {
      kind: 'required',
      reason: 'Production smoke is required for this workflow.',
      deploymentId: 'deployment',
      sourceCommit: head,
      requirements: [
        { id: 'smoke', description: 'Verify deployed implementation' },
      ],
      signals: [
        {
          id: 'smoke',
          status: 'passed',
          reason: 'Static signal for base commit',
          deploymentId: 'deployment',
          sourceCommit: head,
        },
      ],
    };
    await writeFile(policyPath, JSON.stringify(policy));
    const result = await runProjectWorkflow(f.root, f.options);
    assert.equal(result.outcome, 'blocked');
    assert.match(result.state.reason, /external deployment adapter/);
  } finally {
    await f.cleanup();
  }
});

test('resume refuses a new task run before invoking model effects', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }),
      /resume requires an existing workflow/,
    );
    await assert.rejects(() => f.calls(), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test(
  'CLI run and resume complete a disposable fixture with fake Codex on PATH',
  { skip: process.platform !== 'win32' },
  async () => {
    const f = await fixture();
    try {
      const binaryDirectory = path.join(f.directory, 'bin');
      await mkdir(binaryDirectory);
      // A renamed Node binary interprets the fake exec script; no authenticated model is invoked.
      await copyFile(process.execPath, path.join(binaryDirectory, 'codex.exe'));
      const fakeScript = f.options.codex.commandPrefixArguments[0]!;
      await copyFile(fakeScript, path.join(f.root, 'exec'));
      await git(f.root, ['add', '--', 'exec']);
      await git(f.root, ['commit', '-m', 'add CLI model stub']);
      const policyPath = path.join(f.root, '.autocode', 'workflow.json');
      const policy = JSON.parse(await readFile(policyPath, 'utf8'));
      const head = await git(f.root, ['rev-parse', 'HEAD']);
      policy.completion.merge.headCommit = head;
      policy.completion.merge.signals[0].headCommit = head;
      await writeFile(policyPath, JSON.stringify(policy));
      const environment = {
        ...process.env,
        PATH: `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      };
      const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
      for (const command of ['run', 'resume']) {
        const { stdout } = await execFileAsync(
          process.execPath,
          ['--import', 'tsx', cli, command, f.root],
          {
            env: environment,
            cwd: process.cwd(),
            windowsHide: true,
            timeout: 90_000,
          },
        );
        assert.match(stdout, /Workflow completed:/);
      }
      assert.deepEqual(await f.calls(), [
        'planning',
        'implementation',
        'review',
      ]);
    } finally {
      await f.cleanup();
    }
  },
);
