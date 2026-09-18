#!/usr/bin/env node

import path from 'node:path';
import { initializeProject } from './config.js';
import { selectProjectTask } from './tasks.js';
import { prepareImplementationPlan } from './planning.js';
import { runRoleSeparatedCodexSessions } from './codex.js';
import { runDeterministicVerification } from './verification.js';
import { runProjectWorkflow } from './workflow.js';

async function main(args: string[]): Promise<void> {
  const [command, ...options] = args;
  if (command === '--help' || command === undefined) {
    printHelp();
    return;
  }
  const target = options[0] ?? process.cwd();
  if (options.length > 1) {
    throw new Error(`${command} accepts at most one project directory`);
  }
  const projectDirectory = path.resolve(target);
  if (command === 'run' || command === 'resume') {
    const result = await runProjectWorkflow(projectDirectory, {
      resumeOnly: command === 'resume',
    });
    console.log(
      `Workflow ${result.outcome}: ${result.state.reason}; evidence at ${result.runDirectory}`,
    );
    if (result.outcome === 'failed' || result.outcome === 'blocked')
      process.exitCode = 1;
    return;
  }
  if (command === 'init') {
    const result = await initializeProject(projectDirectory);
    console.log(
      result === 'created'
        ? `Initialized AutoCode in ${projectDirectory}`
        : `AutoCode already initialized in ${projectDirectory}`,
    );
    return;
  }
  if (command === 'select') {
    const selection = await selectProjectTask(projectDirectory);
    if (selection.kind === 'selected') {
      console.log(`${selection.task.taskId}: ${selection.task.title}`);
      return;
    }
    if (selection.kind === 'active') {
      const activeTasks = selection.tasks
        .map((task) => `${task.taskId}: ${task.status}`)
        .join(', ');
      console.log(
        `No task is selectable; active work must complete first: ${activeTasks}`,
      );
      process.exitCode = 1;
      return;
    }
    if (selection.kind === 'blocked') {
      const reasons = selection.tasks.map((task) => {
        const reason =
          task.reason ??
          task.dependencies
            .map((dependency) => `${dependency.taskId}: ${dependency.status}`)
            .join(', ');
        return `${task.taskId} (${reason})`;
      });
      console.log(
        `No task is selectable; blocked dependencies: ${reasons.join('; ')}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('No ready tasks.');
    process.exitCode = 1;
    return;
  }
  if (command === 'prepare') {
    const result = await prepareImplementationPlan(projectDirectory);
    console.log(
      `${result.kind === 'created' ? 'Created' : 'Reused'} planning artifacts for ${result.metadata.taskId} at ${result.runDirectory}`,
    );
    return;
  }
  if (command === 'sessions') {
    const result = await runRoleSeparatedCodexSessions(projectDirectory);
    console.log(
      `Completed implementation session ${result.implementation.sessionId} and review session ${result.review.sessionId}`,
    );
    return;
  }
  if (command === 'verify') {
    const result = await runDeterministicVerification(projectDirectory);
    console.log(
      `Passed ${result.checks.length} deterministic checks; evidence retained at ${result.runDirectory}`,
    );
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function printHelp(): void {
  console.log('Usage: autocode <command> [project-directory]');
  console.log(
    '\nCommands:\n  init      Initialize project-local configuration and state\n  select    Validate the canonical workbook and report its next eligible task\n  prepare   Validate the selected task and create commit-bound planning artifacts\n  sessions  Run separate Codex implementation and critical-review sessions\n  verify    Run configured deterministic checks and retain evidence\n  run       Own and run one canonical task through the durable local workflow\n  resume    Reconcile and resume the owned workflow without repeating effects',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
