#!/usr/bin/env node

import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeProject } from './config.js';

const ignoreEntry = '.autocode/';

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
  await mkdir(projectDirectory, { recursive: true });
  const result = await initializeProject(projectDirectory);
  await ensureGitignore(projectDirectory);
  console.log(
    result === 'created'
      ? `Initialized AutoCode in ${projectDirectory}`
      : `AutoCode already initialized in ${projectDirectory}`,
  );
}

async function ensureGitignore(projectDirectory: string): Promise<void> {
  const gitignorePath = path.join(projectDirectory, '.gitignore');
  try {
    await access(gitignorePath);
  } catch {
    await appendFile(gitignorePath, `${ignoreEntry}\n`, 'utf8');
    return;
  }

  const contents = await readFile(gitignorePath, 'utf8');
  if (!contents.split(/\r?\n/).includes(ignoreEntry)) {
    await appendFile(
      gitignorePath,
      `${contents.endsWith('\n') || contents.length === 0 ? '' : '\n'}${ignoreEntry}\n`,
      'utf8',
    );
  }
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
