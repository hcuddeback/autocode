import { execFileSync } from 'node:child_process';

/** Repository inspection must not execute configurable helpers outside containment. */
export function gitInspectionArguments(
  root: string,
  arguments_: readonly string[],
): string[] {
  let filterKeys: string;
  try {
    // Read names only: filter commands can contain credentials. Config inspection
    // does not execute hooks, and every subsequent command gets explicit overrides.
    filterKeys = execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(clean|smudge|process|required)$',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    if ((error as { status?: number }).status !== 1)
      throw new Error('Could not inspect Git filter configuration safely', {
        cause: error,
      });
    filterKeys = '';
  }
  const overrides: string[] = [];
  for (const key of new Set(filterKeys.split('\0').filter(Boolean))) {
    if (!/^filter\.[^=\r\n\0]+\.(clean|smudge|process|required)$/.test(key))
      throw new Error('Unsupported Git filter configuration key');
    overrides.push('-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`);
  }
  return [
    '-c',
    'core.fsmonitor=false',
    ...overrides,
    ...(arguments_[0] === 'diff'
      ? ['diff', '--no-ext-diff', '--no-textconv', ...arguments_.slice(1)]
      : arguments_),
  ];
}
