import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export const CONFIG_FILE = '.autocode/config.yaml';
export const STATE_DIRECTORY = '.autocode';

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

  return defaultConfig;
}

export async function initializeProject(
  projectDirectory: string,
): Promise<'created' | 'existing'> {
  const stateDirectory = path.join(projectDirectory, STATE_DIRECTORY);
  const configPath = path.join(projectDirectory, CONFIG_FILE);

  await mkdir(path.join(stateDirectory, 'runs'), { recursive: true });
  await mkdir(path.join(stateDirectory, 'evidence'), { recursive: true });

  try {
    const existing = await readFile(configPath, 'utf8');
    validateConfig(parse(existing));
    return 'existing';
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      await writeFile(configPath, stringify(defaultConfig), {
        encoding: 'utf8',
        flag: 'wx',
      });
      return 'created';
    }
    throw new Error(
      `existing configuration is invalid: ${errorMessage(error)}`,
    );
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown configuration error';
}
