#!/usr/bin/env node

import path from 'node:path';
import { initializeProject } from './config.js';
import { selectProjectTask } from './tasks.js';
import { prepareImplementationPlan } from './planning.js';

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
      return;
    }
    if (selection.kind === 'blocked') {
      const reasons = selection.tasks.map(
        (task) =>
          `${task.taskId} (${task.dependencies
            .map((dependency) => `${dependency.taskId}: ${dependency.status}`)
            .join(', ')})`,
      );
      console.log(
        `No task is selectable; blocked dependencies: ${reasons.join('; ')}`,
      );
      return;
    }
    console.log('No ready tasks.');
    return;
  }
  if (command === 'prepare') {
    const result = await prepareImplementationPlan(projectDirectory);
    console.log(
      `${result.kind === 'created' ? 'Created' : 'Reused'} planning artifacts for ${result.metadata.taskId} at ${result.runDirectory}`,
    );
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function printHelp(): void {
  console.log('Usage: autocode <command> [project-directory]');
  console.log(
    '\nCommands:\n  init      Initialize project-local configuration and state\n  select    Select the first ready task with completed dependencies\n  prepare   Validate the selected task and create commit-bound planning artifacts',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
