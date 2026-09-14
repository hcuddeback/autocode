import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitInspectionArguments } from './git-inspection.js';
import path from 'node:path';
import os from 'node:os';
import {
  mkdtemp,
  writeFile,
  unlink,
  rmdir,
  stat,
  realpath,
  readFile,
  opendir,
  lstat,
  open,
} from 'node:fs/promises';
import { discoverWorkspaceCredentials } from './codex.js';
import {
  isCredentialPath,
  isCredentialDirectoryName,
} from './credential-paths.js';
import { WINDOWS_SANDBOX } from './windows-sandbox.js';
import { randomUUID } from 'node:crypto';
import { resolveExecutable, runProcess } from './verification.js';
import type { QaCallbacks } from './qa.js';

export interface QaProcessOptions {
  command: string;
  arguments: readonly string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Additional directories explicitly authorized by the trusted operator. */
  sandboxWriteDirectories?: readonly string[];
  /** Read resources explicitly authorized by the trusted operator. */
  sandboxReadResources?: readonly string[];
  /** Exact mutable files inside authorized writable roots. */
  sandboxWriteFiles?: readonly string[];
}

const adapters = new WeakMap<
  QaCallbacks,
  { root: string; options: QaProcessOptions }
>();

/** Only fixed host callbacks invoking a contained process are accepted by the workflow. */
export function createContainedQaAdapter(
  root: string,
  options: QaProcessOptions,
): QaCallbacks {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.command) ||
    !Array.isArray(options.arguments) ||
    options.arguments.length > 128 ||
    options.arguments.some(
      (argument) =>
        typeof argument !== 'string' ||
        argument.includes('\0') ||
        Buffer.byteLength(argument) > 64 * 1024,
    )
  )
    throw new Error('invalid contained QA command');
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30 * 60_000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 16 * 1024 * 1024
  )
    throw new Error('invalid contained QA process limits');
  const cwd = path.resolve(root);
  const command = options.command;
  const arguments_ = [...options.arguments];
  const sandboxWriteDirectories = [...(options.sandboxWriteDirectories ?? [])];
  const sandboxReadResources = [...(options.sandboxReadResources ?? [])];
  const sandboxWriteFiles = [...(options.sandboxWriteFiles ?? [])];
  const adapter: QaCallbacks = Object.freeze<QaCallbacks>({
    async run(scenario, context) {
      assertSecureProcessPlatform();
      const executable = await resolveExecutable(command, cwd);
      const argumentsWithContext = [
        ...arguments_,
        JSON.stringify({ scenario, context }),
      ];
      const result = await runContainedProcess(
        executable,
        argumentsWithContext,
        cwd,
        timeoutMs,
        maxOutputBytes,
        undefined,
        sandboxWriteDirectories,
        sandboxReadResources,
        sandboxWriteFiles,
      );
      if (result.exitCode !== 0 || result.timedOut || result.overflowed)
        throw new Error('contained QA process failed');
      return JSON.parse(result.stdout);
    },
  });
  adapters.set(adapter, {
    root: cwd,
    options: {
      command,
      arguments: arguments_,
      timeoutMs,
      maxOutputBytes,
      sandboxWriteDirectories,
      sandboxReadResources,
      sandboxWriteFiles,
    },
  });
  return adapter;
}

/** Shared process boundary for untrusted QA and Codex roles. */
export function assertSecureProcessPlatform(): void {
  if (process.platform !== 'win32')
    throw new Error(
      'secure process containment is currently unavailable on this platform; Linux user-manager isolation and macOS acceptance remain required',
    );
}

export async function runContainedProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
  input?: string,
  sandboxWriteDirectories: readonly string[] = [],
  sandboxReadResources: readonly string[] = [],
  sandboxWriteFiles: readonly string[] = [],
) {
  assertSecureProcessPlatform();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeout must be a positive integer');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0)
    throw new Error('output limit must be a positive integer');
  const batch = /\.(?:cmd|bat)$/i.test(executable);
  if (batch && arguments_.some((argument) => /[\0\r\n]/.test(argument)))
    throw new Error('batch arguments cannot contain NUL or line breaks');
  const verbatimTail = batch
    ? `/d /s /v:off /c "${escapeCmd(path.relative(cwd, executable))} ${arguments_.map(escapeBatchArgument).join(' ')}"`
    : undefined;
  const job = await windowsJobScript(
    batch ? await resolveExecutable('cmd', cwd) : executable,
    arguments_,
    cwd,
    maxOutputBytes,
    input,
    verbatimTail,
    sandboxWriteDirectories,
    batch ? executable : undefined,
    sandboxReadResources,
    sandboxWriteFiles,
  );
  try {
    const result = await runProcess(
      await resolveExecutable('powershell', cwd),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        job.script,
      ],
      cwd,
      timeoutMs,
      maxOutputBytes,
      undefined,
      { windowsJob: true },
    );
    if (result.exitCode === -2 || result.exitCode === 4294967294)
      return {
        ...result,
        exitCode: -1,
        overflowed: true,
        stdout: '[output omitted: exceeded configured limit]\n',
        stderr: '[output omitted: exceeded configured limit]\n',
      };
    return result;
  } finally {
    await cleanupWindowsJob(job, cwd);
    for (const file of [
      job.script,
      job.cleaned,
      ...['stdin', 'stdout', 'stderr', 'acl-targets', 'acl-boundaries'].map(
        (name) => path.join(job.directory, name),
      ),
    ])
      await unlink(file).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    await rmdir(job.directory);
  }
}

async function cleanupWindowsJob(
  job: { script: string; cleaned: string },
  cwd: string,
): Promise<void> {
  try {
    await stat(job.cleaned);
  } catch {
    const cleanup = await runProcess(
      await resolveExecutable('powershell', cwd),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        job.script,
        '-Cleanup',
      ],
      cwd,
      30000,
      100000,
      undefined,
      { windowsJob: false },
    );
    if (cleanup.exitCode !== 0)
      throw new Error('Windows sandbox cleanup failed');
  }
}

// Native argv quoting followed by cmd metacharacter escaping. Package-manager
// batch shims parse their forwarded arguments an additional time.
// See https://github.com/moxystudio/node-cross-spawn/blob/master/lib/parse.js.
function escapeCmd(value: string): string {
  return value.replace(/([()\][%!^"`<>&|;, *?])/g, '^$1');
}

function escapeBatchArgument(value: string): string {
  let quoted = '"';
  let slashes = 0;
  for (const character of value) {
    if (character === '\\') {
      slashes++;
      continue;
    }
    quoted +=
      '\\'.repeat(character === '"' ? slashes * 2 + 1 : slashes) + character;
    slashes = 0;
  }
  quoted += '\\'.repeat(slashes * 2) + '"';
  return escapeCmd(escapeCmd(quoted));
}

export function assertContainedQaAdapter(
  root: string,
  adapter: QaCallbacks,
): void {
  if (adapters.get(adapter)?.root !== path.resolve(root))
    throw new Error(
      'workflow QA requires a contained process adapter; in-process callbacks are unsafe',
    );
}

/** Validate fixed QA resources without launching the adapter or changing ACLs. */
export async function preflightContainedQaAdapter(
  root: string,
  adapter: QaCallbacks,
): Promise<void> {
  assertContainedQaAdapter(root, adapter);
  const registered = adapters.get(adapter)!;
  const options = registered.options;
  await preflightContainedProcess(
    await resolveExecutable(options.command, registered.root),
    options.arguments,
    registered.root,
    options.maxOutputBytes!,
    options.sandboxWriteDirectories,
    options.sandboxReadResources,
    options.sandboxWriteFiles,
  );
}

/** Inspect a fixed process launch without creating any external process effect. */
export async function preflightContainedProcess(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  maxOutputBytes: number,
  sandboxWriteDirectories: readonly string[] = [],
  sandboxReadResources: readonly string[] = [],
  sandboxWriteFiles: readonly string[] = [],
): Promise<void> {
  assertSecureProcessPlatform();
  if (!path.isAbsolute(executable) || !(await lstat(executable)).isFile())
    throw new Error('contained executable must be an absolute regular file');
  const batch = /\.(?:cmd|bat)$/i.test(executable);
  if (
    arguments_.some(
      (argument) =>
        argument.includes('\0') || (batch && /[\r\n]/.test(argument)),
    )
  )
    throw new Error('invalid contained process arguments');
  await resolveExecutable('powershell', cwd);
  for (const resource of sandboxReadResources) {
    if (!path.isAbsolute(resource))
      throw new Error('sandbox read resources must be absolute');
    if ((await stat(resource)).isDirectory()) {
      const directory = await opendir(resource);
      await directory.close();
    } else {
      const file = await open(resource, 'r');
      await file.close();
    }
  }
  const job = await windowsJobScript(
    batch ? await resolveExecutable('cmd', cwd) : executable,
    [...arguments_],
    cwd,
    maxOutputBytes,
    undefined,
    undefined,
    sandboxWriteDirectories,
    batch ? executable : undefined,
    sandboxReadResources,
    sandboxWriteFiles,
  );
  try {
    await unlink(job.script);
  } finally {
    await rmdir(job.directory);
  }
}

async function windowsJobScript(
  command: string,
  arguments_: string[],
  cwd: string,
  maxOutputBytes: number,
  input?: string,
  verbatimTail?: string,
  sandboxWriteDirectories: readonly string[] = [],
  batchExecutable?: string,
  sandboxReadResources: readonly string[] = [],
  sandboxWriteFiles: readonly string[] = [],
): Promise<{ script: string; directory: string; cleaned: string }> {
  const writeDirectories = await Promise.all(
    sandboxWriteDirectories.map(async (directory) => {
      if (!path.isAbsolute(directory) || !(await stat(directory)).isDirectory())
        throw new Error(
          'sandbox write resources must be existing absolute directories',
        );
      return realpath(directory);
    }),
  );
  if (sandboxWriteDirectories.length > 16 || sandboxReadResources.length > 16)
    throw new Error('too many sandbox resources');
  const readFiles: string[] = await Promise.all(
    sandboxReadResources.map(async (resource) => {
      if (!path.isAbsolute(resource))
        throw new Error('sandbox read resources must be absolute');
      return realpath(resource);
    }),
  );
  // Reject resources containing the helper root before recursively inspecting
  // them. In particular, the system temp directory is never a valid worktree.
  const helperRoot = await realpath(os.tmpdir());
  for (const writable of [await realpath(cwd), ...writeDirectories]) {
    const relative = path.relative(writable, helperRoot);
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    )
      throw new Error('sandbox helper must be outside every writable resource');
  }
  const writableRoots = [
    ...new Map(
      [await realpath(cwd), ...writeDirectories].map((root) => [
        root.toLowerCase(),
        root,
      ]),
    ).values(),
  ];
  // Only exact regular-file grants can expose ignored repository data. A broad
  // workspace or dependency directory grant does not classify its files as safe.
  const safeIgnoredFiles = new Set<string>();
  for (const resource of sandboxReadResources) {
    const info = await lstat(resource);
    if (info.isSymbolicLink())
      throw new Error('sandbox read resources must not be links');
    if (info.isFile())
      safeIgnoredFiles.add((await realpath(resource)).toLowerCase());
  }
  for (const executable of [
    command,
    process.execPath,
    ...(batchExecutable ? [batchExecutable] : []),
  ])
    safeIgnoredFiles.add((await realpath(executable)).toLowerCase());
  const blocked = new Set<string>();
  const protectedPaths = new Set<string>();
  const seenDirectories = new Set<string>();
  const repositories = new Set<string>();
  const gitMetadataRoots = new Set<string>();
  const authorizedReadRoots = [...writableRoots];
  for (const resource of readFiles)
    if ((await stat(resource)).isDirectory())
      authorizedReadRoots.push(resource);
  let visited = 0;
  let genericVisited = 0;
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    );
  };
  async function inspectGit(root: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await promisify(execFile)(
        'git',
        gitInspectionArguments(root, args),
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 10000,
          windowsHide: true,
        },
      );
      return stdout;
    } catch {
      // Git errors can include private configuration values; retain no raw output.
      throw new Error('Could not inspect sandbox Git metadata safely');
    }
  }
  if (sandboxWriteFiles.length > 16)
    throw new Error('too many mutable file resources');
  const safeMutableFiles = new Set<string>();
  for (const resource of sandboxWriteFiles) {
    if (!path.isAbsolute(resource) || resource.includes('\0'))
      throw new Error('mutable file resources must be absolute');
    let target = path.resolve(resource);
    if (!writableRoots.some((root) => within(root, target)))
      throw new Error(
        'mutable file resources require an authorized writable root',
      );
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('mutable resources must be regular files');
      target = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        // eslint-disable-next-line preserve-caught-error -- never retain raw resource paths
        throw new Error('could not inspect mutable file resource safely');
    }
    if (!writableRoots.some((root) => within(root, target)))
      throw new Error('mutable file resources must stay inside writable roots');
    if (safeIgnoredFiles.has(target.toLowerCase()))
      throw new Error('mutable file resource conflicts with a read grant');
    safeMutableFiles.add(target.toLowerCase());
  }
  const configIncludes = new Set<string>();
  const configFileReferences = new Map<
    string,
    { file: string; value: string }
  >();
  const inspectedConfigs = new Map<string, boolean>();
  function privateFileReference(file: string, value: string): void {
    if (!value) return;
    configFileReferences.set(JSON.stringify([file, value]), { file, value });
    if (configFileReferences.size > 1000)
      throw new Error('Git private file references exceed their entry limit');
  }
  async function credentialGitConfig(file: string): Promise<boolean> {
    const cached = inspectedConfigs.get(file.toLowerCase());
    if (cached !== undefined) return cached;
    const config = await inspectGit(cwd, [
      'config',
      '--file',
      file,
      '--null',
      '--no-includes',
      '--list',
    ]);
    let credential = false;
    for (const entry of config.split('\0').filter(Boolean)) {
      const separator = entry.indexOf('\n');
      // Git permits valueless boolean keys; --null lists those without a value.
      const key = (
        separator < 0 ? entry : entry.slice(0, separator)
      ).toLowerCase();
      const value = separator < 0 ? '' : entry.slice(separator + 1);
      if (
        /(?:^|\.)(?:sslkey|sslcert|cookiefile)$/.test(key) ||
        /^credential(?:\..*)?\.(?:file|path)$/.test(key) ||
        key === 'core.askpass' ||
        key === 'user.signingkey'
      ) {
        const quoted =
          key === 'core.askpass'
            ? value.match(/^(?:"([^"]+)"|'([^']+)')$/)
            : null;
        privateFileReference(file, quoted ? (quoted[1] ?? quoted[2]!) : value);
      }
      if (key === 'core.sshcommand') {
        // Inspect literal arguments only; never execute or expand the command.
        let quote: string | undefined;
        for (const character of value) {
          if (character === '"' || character === "'") {
            if (!quote) quote = character;
            else if (quote === character) quote = undefined;
          } else if (!/[A-Za-z0-9_./:=@+\- \t]/.test(character))
            throw new Error(
              'SSH escaping, expansion and nonliteral arguments are unsupported',
            );
        }
        if (quote)
          throw new Error('SSH unbalanced literal arguments are unsupported');
        const arguments_ = (
          value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
        ).map((argument) =>
          argument.replace(
            /"([^"]*)"|'([^']*)'/g,
            (_match, double: string | undefined, single: string | undefined) =>
              double ?? single ?? '',
          ),
        );
        for (let index = 0; index < arguments_.length; index++) {
          const argument = arguments_[index]!;
          if (argument.startsWith('-F'))
            throw new Error(
              'SSH configuration indirection requires unsupported private-resource discovery',
            );
          if (argument === '-i')
            privateFileReference(file, arguments_[++index] ?? '');
          else if (argument.startsWith('-i'))
            privateFileReference(file, argument.slice(2));
          else if (argument.startsWith('-o')) {
            const option =
              argument === '-o'
                ? (arguments_[++index] ?? '')
                : argument.slice(2);
            const identity = option.match(/^identityfile(?:\s*=\s*|\s+)(.+)$/i);
            if (identity) privateFileReference(file, identity[1]!);
          }
        }
      }
      if (/^credential(?:\..*)?\.helper$/.test(key)) {
        const store = value.match(
          /^(?:!\s*)?(?:git\s+credential-)?store\s+--file(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/,
        );
        if (store)
          privateFileReference(file, store[1] ?? store[2] ?? store[3]!);
      }
      if (
        (key === 'include.path' || /^includeif\..*\.path$/.test(key)) &&
        value
      ) {
        if (/^~[^\\/]/.test(value))
          throw new Error('Unsupported Git configuration include path');
        configIncludes.add(
          /^[~][\\/]/.test(value)
            ? path.resolve(os.homedir(), value.slice(2))
            : path.resolve(path.dirname(file), value),
        );
        if (configIncludes.size > 1000)
          throw new Error(
            'Git configuration includes exceed their entry limit',
          );
      }
      if (
        /^(?:credential|include|includeif)\./.test(key) ||
        /(?:^|\.)(?:extraheader|cookiefile|password|passwd|token|secret|authorization|sslkey|sslcert)$/.test(
          key,
        ) ||
        /^filter\..*\.(?:clean|smudge|process)$/.test(key) ||
        ['core.sshcommand', 'core.askpass', 'user.signingkey'].includes(key) ||
        /[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(key + '\n' + value)
      )
        credential = true;
    }
    inspectedConfigs.set(file.toLowerCase(), credential);
    return credential;
  }
  async function moduleConfig(directory: string): Promise<boolean> {
    try {
      const head = await lstat(path.join(directory, 'HEAD'));
      return head.isFile() && !head.isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }
  async function registeredWorktree(
    directory: string,
    common: string,
  ): Promise<boolean> {
    try {
      const gitDirectory = await realpath(
        (
          await inspectGit(directory, ['rev-parse', '--absolute-git-dir'])
        ).trim(),
      );
      const registrationRoot = await realpath(path.join(common, 'worktrees'));
      const backPointer = path.join(gitDirectory, 'gitdir');
      const info = await lstat(backPointer);
      return (
        within(registrationRoot, gitDirectory) &&
        gitDirectory !== registrationRoot &&
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.size <= 64 * 1024 &&
        (
          await realpath((await readFile(backPointer, 'utf8')).trim())
        ).toLowerCase() ===
          (await realpath(path.join(directory, '.git'))).toLowerCase()
      );
    } catch {
      return false;
    }
  }
  async function directoryScope(directory: string): Promise<void> {
    const original = directory;
    const components = directory
      .split(path.sep)
      .map((name) => name.toLowerCase());
    if (components.includes('.git'))
      throw new Error(
        'sandbox writable roots must not overlap protected metadata',
      );
    if (
      components.some(
        (name, index) =>
          name === '.autocode' && components[index + 1] !== 'worktrees',
      )
    )
      throw new Error(
        'sandbox writable roots must not overlap protected metadata',
      );
    if (components.some(isCredentialDirectoryName))
      blocked.add(await realpath(original));
    while (true) {
      const name = path.basename(directory).toLowerCase();
      if (name === '.git' || name === '.autocode')
        throw new Error(
          'sandbox writable roots must not overlap protected metadata',
        );
      if (isCredentialDirectoryName(name))
        blocked.add(await realpath(original));
      try {
        const marker = await lstat(path.join(directory, '.git'));
        if (components.includes('.autocode')) {
          const common = await realpath(
            path.resolve(
              directory,
              (
                await inspectGit(directory, ['rev-parse', '--git-common-dir'])
              ).trim(),
            ),
          );
          if (
            !marker.isFile() ||
            within(directory, common) ||
            !(await registeredWorktree(directory, common))
          )
            throw new Error(
              'sandbox writable roots must not overlap protected metadata',
            );
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  for (const root of [cwd, ...sandboxWriteDirectories, ...writableRoots])
    await directoryScope(path.resolve(root));
  async function discover(
    directory: string,
    base: string,
    inRepository = false,
    metadata = false,
    privateMetadata = false,
    gitMetadata = false,
  ): Promise<void> {
    const key =
      directory.toLowerCase() +
      (privateMetadata
        ? '|private'
        : gitMetadata
          ? '|git-metadata'
          : metadata
            ? '|metadata'
            : inRepository
              ? '|repository'
              : '|generic');
    if (seenDirectories.has(key)) return;
    seenDirectories.add(key);
    // Durable transcripts and evidence are host-private. Phase inputs are
    // supplied by the trusted driver, not read from earlier run artifacts.
    if (metadata && !gitMetadata) blocked.add(await realpath(directory));
    let dotGit;
    try {
      dotGit = await lstat(path.join(directory, '.git'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dotGit) {
      if (dotGit.isSymbolicLink())
        throw new Error('protected metadata must not contain links');
      inRepository = true;
      if (!repositories.has(directory.toLowerCase())) {
        repositories.add(directory.toLowerCase());
        for (const relative of (
          await discoverWorkspaceCredentials(directory)
        ).files.keys())
          blocked.add(await realpath(path.resolve(directory, relative)));
        const ignored = await inspectGit(directory, [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
        ]);
        for (const relative of ignored.split('\0').filter(Boolean)) {
          if (++visited > 100000)
            throw new Error(
              'sandbox resource discovery exceeds its entry limit',
            );
          const target = path.resolve(directory, relative);
          if (!within(directory, target))
            throw new Error(
              'ignored resource must remain inside its repository',
            );
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink())
            throw new Error('ignored resources must be regular files');
          const canonical = await realpath(target);
          if (
            !safeIgnoredFiles.has(canonical.toLowerCase()) &&
            !safeMutableFiles.has(canonical.toLowerCase())
          )
            blocked.add(canonical);
        }
        const stdout = await inspectGit(directory, [
          'rev-parse',
          '--git-common-dir',
        ]);
        const common = await realpath(path.resolve(directory, stdout.trim()));
        if (!authorizedReadRoots.some((root) => within(root, common))) {
          if (!(await registeredWorktree(directory, common)))
            throw new Error(
              'External Git metadata requires explicit read authorization or a registered worktree',
            );
        }
        protectedPaths.add(common);
        gitMetadataRoots.add(common.toLowerCase());
        readFiles.push(common);
        await discover(common, common, false, true, false, true);
      }
    }
    for await (const entry of await opendir(directory)) {
      if (++visited > 100000)
        throw new Error('sandbox resource discovery exceeds its entry limit');
      if (!metadata && !inRepository && ++genericVisited > 10000)
        throw new Error('credential discovery exceeds its entry limit');
      const candidate = path.join(directory, entry.name);
      const info = await lstat(candidate);
      const reserved = ['.git', '.autocode'].includes(entry.name.toLowerCase());
      if (!inRepository && !metadata && !reserved) {
        if (info.isSymbolicLink())
          throw new Error('generic writable resources must not contain links');
        if (info.isFile()) {
          const canonical = await realpath(candidate);
          if (
            !safeIgnoredFiles.has(canonical.toLowerCase()) &&
            !safeMutableFiles.has(canonical.toLowerCase())
          )
            blocked.add(canonical);
        }
      }
      if (reserved) {
        if (info.isSymbolicLink())
          throw new Error('protected metadata must not contain links');
        protectedPaths.add(await realpath(candidate));
      }
      const prefix = metadata
        ? !gitMetadata
          ? '.autocode/'
          : '.git/'
        : isCredentialDirectoryName(path.basename(base))
          ? path.basename(base) + '/'
          : '';
      const relative = path.relative(base, candidate);
      const parts = relative.split(path.sep);
      const namespace = parts[0]?.toLowerCase();
      // Submodule metadata is private by default: configs, include fragments
      // and nested modules need not use recognizable credential filenames.
      const privateEntry =
        privateMetadata ||
        (metadata && !gitMetadata) ||
        (gitMetadata && namespace === 'modules');
      if (privateEntry) {
        if (info.isSymbolicLink())
          throw new Error('credential paths must not be links');
        blocked.add(await realpath(candidate));
      }
      if (
        gitMetadata &&
        ((parts.length === 1 &&
          ['config', 'config.worktree'].includes(entry.name.toLowerCase())) ||
          (namespace === 'worktrees' &&
            parts.length === 3 &&
            entry.name.toLowerCase() === 'config.worktree') ||
          (privateEntry &&
            ['config', 'config.worktree'].includes(entry.name.toLowerCase()) &&
            info.isFile() &&
            (await moduleConfig(directory))))
      ) {
        if (info.isSymbolicLink() || !info.isFile())
          throw new Error('Git configuration must be a regular file');
        if (await credentialGitConfig(candidate))
          blocked.add(await realpath(candidate));
      }
      // Object/ref/reflog names and worktree IDs are Git data labels, not
      // credential names. Keep private stores outside these data namespaces protected.
      const gitData =
        gitMetadata && ['objects', 'refs', 'logs'].includes(namespace!);
      const credentialPath =
        gitMetadata && namespace === 'worktrees'
          ? '.git/' + parts.slice(2).join('/')
          : prefix + relative;
      if (
        !gitData &&
        (metadata || reserved || !inRepository) &&
        isCredentialPath(credentialPath)
      ) {
        if (info.isSymbolicLink())
          throw new Error('credential paths must not be links');
        blocked.add(await realpath(candidate));
      }
      if (info.isDirectory())
        await discover(
          candidate,
          reserved ? candidate : base,
          inRepository,
          metadata || reserved,
          privateEntry,
          reserved
            ? entry.name.toLowerCase() === '.git' ||
                gitMetadataRoots.has(candidate.toLowerCase())
            : gitMetadata,
        );
    }
  }
  // Walk covering roots once; nested repositories and metadata are discovered
  // regardless of whether they were supplied as a separate authorized resource.
  for (const root of writableRoots.filter(
    (root) =>
      !writableRoots.some((parent) => parent !== root && within(parent, root)),
  ))
    await discover(root, root);
  // Includes never authorize host reads. Inspect only referenced regular files
  // inside resources that will receive sandbox access, and keep each private.
  const grantedDirectories = [...writableRoots];
  const grantedFiles = new Set<string>();
  for (const resource of readFiles) {
    if ((await stat(resource)).isDirectory()) grantedDirectories.push(resource);
    else grantedFiles.add(resource.toLowerCase());
  }
  for (const include of configIncludes) {
    let info;
    let canonical;
    try {
      info = await lstat(include);
      canonical = await realpath(include);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // Include paths are configuration values and can contain secrets.
      // eslint-disable-next-line preserve-caught-error -- do not retain raw config values
      throw new Error('Could not inspect Git configuration includes safely');
    }
    if (
      !grantedFiles.has(canonical.toLowerCase()) &&
      !grantedDirectories.some((root) => within(root, canonical))
    )
      continue;
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Git configuration includes must be regular files');
    blocked.add(canonical);
    await credentialGitConfig(canonical);
  }
  const referenceTargets = new Map<string, string>();
  for (const { file, value } of configFileReferences.values()) {
    if (/^~[^\\/]/.test(value))
      throw new Error('Unsupported Git private file reference');
    const contexts =
      path.isAbsolute(value) || /^~[\\/]/.test(value)
        ? [path.dirname(file)]
        : [cwd, path.dirname(file), ...writableRoots, ...repositories];
    for (const context of contexts) {
      const target = /^~[\\/]/.test(value)
        ? path.resolve(os.homedir(), value.slice(2))
        : path.resolve(context, value);
      referenceTargets.set(target.toLowerCase(), target);
      if (referenceTargets.size > 1000)
        throw new Error('Git private file targets exceed their entry limit');
    }
  }
  for (const target of referenceTargets.values()) {
    if (
      !grantedFiles.has(target.toLowerCase()) &&
      !grantedDirectories.some((root) => within(root, target))
    )
      continue;
    let info;
    let canonical;
    try {
      info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Git private file references must be regular files');
      canonical = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // File reference paths are config values and may themselves contain secrets.
      // eslint-disable-next-line preserve-caught-error -- do not retain raw config values
      throw new Error('Could not inspect Git private file references safely');
    }
    if (
      !grantedFiles.has(canonical.toLowerCase()) &&
      !grantedDirectories.some((root) => within(root, canonical))
    )
      continue;
    blocked.add(canonical);
  }
  for (const metadata of protectedPaths)
    for (const writable of writableRoots)
      if (within(metadata, writable))
        throw new Error(
          'sandbox writable roots must not overlap protected metadata',
        );
  const blockedCredentials = [...blocked];
  const protectedResources = [...protectedPaths];
  if (batchExecutable) readFiles.push(await realpath(batchExecutable));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-qa-job-'));
  for (const writable of [await realpath(cwd), ...writeDirectories]) {
    const relative = path.relative(writable, await realpath(directory));
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    ) {
      await rmdir(directory);
      throw new Error('sandbox helper must be outside every writable resource');
    }
  }
  const cleaned = path.join(directory, 'cleaned');
  const payload = Buffer.from(
    JSON.stringify({
      command,
      arguments: arguments_,
      cwd,
      maxOutputBytes,
      parentPid: process.pid,
      inputBase64: Buffer.from(input ?? '', 'utf8').toString('base64'),
      verbatimTail: verbatimTail ?? null,
      readFiles,
      writeDirectories,
      runtime: process.execPath,
      profile: 'autocode-' + randomUUID().replaceAll('-', ''),
      cleanupTargets: [
        cwd,
        ...writeDirectories,
        command,
        ...readFiles,
        ...protectedResources,
        ...blockedCredentials,
      ],
      cleaned,
      ioDirectory: directory,
      protectedResources,
      blockedCredentials,
    }),
  ).toString('base64');
  const script = `param([switch]$Cleanup)\n$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\nAdd-Type -TypeDefinition @'\n${WINDOWS_JOB_HOST}\n${WINDOWS_SANDBOX}\n'@\n$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json\nif ($Cleanup) { [AutoCodeSandbox]::Cleanup($p.profile,[string[]]$p.cleanupTargets,$p.ioDirectory); exit 0 }\n$result=[AutoCodeQaJob]::Run($p.command, [string[]]$p.arguments, $p.cwd, [int]$p.maxOutputBytes, [int]$p.parentPid, $p.inputBase64, $p.verbatimTail, [string[]]$p.readFiles, [string[]]$p.writeDirectories, $p.runtime, $p.profile,$p.ioDirectory,[string[]]$p.protectedResources,[string[]]$p.blockedCredentials)\n[IO.File]::WriteAllText($p.cleaned,'cleaned')\nexit $result`;
  const scriptPath = path.join(directory, 'host.ps1');
  await writeFile(scriptPath, script, { flag: 'wx' });
  return { script: scriptPath, directory, cleaned };
}

// Start suspended, assign before any adapter code executes, and kill the entire job
// before returning output. The host's handle also kills descendants if it is killed.
const WINDOWS_JOB_HOST = String.raw`
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
public static class AutoCodeQaJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr Minimum, Maximum; public uint Active;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
    public int Length; public IntPtr Descriptor; public int Inherit;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct StartupInfo {
    public int Size; public string Reserved, Desktop, Title;
    public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; public ushort Show, ReservedSize;
    public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid,Tid; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out Accounting accounting,int size,IntPtr length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimits limits,int length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SecurityAttributes security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref AutoCodeSandbox.StartupEx startup,out ProcessInfo process);
  static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static void StopJob(IntPtr job) {
    Check(TerminateJobObject(job,1));
    Accounting accounting;
    do {
      Check(QueryInformationJobObject(job,1,out accounting,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));
      if(accounting.Active!=0) System.Threading.Thread.Sleep(10);
    } while(accounting.Active!=0);
  }
  static string Quote(string value) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') { slashes++; continue; }
      if(c=='\"') { result.Append('\\',slashes*2+1); result.Append(c); }
      else { result.Append('\\',slashes); result.Append(c); }
      slashes=0;
    }
    result.Append('\\',slashes*2); result.Append('"'); return result.ToString();
  }
  public static int Run(string command,string[] arguments,string cwd,int maxOutputBytes,int parentPid,string inputBase64,string verbatimTail,string[] readFiles,string[] writeDirectories,string runtime,string profile,string ioDirectory,string[] protectedResources,string[] blockedCredentials) {
    IntPtr job=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero,input=IntPtr.Zero,parent=IntPtr.Zero;
    ProcessInfo process=new ProcessInfo();
    AutoCodeSandbox sandbox=null;
    string outputPath=Path.Combine(ioDirectory,"stdout"),errorPath=Path.Combine(ioDirectory,"stderr"),inputPath=Path.Combine(ioDirectory,"stdin");
    try {
      parent=OpenProcess(0x100000,false,(uint)parentPid); Check(parent!=IntPtr.Zero);
      Check(WaitForSingleObject(parent,0)==0x102);
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
      Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(limits)));
      var security=new SecurityAttributes(); security.Length=Marshal.SizeOf(security); security.Inherit=1;
      output=CreateFile(outputPath,0x40000000,3,ref security,2,0x80,IntPtr.Zero);
      error=CreateFile(errorPath,0x40000000,3,ref security,2,0x80,IntPtr.Zero);
      File.WriteAllBytes(inputPath,Convert.FromBase64String(inputBase64));
      input=CreateFile(inputPath,0x80000000,3,ref security,3,0x80,IntPtr.Zero);
      Check(output!=new IntPtr(-1) && error!=new IntPtr(-1) && input!=new IntPtr(-1));
      sandbox=new AutoCodeSandbox(profile,cwd,command,runtime,readFiles,writeDirectories,protectedResources,ioDirectory,blockedCredentials);
      command=sandbox.Command;
      var startup=new AutoCodeSandbox.StartupEx(); startup.Info.Size=Marshal.SizeOf(startup); startup.Info.Flags=0x100;
      startup.Info.Input=input; startup.Info.Output=output; startup.Info.Error=error; startup.Attributes=sandbox.Attributes;
      var line=new StringBuilder(Quote(command));
      if(!String.IsNullOrEmpty(verbatimTail)) line.Append(" ").Append(verbatimTail);
      else foreach(string argument in arguments) line.Append(" ").Append(Quote(argument));
      Check(CreateProcess(command,line,IntPtr.Zero,IntPtr.Zero,true,0x08080404,sandbox.EnvironmentBlock,cwd,ref startup,out process));
      if(!AssignProcessToJobObject(job,process.Process)) { TerminateProcess(process.Process,1); Check(false); }
      Check(ResumeThread(process.Thread)!=0xffffffff);
      uint wait;
      while((wait=WaitForSingleObject(process.Process,50))==0x102) {
        if(WaitForSingleObject(parent,0)!=0x102) { StopJob(job); return -1; }
        if(new FileInfo(outputPath).Length+new FileInfo(errorPath).Length>maxOutputBytes) {
          StopJob(job); return -2;
        }
      }
      Check(wait==0);
      uint code; Check(GetExitCodeProcess(process.Process,out code));
      StopJob(job);
      CloseHandle(output); output=IntPtr.Zero; CloseHandle(error); error=IntPtr.Zero;
      if(new FileInfo(outputPath).Length+new FileInfo(errorPath).Length>maxOutputBytes) return -2;
      Console.Out.Write(File.ReadAllText(outputPath)); Console.Error.Write(File.ReadAllText(errorPath));
      return unchecked((int)code);
    } finally {
      if(job!=IntPtr.Zero) { try { StopJob(job); } finally { CloseHandle(job); } }
      if(process.Thread!=IntPtr.Zero) CloseHandle(process.Thread);
      if(process.Process!=IntPtr.Zero) CloseHandle(process.Process);
      if(output!=IntPtr.Zero) CloseHandle(output); if(error!=IntPtr.Zero) CloseHandle(error);
      if(input!=IntPtr.Zero) CloseHandle(input);
      if(parent!=IntPtr.Zero) CloseHandle(parent);
      if(sandbox!=null) sandbox.Dispose();
      File.Delete(outputPath); File.Delete(errorPath); File.Delete(inputPath);
    }
  }
}`;
