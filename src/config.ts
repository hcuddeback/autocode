import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export const CONFIG_FILE = '.autocode/config.yaml';
export const STATE_DIRECTORY = '.autocode';
const IGNORE_ENTRY = '.autocode/';
const MAX_CONFIG_BYTES = 64 * 1024;
const GITIGNORE_LOCK = '.autocode/init.lock';
const LOCK_OWNER_FILE = 'owner.json';
const LOCK_RETRY_COUNT = 240;
const LOCK_RETRY_DELAY_MS = 25;
const FOREIGN_LOCK_LEASE_MS = 60_000;
const OWNERLESS_LOCK_STALE_MS = 5_000;
const IGNORE_PROBES = [CONFIG_FILE, '.autocode/runs/evidence.txt'];
const CONFIG_KEYS = new Set(['version', 'stateDirectory', 'telemetry']);

export interface AutoCodeConfig {
  version: 1;
  stateDirectory: '.autocode';
  telemetry: false;
}

const defaultConfig: AutoCodeConfig = {
  version: 1,
  stateDirectory: STATE_DIRECTORY,
  telemetry: false,
};

export function validateConfig(value: unknown): AutoCodeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('configuration must be a mapping');
  }

  const config = value as Record<string, unknown>;
  if (config.version !== 1) {
    throw new Error('configuration version must be 1');
  }
  if (config.stateDirectory !== STATE_DIRECTORY) {
    throw new Error(`stateDirectory must be ${STATE_DIRECTORY}`);
  }
  if (config.telemetry !== false) {
    throw new Error('telemetry must be false');
  }
  const unexpectedKeys = Object.keys(config).filter(
    (key) => !CONFIG_KEYS.has(key),
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(`unknown configuration key: ${unexpectedKeys[0]}`);
  }

  return { ...defaultConfig };
}

export async function initializeProject(
  projectDirectory: string,
): Promise<'created' | 'existing'> {
  const stateDirectory = path.join(projectDirectory, STATE_DIRECTORY);
  const configPath = path.join(projectDirectory, CONFIG_FILE);
  const runsDirectory = path.join(stateDirectory, 'runs');
  const gitignorePath = path.join(projectDirectory, '.gitignore');

  const projectStats = await stat(projectDirectory);
  if (!projectStats.isDirectory()) {
    throw new Error(`project path is not a directory: ${projectDirectory}`);
  }
  await rejectSymbolicLink(stateDirectory, 'state directory');
  await rejectSymbolicLink(configPath, 'configuration file');
  await rejectSymbolicLink(runsDirectory, 'runs directory');
  await rejectSymbolicLink(gitignorePath, '.gitignore');
  await rejectTrackedState(projectDirectory);

  let result: 'created' | 'existing';
  try {
    const configStats = await stat(configPath);
    if (configStats.size > MAX_CONFIG_BYTES) {
      throw new Error(`configuration exceeds ${MAX_CONFIG_BYTES} bytes`);
    }
    const existing = await readFile(configPath, 'utf8');
    validateConfig(parse(existing));
    result = 'existing';
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      await mkdir(stateDirectory, { recursive: true });
      try {
        await writeFile(configPath, stringify(defaultConfig), {
          encoding: 'utf8',
          flag: 'wx',
        });
        result = 'created';
      } catch (writeError: unknown) {
        if (!isAlreadyExists(writeError)) {
          throw writeError;
        }
        validateConfig(parse(await readFile(configPath, 'utf8')));
        result = 'existing';
      }
    } else {
      throw new Error(
        `existing configuration is invalid: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  await mkdir(runsDirectory, { recursive: true });
  await withInitializationLock(stateDirectory, () =>
    ensureGitignore(projectDirectory, gitignorePath),
  );
  return result;
}

async function rejectTrackedState(projectDirectory: string): Promise<void> {
  const tracked = await gitOutput(projectDirectory, [
    'ls-files',
    '--',
    STATE_DIRECTORY,
  ]);
  if (tracked.trim().length > 0) {
    throw new Error(
      '.autocode contains files tracked by Git; remove them from the index before initialization (for example: git rm --cached -r -- .autocode)',
    );
  }
}

async function gitOutput(
  projectDirectory: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: projectDirectory,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        if (
          typeof error.code === 'number' &&
          error.code === 128 &&
          stderr.includes('not a git repository')
        ) {
          resolve('');
          return;
        }
        reject(error);
      },
    );
  });
}

async function withInitializationLock<T>(
  stateDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(stateDirectory, path.basename(GITIGNORE_LOCK));
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      await mkdir(lockPath);
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      await reclaimStaleLock(lockPath, stateDirectory);
      await delay(LOCK_RETRY_DELAY_MS);
      continue;
    }
    try {
      await writeFile(
        path.join(lockPath, LOCK_OWNER_FILE),
        JSON.stringify({
          createdAt: Date.now(),
          hostname: os.hostname(),
          pid: process.pid,
        }),
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (error: unknown) {
      await rm(lockPath, { recursive: true, force: true });
      throw error;
    }
    try {
      return await operation();
    } finally {
      await unlink(path.join(lockPath, LOCK_OWNER_FILE));
      await rmdir(lockPath);
    }
  }
  throw new Error(`timed out waiting for initialization lock: ${lockPath}`);
}

async function reclaimStaleLock(
  lockPath: string,
  stateDirectory: string,
): Promise<void> {
  if (!(await isLockStale(lockPath))) {
    return;
  }

  const stalePath = path.join(
    stateDirectory,
    `init.lock.stale-${process.pid}-${Date.now()}`,
  );
  try {
    await rename(lockPath, stalePath);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return;
    }
    throw error;
  }
  await rm(stalePath, { recursive: true, force: true });
}

async function isLockStale(lockPath: string): Promise<boolean> {
  const ownerPath = path.join(lockPath, LOCK_OWNER_FILE);
  try {
    const rawOwner = await readFile(ownerPath, 'utf8');
    const owner = JSON.parse(rawOwner) as {
      createdAt?: unknown;
      hostname?: unknown;
      pid?: unknown;
    };
    const hasValidPid =
      typeof owner.pid === 'number' &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0;
    if (owner.hostname === os.hostname() && hasValidPid) {
      return !isProcessAlive(owner.pid as number);
    }
    if (
      typeof owner.createdAt === 'number' &&
      Number.isFinite(owner.createdAt) &&
      Date.now() - owner.createdAt >= FOREIGN_LOCK_LEASE_MS
    ) {
      return true;
    }
    return isOlderThan(ownerPath, FOREIGN_LOCK_LEASE_MS);
  } catch (error: unknown) {
    if (!isFileNotFound(error) && !(error instanceof SyntaxError)) {
      throw error;
    }
    try {
      return await isOlderThan(lockPath, OWNERLESS_LOCK_STALE_MS);
    } catch (statError: unknown) {
      if (isFileNotFound(statError)) {
        return false;
      }
      throw statError;
    }
  }
}

async function isOlderThan(targetPath: string, ageMilliseconds: number) {
  const targetStats = await stat(targetPath);
  return Date.now() - targetStats.mtimeMs >= ageMilliseconds;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasErrorCode(error, 'ESRCH');
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureGitignore(
  projectDirectory: string,
  gitignorePath: string,
): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(gitignorePath, 'utf8');
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      try {
        await writeFile(gitignorePath, `${IGNORE_ENTRY}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (writeError: unknown) {
        if (!isAlreadyExists(writeError)) {
          throw writeError;
        }
        await ensureGitignore(projectDirectory, gitignorePath);
      }
      return;
    }
    throw error;
  }

  const hasRule = contents.split(/\r?\n/).includes(IGNORE_ENTRY);
  const isIgnored = hasRule
    ? await isStateEffectivelyIgnored(projectDirectory)
    : false;
  if (hasRule && isIgnored !== false) {
    return;
  }
  if (!hasRule || !isIgnored) {
    const separator =
      contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
    await appendFile(gitignorePath, `${separator}${IGNORE_ENTRY}\n`, 'utf8');
  }
}

async function isStateEffectivelyIgnored(
  projectDirectory: string,
): Promise<boolean | undefined> {
  const results = await Promise.all(
    IGNORE_PROBES.map((probe) =>
      isPathEffectivelyIgnored(projectDirectory, probe),
    ),
  );
  return results.includes(undefined)
    ? undefined
    : results.every((result) => result);
}

async function isPathEffectivelyIgnored(
  projectDirectory: string,
  targetPath: string,
): Promise<boolean | undefined> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['check-ignore', '--quiet', '--no-index', '--', targetPath],
      { cwd: projectDirectory, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve(true);
          return;
        }
        if (error.code === 1) {
          resolve(false);
          return;
        }
        if (error.code === 128 && stderr.includes('not a git repository')) {
          resolve(undefined);
          return;
        }
        reject(error);
      },
    );
  });
}

async function rejectSymbolicLink(
  targetPath: string,
  description: string,
): Promise<void> {
  try {
    if ((await lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`${description} must not be a symbolic link`);
    }
  } catch (error: unknown) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

function isFileNotFound(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return hasErrorCode(error, 'EEXIST');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown configuration error';
}
