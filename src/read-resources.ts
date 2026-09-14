import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

/** Canonical identity and bounded raw content of operator-authorized files. */
export async function snapshotReadResources(resources: readonly string[]) {
  if (resources.length > 16) throw new Error('too many read resources');
  try {
    return await Promise.all(
      resources.map(async (resource) => {
        if (!path.isAbsolute(resource) || resource.includes('\0'))
          throw new Error('invalid resource');
        const canonical = await realpath(resource);
        const before = await lstat(resource);
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          before.size > MAX_BYTES
        )
          throw new Error('invalid resource');
        const handle = await open(resource, 'r');
        let digest: string;
        try {
          const opened = await handle.stat();
          if (
            opened.dev !== before.dev ||
            opened.ino !== before.ino ||
            opened.size !== before.size ||
            opened.mtimeMs !== before.mtimeMs ||
            opened.ctimeMs !== before.ctimeMs
          )
            throw new Error('changed resource');
          const buffer = Buffer.alloc(MAX_BYTES + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await handle.read(
              buffer,
              length,
              buffer.length - length,
              null,
            );
            if (bytesRead === 0) break;
            length += bytesRead;
          }
          const after = await handle.stat();
          if (
            length > MAX_BYTES ||
            length !== opened.size ||
            after.size !== opened.size ||
            after.mtimeMs !== opened.mtimeMs ||
            after.ctimeMs !== opened.ctimeMs
          )
            throw new Error('changed resource');
          digest = createHash('sha256')
            .update(buffer.subarray(0, length))
            .digest('hex');
        } finally {
          await handle.close();
        }
        const after = await lstat(resource);
        if (
          after.dev !== before.dev ||
          after.ino !== before.ino ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          (await realpath(resource)) !== canonical
        )
          throw new Error('changed resource');
        return { canonical, dev: before.dev, ino: before.ino, sha256: digest };
      }),
    );
  } catch {
    throw new Error('read resources changed or could not be inspected safely');
  }
}
