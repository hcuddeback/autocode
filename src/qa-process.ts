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
  readdir,
  lstat,
} from 'node:fs/promises';
import { discoverWorkspaceCredentials } from './codex.js';
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
}

const adapters = new WeakMap<QaCallbacks, string>();

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
      );
      if (result.exitCode !== 0 || result.timedOut || result.overflowed)
        throw new Error('contained QA process failed');
      return JSON.parse(result.stdout);
    },
  });
  adapters.set(adapter, cwd);
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
  if (adapters.get(adapter) !== path.resolve(root))
    throw new Error(
      'workflow QA requires a contained process adapter; in-process callbacks are unsafe',
    );
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
  const blockedCredentials: string[] = [];
  let repository = false;
  try {
    await stat(path.join(cwd, '.git'));
    repository = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (repository) {
    for (const relative of (
      await discoverWorkspaceCredentials(cwd)
    ).files.keys())
      blockedCredentials.push(await realpath(path.resolve(cwd, relative)));
  } else {
    // Generic non-repository adapters still protect recognizable local secrets.
    for (const entry of await readdir(cwd))
      if (
        /^\.env(?:\.|$)/i.test(entry) ||
        /(?:secret|credential)/i.test(entry)
      ) {
        const candidate = path.join(cwd, entry);
        if ((await lstat(candidate)).isSymbolicLink())
          throw new Error('credential paths must not be links');
        blockedCredentials.push(await realpath(candidate));
      }
  }
  const protectedResources = [
    path.join(cwd, '.autocode'),
    path.join(cwd, '.git'),
  ];
  if (batchExecutable)
    readFiles.push(await realpath(path.dirname(batchExecutable)));
  try {
    const dotGit = path.join(cwd, '.git');
    if ((await stat(dotGit)).isFile()) {
      const gitDirectory = path.resolve(
        cwd,
        (await readFile(dotGit, 'utf8')).trim().replace(/^gitdir: /, ''),
      );
      const common = path.resolve(
        gitDirectory,
        (await readFile(path.join(gitDirectory, 'commondir'), 'utf8')).trim(),
      );
      const canonicalCommon = await realpath(common);
      readFiles.push(canonicalCommon);
      protectedResources.push(canonicalCommon);
    }
  } catch {
    /* Disposable non-Git commands have no Git resource. */
  }
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
        path.dirname(command),
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
