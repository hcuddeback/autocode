import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export const CONFIG_FILE = '.autocode/config.yaml';
export const STATE_DIRECTORY = '.autocode';
const IGNORE_ENTRY = '.autocode/';
const MAX_CONFIG_BYTES = 64 * 1024;
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
  const gitignorePath = path.join(projectDirectory, '.gitignore');

  const projectStats = await stat(projectDirectory);
  if (!projectStats.isDirectory()) {
    throw new Error(`project path is not a directory: ${projectDirectory}`);
  }
  await rejectSymbolicLink(stateDirectory, 'state directory');
  await rejectSymbolicLink(configPath, 'configuration file');
  await rejectSymbolicLink(gitignorePath, '.gitignore');

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

  await mkdir(path.join(stateDirectory, 'runs'), { recursive: true });
  await ensureGitignore(gitignorePath);
  return result;
}

async function ensureGitignore(gitignorePath: string): Promise<void> {
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
        await ensureGitignore(gitignorePath);
      }
      return;
    }
    throw error;
  }

  if (!contents.split(/\r?\n/).includes(IGNORE_ENTRY)) {
    const separator =
      contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
    await appendFile(gitignorePath, `${separator}${IGNORE_ENTRY}\n`, 'utf8');
  }
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
