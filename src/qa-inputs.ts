import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface QaInputSnapshot {
  version: 1;
  configuration: string;
  targets: string[];
  fingerprint: string;
}

/** Hash authorized QA inputs with bounded streaming, retaining no file contents. */
export async function snapshotQaInputs(
  root: string,
  configuration: string,
  targets: readonly string[],
): Promise<QaInputSnapshot> {
  try {
    if (!/^[a-f0-9]{64}$/.test(configuration) || targets.length > 32)
      throw new Error('invalid QA resource snapshot');
    let entries = 0;
    let remaining = 512 * 1024 * 1024;
    const privateState = path.resolve(root, '.autocode').toLowerCase();
    async function visit(target: string, depth: number): Promise<unknown> {
      if (++entries > 10_000 || depth > 32 || !path.isAbsolute(target))
        throw new Error('QA resources exceed snapshot limits');
      const before = await lstat(target);
      if (before.isSymbolicLink())
        throw new Error('QA resources must not be links');
      const canonical = await realpath(target);
      let contents: unknown;
      if (before.isDirectory()) {
        const names = (await readdir(target)).sort();
        if (names.length + entries > 10_000)
          throw new Error('too many QA entries');
        const children: unknown[] = [];
        for (const name of names) {
          const child = path.join(target, name);
          if (path.resolve(child).toLowerCase() === privateState) continue;
          children.push([name, await visit(child, depth + 1)]);
        }
        contents = children;
      } else if (before.isFile()) {
        if (before.size > remaining)
          throw new Error('QA resources exceed byte budget');
        remaining -= before.size;
        const handle = await open(target, 'r');
        try {
          const opened = await handle.stat();
          if (
            opened.dev !== before.dev ||
            opened.ino !== before.ino ||
            opened.size !== before.size ||
            opened.mtimeMs !== before.mtimeMs
          )
            throw new Error('QA resource changed');
          const digest = createHash('sha256');
          const buffer = Buffer.alloc(64 * 1024);
          let length = 0;
          while (true) {
            const { bytesRead } = await handle.read(
              buffer,
              0,
              buffer.length,
              null,
            );
            if (!bytesRead) break;
            length += bytesRead;
            if (length > before.size) throw new Error('QA resource grew');
            digest.update(buffer.subarray(0, bytesRead));
          }
          const after = await handle.stat();
          if (
            length !== before.size ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
          )
            throw new Error('QA resource changed');
          contents = digest.digest('hex');
        } finally {
          await handle.close();
        }
      } else throw new Error('QA resources must be files or directories');
      const after = await lstat(target);
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.isDirectory() !== before.isDirectory() ||
        after.isFile() !== before.isFile() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        (await realpath(target)) !== canonical
      )
        throw new Error('QA resource changed');
      return [
        canonical,
        before.dev,
        before.ino,
        before.isDirectory() ? 'directory' : 'file',
        contents,
      ];
    }
    const resources: unknown[] = [];
    for (const target of targets) resources.push(await visit(target, 0));
    return {
      version: 1,
      configuration,
      targets: [...targets],
      fingerprint: createHash('sha256')
        .update(JSON.stringify(resources))
        .digest('hex'),
    };
  } catch {
    throw new Error('QA inputs changed or could not be inspected safely');
  }
}

export async function refreshQaInputs(root: string, value: QaInputSnapshot) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.version !== 1 ||
    !Array.isArray(value.targets) ||
    value.targets.some(
      (target) => typeof target !== 'string' || target.includes('\0'),
    ) ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  )
    throw new Error('invalid QA input snapshot');
  return snapshotQaInputs(root, value.configuration, value.targets);
}
