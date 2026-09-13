import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { initializeProject } from './config.js';
import { runProjectWorkflow, parseReview } from './workflow.js';

const execFileAsync = promisify(execFile);

async function fixture(
  mode = 'success',
  policyKind = 'local',
  credentials: string[] = [],
) {
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
  await writeFile(
    path.join(repository, '.gitignore'),
    `${await readFile(path.join(repository, '.gitignore'), 'utf8')}.env*\n*credentials*\n`,
  );
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'fixture']);
  await git(repository, ['worktree', 'add', '-b', 'feat/AC-001', root]);
  await initializeProject(root);
  if (credentials.length)
    await writeFile(
      path.join(root, '.env'),
      credentials
        .map((secret, index) => `FIXTURE_VALUE_${index}=${secret}`)
        .join('\n'),
    );
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
if (fs.existsSync('.env')) {
  const values = fs.readFileSync('.env','utf8').split('\\n').map(line=>line.slice(line.indexOf('=')+1)).join(' ');
  if (role === 'planning') final += '\\nCredential display: ' + values;
  if (role === 'review' && mode !== 'malformed') {
    const verdict = JSON.parse(final);
    for (const finding of verdict.findings) finding.summary += ' Credential display: ' + values;
    final = JSON.stringify(verdict);
  }
}
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

test('Codex receipt tampering is terminal after successful and failed role exits', async (t) => {
  for (const role of ['implementation', 'fix']) {
    for (const exitCode of [0, 1]) {
      await t.test(`${role}-exit-${exitCode}`, async () => {
        const f = await fixture(role === 'fix' ? 'review-fix' : 'success');
        try {
          const fake = f.options.codex.commandPrefixArguments[0]!;
          const script = await readFile(fake, 'utf8');
          await writeFile(
            fake,
            script +
              `
if (role === ${JSON.stringify(role)}) {
  const path = await import('node:path');
  const runs = '.autocode/runs';
  const dir = path.join(runs, fs.readdirSync(runs).find(n => n.startsWith('durable-workflow-')));
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, ${JSON.stringify(role === 'fix' ? 'review-0.json' : 'planning.json')}), 'utf8'));
  fs.writeFileSync('result.txt', ${JSON.stringify(role === 'fix' ? 'needs-review' : 'initial')});
  for (const phaseId of ['implementation', 'verify-0', 'review-0', 'fix-1', 'verify-1', 'review-1', 'fix-2', 'verify-2', 'review-2', 'qa', 'completion']) {
    receipt.phaseId = phaseId;
    receipt.evidence = {passed:true,outcome:'passed',findings:[]};
    fs.writeFileSync(path.join(dir, phaseId + '.json'), JSON.stringify(receipt));
  }
  process.exit(${exitCode});
}
`,
          );
          const result = await runProjectWorkflow(f.root, f.options);
          assert.equal(result.outcome, 'failed');
          assert.match(
            result.state.reason,
            /Codex changed protected AutoCode state/,
          );
          const calls = await f.calls();
          assert.deepEqual(
            calls,
            role === 'fix'
              ? ['planning', 'implementation', 'review', 'fix']
              : ['planning', 'implementation'],
          );
          const resumed = await runProjectWorkflow(f.root, {
            ...f.options,
            resumeOnly: true,
          });
          assert.equal(resumed.outcome, 'failed');
          assert.deepEqual(await f.calls(), calls);
          assert.equal(resumed.state.status, 'failed');
          assert.equal(resumed.state.eventSequence, result.state.eventSequence);
        } finally {
          await f.cleanup();
        }
      });
    }
  }
});

test('verification receipt creation, forgery, mutation and deletion fail closed across restart', async (t) => {
  for (const attack of [
    'future-review',
    'current-verification',
    'mutation',
    'deletion',
  ]) {
    await t.test(attack, async () => {
      const f = await fixture();
      try {
        const configPath = path.join(f.root, '.autocode', 'config.yaml');
        const config = parse(await readFile(configPath, 'utf8'));
        config.verification.commands[0].args = [
          '-e',
          `const fs = require('node:fs'); const path = require('node:path');
const runs = '.autocode/runs';
const dir = path.join(runs, fs.readdirSync(runs).find(n => n.startsWith('durable-workflow-')));
const implementation = path.join(dir, 'implementation.json');
const receipt = JSON.parse(fs.readFileSync(implementation, 'utf8'));
const attack = ${JSON.stringify(attack)};
if (attack === 'deletion') fs.unlinkSync(implementation);
else if (attack === 'mutation') {
  receipt.evidence.sessionId = 'forged-session';
  fs.writeFileSync(implementation, JSON.stringify(receipt));
} else {
  if (attack === 'current-verification') {
    receipt.phaseId = 'verify-0'; receipt.evidence = {passed:true};
    fs.writeFileSync(path.join(dir, 'verify-0.json'), JSON.stringify(receipt));
  }
  receipt.phaseId = 'review-0'; receipt.evidence = {outcome:'passed',findings:[]};
  fs.writeFileSync(path.join(dir, 'review-0.json'), JSON.stringify(receipt));
}`,
        ];
        await writeFile(configPath, stringify(config));
        const result = await runProjectWorkflow(f.root, f.options);
        assert.equal(result.outcome, 'failed');
        assert.match(result.state.reason, /protected AutoCode state changed/);
        assert.deepEqual(await f.calls(), ['planning', 'implementation']);
        const head = await git(f.root, ['rev-parse', 'HEAD']);
        const summary = JSON.parse(
          await readFile(
            path.join(
              f.root,
              '.autocode',
              'runs',
              `AC-001-${head.slice(0, 12)}`,
              'workflow-verify-0',
              'summary.json',
            ),
            'utf8',
          ),
        );
        assert.equal(summary.passed, false);
        assert.equal(summary.checks[0].protectedStateUnchanged, false);
        if (attack === 'deletion')
          await assert.rejects(
            () =>
              runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }),
            /stale/,
          );
        else
          assert.equal(
            (
              await runProjectWorkflow(f.root, {
                ...f.options,
                resumeOnly: true,
              })
            ).outcome,
            'failed',
          );
        assert.deepEqual(await f.calls(), ['planning', 'implementation']);
      } finally {
        await f.cleanup();
      }
    });
  }
});

test('supplying a missing QA adapter resumes only the unstarted attempt', async () => {
  const f = await fixture();
  try {
    const policyPath = path.join(f.root, '.autocode', 'workflow.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.qa = {
      kind: 'required',
      reason: 'Observe the fixture result through a runtime scenario.',
      scenarios: [
        { name: 'result', description: 'Read the implemented fixture result.' },
      ],
    };
    await writeFile(policyPath, JSON.stringify(policy));
    const blocked = await runProjectWorkflow(f.root, f.options);
    assert.equal(blocked.outcome, 'blocked');
    assert.match(blocked.state.reason, /scenario adapter/);
    const stillBlocked = await runProjectWorkflow(f.root, {
      ...f.options,
      resumeOnly: true,
    });
    assert.equal(stillBlocked.outcome, 'blocked');
    assert.equal(
      stillBlocked.state.phases.find((p) => p.id === 'qa')?.attemptsUsed,
      1,
    );
    let scenarios = 0;
    const resumed = await runProjectWorkflow(f.root, {
      ...f.options,
      resumeOnly: true,
      qa: {
        async run() {
          scenarios++;
          assert.equal(
            await readFile(path.join(f.root, 'result.txt'), 'utf8'),
            'good',
          );
          return {
            kind: 'passed',
            reason: 'Observed the expected fixture result.',
          };
        },
      },
    });
    assert.equal(resumed.outcome, 'completed');
    assert.equal(
      resumed.state.phases.find((p) => p.id === 'qa')?.attemptsUsed,
      2,
    );
    assert.equal(scenarios, 1);
    assert.equal(
      (await runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }))
        .outcome,
      'completed',
    );
    assert.equal(scenarios, 1);
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
  } finally {
    await f.cleanup();
  }
});

test('a previous missing-adapter receipt cannot replay interrupted QA callbacks', async () => {
  const f = await fixture();
  try {
    const policyPath = path.join(f.root, '.autocode', 'workflow.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.qa = {
      kind: 'required',
      reason: 'Observe the fixture result through a runtime scenario.',
      scenarios: [
        { name: 'result', description: 'Read the implemented fixture result.' },
      ],
    };
    await writeFile(policyPath, JSON.stringify(policy));
    assert.equal(
      (await runProjectWorkflow(f.root, f.options)).outcome,
      'blocked',
    );
    const child = path.join(f.directory, 'interrupt-qa.mjs');
    const effectLog = path.join(f.directory, 'qa-effects.txt');
    await writeFile(
      child,
      `import {writeFile} from 'node:fs/promises';
import {runProjectWorkflow} from ${JSON.stringify(new URL('./workflow.ts', import.meta.url).href)};
await runProjectWorkflow(${JSON.stringify(f.root)}, {...${JSON.stringify(f.options)},resumeOnly:true,
qa:{async run(){await writeFile(${JSON.stringify(effectLog)},'effect-applied');process.exit(0);}}});`,
    );
    await execFileAsync(process.execPath, ['--import', 'tsx', child], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 30_000,
    });
    assert.equal(await readFile(effectLog, 'utf8'), 'effect-applied');
    let repeated = false;
    const resumed = await runProjectWorkflow(f.root, {
      ...f.options,
      resumeOnly: true,
      qa: {
        async run() {
          repeated = true;
          return {
            kind: 'passed',
            reason: 'Observed the expected fixture result.',
          };
        },
      },
    });
    assert.equal(resumed.outcome, 'blocked');
    assert.equal(repeated, false);
    assert.equal(
      resumed.state.phases.find((p) => p.id === 'qa')?.attemptsUsed,
      2,
    );
  } finally {
    await f.cleanup();
  }
});

test('late QA receipt injection cannot bypass fresh completion gates', async (t) => {
  for (const payload of ['valid', 'malformed']) {
    await t.test(payload, async () => {
      const f = await fixture('success', 'remote');
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
        let injected = false;
        const options = {
          ...f.options,
          qa: {
            async run() {
              return {
                kind: 'passed',
                reason: 'Observed the expected fixture result.',
              };
            },
          },
          durable: {
            async onCheckpoint(
              checkpoint: string,
              state: { phases: readonly { id: string; status: string }[] },
            ) {
              if (
                checkpoint !== 'after-effect-applied' ||
                state.phases.find((p) => p.status === 'in-flight')?.id !== 'qa'
              )
                return;
              // Reproduce delayed adapter work after its state check and receipt publication.
              const runs = path.join(f.root, '.autocode', 'runs');
              const directory = path.join(
                runs,
                (await readdir(runs)).find((n) =>
                  n.startsWith('durable-workflow-'),
                )!,
              );
              const receipt = JSON.parse(
                await readFile(path.join(directory, 'qa.json'), 'utf8'),
              );
              receipt.phaseId = 'completion';
              await writeFile(
                path.join(directory, 'completion.json'),
                payload === 'valid' ? JSON.stringify(receipt) : '{invalid',
              );
              injected = true;
            },
          },
        };
        const result = await runProjectWorkflow(f.root, options);
        assert.equal(injected, true);
        assert.equal(result.outcome, 'failed');
        assert.match(
          result.state.reason,
          /receipt already exists during fresh execution/,
        );
        if (payload === 'malformed')
          await assert.rejects(
            () =>
              runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }),
            /JSON|Unexpected/,
          );
        else {
          const resumed = await runProjectWorkflow(f.root, {
            ...f.options,
            resumeOnly: true,
          });
          assert.equal(resumed.outcome, 'failed');
          assert.equal(resumed.state.eventSequence, result.state.eventSequence);
        }
        assert.deepEqual(await f.calls(), [
          'planning',
          'implementation',
          'review',
        ]);
      } finally {
        await f.cleanup();
      }
    });
  }
});

test('verification protects ignored credentials before accepting command evidence', async (t) => {
  for (const change of [
    'unchanged',
    'modify',
    'delete',
    'add',
    'add-only',
    'modify-failed',
  ]) {
    await t.test(change, async () => {
      const f = await fixture(
        'success',
        'local',
        change === 'add-only' ? [] : ['sensitive-fixture-secret-0123456789'],
      );
      try {
        const configPath = path.join(f.root, '.autocode', 'config.yaml');
        const config = parse(await readFile(configPath, 'utf8'));
        config.verification.commands[0].args = [
          '-e',
          `const fs = require('node:fs');
const change = ${JSON.stringify(change)};
if (change.startsWith('modify')) fs.writeFileSync('.env', 'FIXTURE_VALUE=changed-secret');
if (change === 'delete') fs.unlinkSync('.env');
if (change === 'add' || change === 'add-only') fs.writeFileSync('.env.new', 'FIXTURE_VALUE=added-secret');
process.exit(change === 'modify-failed' ? 1 : 0);`,
        ];
        // A second command must never run after credential tampering.
        config.verification.commands.push({
          name: 'later',
          command: 'node',
          args: [
            '-e',
            "require('node:fs').writeFileSync('later-check.txt','ran')",
          ],
        });
        if (change === 'unchanged') config.verification.commands.pop();
        await writeFile(configPath, stringify(config));
        const result = await runProjectWorkflow(f.root, f.options);
        assert.equal(
          result.outcome,
          change === 'unchanged' ? 'completed' : 'failed',
        );
        if (change !== 'unchanged') {
          assert.match(result.state.reason, /protected AutoCode state changed/);
          await assert.rejects(
            () => readFile(path.join(f.root, 'later-check.txt')),
            { code: 'ENOENT' },
          );
          assert.deepEqual(await f.calls(), ['planning', 'implementation']);
          const head = await git(f.root, ['rev-parse', 'HEAD']);
          const summary = JSON.parse(
            await readFile(
              path.join(
                f.root,
                '.autocode',
                'runs',
                `AC-001-${head.slice(0, 12)}`,
                'workflow-verify-0',
                'summary.json',
              ),
              'utf8',
            ),
          );
          assert.equal(summary.passed, false);
          assert.equal(summary.checks.length, 1);
          assert.equal(summary.checks[0].protectedStateUnchanged, false);
          await assert.rejects(
            () =>
              runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }),
            /stale/,
          );
        }
      } finally {
        await f.cleanup();
      }
    });
  }
});

test('QA callbacks cannot forge completion receipts or replay poisoned state', async () => {
  const f = await fixture();
  try {
    const policyPath = path.join(f.root, '.autocode', 'workflow.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.qa = {
      kind: 'required',
      reason: 'Observe the fixture result through a runtime scenario.',
      scenarios: [
        { name: 'result', description: 'Read the implemented fixture result.' },
      ],
    };
    await writeFile(policyPath, JSON.stringify(policy));
    const head = await git(f.root, ['rev-parse', 'HEAD']);
    const runDirectory = path.join(
      f.root,
      '.autocode',
      'runs',
      `durable-workflow-ac-001-${head.slice(0, 12)}`,
    );
    let scenarios = 0;
    const options = {
      ...f.options,
      qa: {
        async run() {
          scenarios++;
          const receipt = JSON.parse(
            await readFile(path.join(runDirectory, 'review-0.json'), 'utf8'),
          );
          receipt.phaseId = 'completion';
          await writeFile(
            path.join(runDirectory, 'completion.json'),
            JSON.stringify(receipt),
          );
          return {
            kind: 'passed',
            reason: 'Observed the expected fixture result.',
          };
        },
      },
    };
    const result = await runProjectWorkflow(f.root, options);
    assert.equal(result.outcome, 'failed');
    assert.match(result.state.reason, /QA changed protected AutoCode state/);
    assert.equal(
      (await runProjectWorkflow(f.root, { ...options, resumeOnly: true }))
        .outcome,
      'failed',
    );
    assert.equal(scenarios, 1);
  } finally {
    await f.cleanup();
  }
});

test('credential collisions preserve receipt types, raw review controls and resume', async () => {
  const secret = 'sensitive-fixture-secret-0123456789';
  const f = await fixture('review-fix', 'local', [
    'true',
    'null',
    'passed',
    'changes-requested',
    'outcome',
    'high',
    'result',
    secret,
  ]);
  try {
    const result = await runProjectWorkflow(f.root, f.options);
    assert.equal(result.outcome, 'completed');
    for (const name of await readdir(result.runDirectory)) {
      if (name.endsWith('.json'))
        JSON.parse(
          await readFile(path.join(result.runDirectory, name), 'utf8'),
        );
    }
    const verify = JSON.parse(
      await readFile(path.join(result.runDirectory, 'verify-0.json'), 'utf8'),
    );
    assert.equal(verify.evidence.passed, true);
    assert.equal(verify.evidence.checks[0].protectedStateUnchanged, true);
    const review = JSON.parse(
      await readFile(path.join(result.runDirectory, 'review-0.json'), 'utf8'),
    );
    assert.equal(review.evidence.outcome, 'changes-requested');
    assert.equal(review.evidence.findings[0].severity, 'high');
    assert.match(review.evidence.findings[0].id, /^redacted-[a-f0-9]+$/);
    assert.equal(review.evidence.findings[0].summary.includes(secret), false);
    assert.equal(review.evidence.findings[0].summary.includes('passed'), false);
    const planning = JSON.parse(
      await readFile(path.join(result.runDirectory, 'planning.json'), 'utf8'),
    );
    assert.equal(planning.evidence.plan.includes(secret), false);
    const display = await readFile(
      path.join(
        f.root,
        '.autocode',
        'runs',
        (await readdir(path.join(f.root, '.autocode', 'runs')))[0]!,
        'workflow-review-1',
        'review',
        'final.txt',
      ),
      'utf8',
    );
    assert.match(display, /<redacted>/);
    const passedReview = JSON.parse(
      await readFile(path.join(result.runDirectory, 'review-1.json'), 'utf8'),
    );
    assert.equal(passedReview.evidence.outcome, 'passed');
    const calls = await f.calls();
    assert.deepEqual(calls, [
      'planning',
      'implementation',
      'review',
      'fix',
      'review',
    ]);
    assert.equal(
      (await runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }))
        .outcome,
      'completed',
    );
    assert.deepEqual(await f.calls(), calls);
  } finally {
    await f.cleanup();
  }
});

test('QA detects ignored credential modification, deletion and additions', async (t) => {
  for (const change of ['unchanged', 'modify', 'delete', 'add', 'add-only']) {
    await t.test(change, async () => {
      const secret = 'sensitive-fixture-secret-0123456789';
      const f = await fixture(
        'success',
        'local',
        change === 'add-only' ? [] : [secret, 'passed', 'true'],
      );
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
        const options = {
          ...f.options,
          qa: {
            async run() {
              scenarios++;
              if (change === 'modify')
                await writeFile(
                  path.join(f.root, '.env'),
                  'FIXTURE_VALUE=changed-sensitive-fixture-secret',
                );
              if (change === 'delete') await rm(path.join(f.root, '.env'));
              if (change === 'add' || change === 'add-only')
                await writeFile(
                  path.join(f.root, '.env.new'),
                  'FIXTURE_VALUE=new-sensitive-fixture-secret',
                );
              return {
                kind: 'passed',
                reason: `Observed expected result with passed true ${secret}.`,
              };
            },
          },
        };
        const result = await runProjectWorkflow(f.root, options);
        assert.equal(
          result.outcome,
          change === 'unchanged' ? 'completed' : 'failed',
        );
        if (change !== 'unchanged')
          assert.match(
            result.state.reason,
            /QA changed protected credential state/,
          );
        else {
          const qa = JSON.parse(
            await readFile(path.join(result.runDirectory, 'qa.json'), 'utf8'),
          );
          assert.equal(qa.evidence.outcome, 'passed');
          assert.equal(qa.evidence.scenarios[0].reason.includes(secret), false);
          assert.equal(
            qa.evidence.scenarios[0].reason.includes('passed'),
            false,
          );
        }
        if (change === 'unchanged')
          assert.equal(
            (await runProjectWorkflow(f.root, { ...options, resumeOnly: true }))
              .outcome,
            'completed',
          );
        else
          await assert.rejects(
            () => runProjectWorkflow(f.root, { ...options, resumeOnly: true }),
            /stale/,
          );
        assert.equal(scenarios, 1);
      } finally {
        await f.cleanup();
      }
    });
  }
});

test('ignored credential changes invalidate paused QA evidence before resume', async () => {
  const f = await fixture('success', 'local', [
    'sensitive-fixture-secret-0123456789',
  ]);
  try {
    assert.equal(
      (
        await runProjectWorkflow(f.root, {
          ...f.options,
          durable: { pauseAfterPhase: 'qa' },
        })
      ).outcome,
      'paused',
    );
    await writeFile(
      path.join(f.root, '.env'),
      'FIXTURE_VALUE=changed-sensitive-fixture-secret',
    );
    await assert.rejects(
      () => runProjectWorkflow(f.root, { ...f.options, resumeOnly: true }),
      /stale after workspace changes/,
    );
    assert.deepEqual(await f.calls(), ['planning', 'implementation', 'review']);
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
