import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { discoverWorkspaceCredentials, redactSecrets } from './codex.js';
import { CONFIG_FILE, validateConfig } from './config.js';
import { loadTaskCatalog } from './tasks.js';

const execFileAsync = promisify(execFile);
const OMITTED_OUTPUT = '[output omitted: exceeded configured limit]\n';
const TERMINATION_GRACE_MS = 1_000;
const MAX_INPUT_BYTES = 1024 * 1024;

interface PlanningMetadata {
  version: 1;
  taskId: string;
  taskPath: string;
  taskSha256: string;
  headCommit: string;
  branch: string;
}

export interface VerificationCheckRecord {
  version: 1;
  name: string;
  command: string;
  arguments: string[];
  branch: string;
  headCommit: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  timedOut: boolean;
  overflowed: boolean;
  gitIdentityUnchanged: boolean;
  worktreeUnchanged: boolean;
  protectedStateUnchanged: boolean;
  passed: boolean;
}

export interface VerificationResult {
  runDirectory: string;
  passed: boolean;
  checks: VerificationCheckRecord[];
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  overflowed: boolean;
}

export async function runDeterministicVerification(
  projectDirectory: string,
): Promise<VerificationResult> {
  const root = await verifiedProjectRoot(projectDirectory);
  const config = validateConfig(
    parseYaml(
      await readBoundedRealFile(path.join(root, CONFIG_FILE), 'configuration'),
    ),
  );
  if (config.verification.commands.length === 0) {
    throw new Error('no deterministic verification commands are configured');
  }
  const active = (await loadTaskCatalog(root)).filter((task) =>
    ['ready', 'in_progress', 'review'].includes(task.status),
  );
  if (active.length !== 1) {
    throw new Error('verification requires exactly one active task');
  }
  const task = active[0]!;
  const [branch, headCommit, initialStatus] = await Promise.all([
    gitOutput(root, ['branch', '--show-current']),
    gitOutput(root, ['rev-parse', '--verify', 'HEAD']),
    gitOutput(root, ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  const initialWorktreeSnapshot = await snapshotWorktree(root);
  if (branch === '' || branch === 'main' || branch !== task.branch) {
    throw new Error(
      'verification requires the active task branch in an isolated worktree',
    );
  }
  await assertLinkedWorktree(root);
  const runDirectory = path.join(
    root,
    '.autocode',
    'runs',
    `${task.taskId}-${headCommit.slice(0, 12)}`,
  );
  const runIdentity = await directoryIdentity(
    runDirectory,
    'prepared run directory',
  );
  const runsIdentity = await directoryIdentity(
    path.dirname(runDirectory),
    'runs directory',
  );
  if (path.dirname(runIdentity.canonicalPath) !== runsIdentity.canonicalPath) {
    throw new Error('prepared run directory escapes the runs directory');
  }
  const configPath = path.join(root, CONFIG_FILE);
  const planningPath = path.join(runDirectory, 'planning.json');
  const taskSnapshotPath = path.join(runDirectory, 'task.md');
  const planPath = path.join(runDirectory, 'plan.md');
  const metadata = JSON.parse(
    await readBoundedRealFile(planningPath, 'planning metadata'),
  ) as PlanningMetadata;
  const taskSnapshot = await readBoundedRealFile(
    taskSnapshotPath,
    'task snapshot',
  );
  const protectedFiles = new Map<string, string>([
    [configPath, await readBoundedRealFile(configPath, 'configuration')],
    [
      planningPath,
      await readBoundedRealFile(planningPath, 'planning metadata'),
    ],
    [taskSnapshotPath, taskSnapshot],
    [planPath, await readBoundedRealFile(planPath, 'implementation plan')],
  ]);
  if (
    metadata.version !== 1 ||
    metadata.taskId !== task.taskId ||
    metadata.taskPath !== normalizedRelativePath(root, task.filePath) ||
    metadata.branch !== branch ||
    metadata.headCommit !== headCommit ||
    metadata.taskSha256 !==
      createHash('sha256').update(task.contents).digest('hex') ||
    taskSnapshot !== task.contents
  ) {
    throw new Error(
      'verification preparation is stale or does not match the active task',
    );
  }

  const evidenceDirectory = path.join(runDirectory, 'evidence');
  await assertDirectoryIdentity(runsIdentity, 'runs directory');
  await assertDirectoryIdentity(runIdentity, 'prepared run directory');
  try {
    await mkdir(evidenceDirectory);
  } catch (error: unknown) {
    if (hasCode(error, 'EEXIST')) {
      throw new Error(
        'verification evidence already exists; refusing to overwrite it',
        { cause: error },
      );
    }
    throw error;
  }
  const evidenceIdentity = await directoryIdentity(
    evidenceDirectory,
    'verification evidence directory',
  );
  await assertDirectoryIdentity(runIdentity, 'prepared run directory');
  const credentials = await discoverWorkspaceCredentials(root);
  const checks: VerificationCheckRecord[] = [];
  let passed = true;
  for (const configured of config.verification.commands) {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    let processResult: ProcessResult;
    try {
      const executable = await resolveExecutable(configured.command, root);
      processResult = await runProcess(
        executable,
        configured.args,
        root,
        config.verification.timeoutMs,
        config.verification.maxOutputBytes,
      );
    } catch (error: unknown) {
      processResult = {
        stdout: '',
        stderr:
          error instanceof Error ? error.message : 'executable lookup failed',
        exitCode: -1,
        timedOut: false,
        overflowed: false,
      };
    }
    const completed = Date.now();
    const [currentBranch, currentHead, currentStatus, currentWorktreeSnapshot] =
      await Promise.all([
        gitOutput(root, ['branch', '--show-current']),
        gitOutput(root, ['rev-parse', '--verify', 'HEAD']),
        gitOutput(root, ['status', '--porcelain=v1', '--untracked-files=all']),
        snapshotWorktree(root),
      ]);
    const gitIdentityUnchanged =
      currentBranch === branch && currentHead === headCommit;
    const worktreeUnchanged =
      currentStatus === initialStatus &&
      currentWorktreeSnapshot === initialWorktreeSnapshot;
    const protectedStateUnchanged = await filesUnchanged(protectedFiles);
    const record: VerificationCheckRecord = {
      version: 1,
      name: configured.name,
      command: configured.command,
      arguments: configured.args.map((argument) =>
        redactSecrets(argument, credentials.secrets),
      ),
      branch,
      headCommit,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: Math.max(0, completed - started),
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      overflowed: processResult.overflowed,
      gitIdentityUnchanged,
      worktreeUnchanged,
      protectedStateUnchanged,
      passed:
        processResult.exitCode === 0 &&
        !processResult.timedOut &&
        !processResult.overflowed &&
        gitIdentityUnchanged &&
        worktreeUnchanged &&
        protectedStateUnchanged,
    };
    await persistCheck(
      evidenceDirectory,
      evidenceIdentity,
      record,
      processResult,
      credentials.secrets,
    );
    checks.push(record);
    if (!record.passed) {
      passed = false;
      break;
    }
  }
  const result = { runDirectory, passed, checks };
  await assertDirectoryIdentity(
    evidenceIdentity,
    'verification evidence directory',
  );
  await writeFile(
    path.join(evidenceDirectory, 'summary.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: 'wx' },
  );
  if (!passed)
    throw new Error(
      'deterministic verification failed; retained evidence identifies the failing check',
    );
  return result;
}

async function snapshotWorktree(root: string): Promise<string> {
  const [staged, unstaged, untracked] = await Promise.all([
    gitOutput(root, ['diff', '--binary', '--no-ext-diff', '--cached', 'HEAD']),
    gitOutput(root, ['diff', '--binary', '--no-ext-diff', 'HEAD']),
    gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const digest = createHash('sha256');
  digest.update(staged).update('\0').update(unstaged).update('\0');
  for (const relative of untracked.split('\0').filter(Boolean).sort()) {
    normalizedRelativePath(root, path.resolve(root, relative));
    digest.update(relative).update('\0');
    digest.update(
      await gitOutput(root, ['hash-object', '--no-filters', '--', relative]),
    );
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function resolveExecutable(
  command: string,
  root: string,
): Promise<string> {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
      : [''];
  const canonicalRoot = await realpath(root);
  for (const rawEntry of pathValue.split(path.delimiter)) {
    const entry = rawEntry.replace(/^"|"$/g, '');
    if (entry === '' || !path.isAbsolute(entry)) continue;
    let canonicalEntry: string;
    try {
      canonicalEntry = await realpath(entry);
    } catch {
      continue;
    }
    const relativeToRoot = path.relative(canonicalRoot, canonicalEntry);
    if (
      relativeToRoot === '' ||
      (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot))
    ) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(canonicalEntry, `${command}${extension}`);
      try {
        const details = await lstat(candidate);
        if (details.isSymbolicLink() || !details.isFile()) continue;
        await access(
          candidate,
          process.platform === 'win32' ? constants.F_OK : constants.X_OK,
        );
        return candidate;
      } catch {
        // Continue searching the configured process PATH.
      }
    }
  }
  throw new Error(
    `verification executable was not found on the trusted PATH: ${command}`,
  );
}

async function persistCheck(
  evidenceDirectory: string,
  evidenceIdentity: DirectoryIdentity,
  record: VerificationCheckRecord,
  result: ProcessResult,
  secrets: readonly string[],
): Promise<void> {
  const temporary = path.join(
    evidenceDirectory,
    `.${record.name}.tmp-${process.pid}-${randomUUID()}`,
  );
  const destination = path.join(evidenceDirectory, record.name);
  await assertDirectoryIdentity(
    evidenceIdentity,
    'verification evidence directory',
  );
  await mkdir(temporary);
  try {
    await writeFile(
      path.join(temporary, 'check.json'),
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: 'wx' },
    );
    await writeFile(
      path.join(temporary, 'stdout.txt'),
      redactSecrets(result.stdout, secrets),
      { flag: 'wx' },
    );
    await writeFile(
      path.join(temporary, 'stderr.txt'),
      redactSecrets(result.stderr, secrets),
      { flag: 'wx' },
    );
    await assertDirectoryIdentity(
      evidenceIdentity,
      'verification evidence directory',
    );
    await rename(temporary, destination);
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function runProcess(
  command: string,
  arguments_: string[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, {
      cwd,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let totalBytes = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;
    let terminationTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      resolve({
        stdout: overflowed ? OMITTED_OUTPUT : stdout.toString('utf8'),
        stderr: overflowed ? OMITTED_OUTPUT : stderr.toString('utf8'),
        exitCode,
        timedOut,
        overflowed,
      });
    };
    const terminate = () => {
      if (terminationTimer !== undefined) return;
      terminateTree(child.pid, false);
      terminationTimer = setTimeout(() => {
        terminateTree(child.pid, true);
        finish(-1);
      }, TERMINATION_GRACE_MS);
      terminationTimer.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutputBytes) {
        overflowed = true;
        terminate();
        return;
      }
      if (target === 'stdout') stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.on('error', (error) => {
      stderr = Buffer.from(error.message);
      finish(-1);
    });
    child.on('close', (code) => {
      if (!timedOut && !overflowed) terminateTree(child.pid, true);
      finish(code ?? -1);
    });
  });
}

function terminateTree(pid: number | undefined, force: boolean): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
    });
    killWindowsDescendants(pid);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // taskkill may already have terminated the direct process.
    }
    return;
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // The process may have exited before termination.
  }
}

function killWindowsDescendants(pid: number): void {
  const script =
    'param([int]$RootPid) ' +
    '$pending = [Collections.Generic.Queue[int]]::new(); $pending.Enqueue($RootPid); ' +
    '$descendants = [Collections.Generic.List[int]]::new(); ' +
    'while ($pending.Count -gt 0) { $parent = $pending.Dequeue(); ' +
    'Get-CimInstance Win32_Process -Filter "ParentProcessId = $parent" | ForEach-Object { ' +
    '$id = [int]$_.ProcessId; $descendants.Add($id); $pending.Enqueue($id) } }; ' +
    '$descendants | Sort-Object -Descending | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }';
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script, String(pid)],
    { windowsHide: true },
  );
}

interface DirectoryIdentity {
  target: string;
  canonicalPath: string;
  dev: number;
  ino: number;
}

async function filesUnchanged(
  files: ReadonlyMap<string, string>,
): Promise<boolean> {
  for (const [target, expected] of files) {
    try {
      if (
        (await readBoundedRealFile(target, 'protected verification input')) !==
        expected
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function directoryIdentity(
  target: string,
  description: string,
): Promise<DirectoryIdentity> {
  const targetStats = await lstat(target);
  if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
    throw new Error(`${description} must be a real directory`);
  }
  const canonicalPath = await realpath(target);
  const resolvedStats = await stat(canonicalPath);
  if (
    targetStats.dev !== resolvedStats.dev ||
    targetStats.ino !== resolvedStats.ino
  ) {
    throw new Error(`${description} changed while being inspected`);
  }
  return { target, canonicalPath, dev: targetStats.dev, ino: targetStats.ino };
}

async function assertDirectoryIdentity(
  expected: DirectoryIdentity,
  description: string,
): Promise<void> {
  const current = await directoryIdentity(expected.target, description);
  if (
    current.canonicalPath !== expected.canonicalPath ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new Error(`${description} changed while verification was running`);
  }
}

async function readBoundedRealFile(
  target: string,
  description: string,
): Promise<string> {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > MAX_INPUT_BYTES) {
      throw new Error(`${description} must be a bounded real file`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function verifiedProjectRoot(projectDirectory: string): Promise<string> {
  const requested = await realpath(projectDirectory);
  const root = await gitOutput(requested, ['rev-parse', '--show-toplevel']);
  if ((await realpath(root)) !== requested)
    throw new Error('project directory must be the Git worktree root');
  return requested;
}

async function assertLinkedWorktree(root: string): Promise<void> {
  const common = await gitOutput(root, ['rev-parse', '--git-common-dir']);
  const own = await gitOutput(root, ['rev-parse', '--git-dir']);
  if (path.resolve(root, common) === path.resolve(root, own)) {
    throw new Error('verification requires an isolated linked worktree');
  }
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

function normalizedRelativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('task path escapes the project root');
  return relative.split(path.sep).join('/');
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
