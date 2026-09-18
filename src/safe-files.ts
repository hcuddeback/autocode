import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function readStableRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
): Promise<string> {
  const pathStats = await lstat(filePath);
  if (pathStats.isSymbolicLink() || !pathStats.isFile())
    throw new Error(`${label} must be a bounded regular file`);
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== pathStats.dev ||
      before.ino !== pathStats.ino ||
      before.size > maximumBytes
    )
      throw new Error(`${label} must be a bounded regular file`);
    const text = await handle.readFile('utf8');
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error(`${label} changed while being read`);
    const current = await lstat(filePath);
    const resolved = await stat(await realpath(filePath));
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      resolved.dev !== before.dev ||
      resolved.ino !== before.ino
    )
      throw new Error(`${label} changed while being read`);
    return text;
  } finally {
    await handle.close();
  }
}

export async function publishExclusiveFile(
  target: string,
  contents: string,
  assertParent: () => Promise<void>,
): Promise<boolean> {
  const directory = path.dirname(target);
  const candidate = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.candidate`,
  );
  const handle = await open(candidate, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  let created = false;
  try {
    await assertParent();
    try {
      await link(candidate, target);
      created = true;
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    await assertParent();
    await syncDirectory(directory);
    return created;
  } catch (error: unknown) {
    if (created) {
      const [candidateStats, targetStats] = await Promise.all([
        lstat(candidate),
        lstat(target),
      ]);
      if (
        candidateStats.dev !== targetStats.dev ||
        candidateStats.ino !== targetStats.ino
      )
        throw new Error(
          'exclusive publication target changed during rollback',
          {
            cause: error,
          },
        );
      await unlink(target);
      await syncDirectory(directory);
    }
    throw error;
  } finally {
    await unlink(candidate).catch((error: unknown) => {
      if (!hasCode(error, 'ENOENT')) throw error;
    });
    await syncDirectory(directory);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
