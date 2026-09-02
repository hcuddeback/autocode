#!/usr/bin/env node

import path from 'node:path';
import { initializeProject } from './config.js';

async function main(args: string[]): Promise<void> {
  const [command, ...options] = args;
  if (command === '--help' || command === undefined) {
    printHelp();
    return;
  }
  if (command !== 'init') {
    throw new Error(`unknown command: ${command}`);
  }

  const target = options[0] ?? process.cwd();
  if (options.length > 1) {
    throw new Error('init accepts at most one project directory');
  }
  const projectDirectory = path.resolve(target);
  const result = await initializeProject(projectDirectory);
  console.log(
    result === 'created'
      ? `Initialized AutoCode in ${projectDirectory}`
      : `AutoCode already initialized in ${projectDirectory}`,
  );
}

function printHelp(): void {
  console.log('Usage: autocode <command> [project-directory]');
  console.log(
    '\nCommands:\n  init    Initialize project-local configuration and state',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
