import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import {
  resolveExecutable,
  runProcess,
  secureVerificationCommand,
} from './verification.js';
import type { QaCallbacks } from './qa.js';

export interface QaProcessOptions {
  command: string;
  arguments: readonly string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
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
  const adapter: QaCallbacks = Object.freeze<QaCallbacks>({
    async run(scenario, context) {
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
export async function runContainedProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
  input?: string,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeout must be a positive integer');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0)
    throw new Error('output limit must be a positive integer');
  const job =
    process.platform === 'win32'
      ? await windowsJobScript(
          executable,
          arguments_,
          cwd,
          maxOutputBytes,
          input,
        )
      : undefined;
  try {
    let systemctlCommand: string | undefined;
    const secured =
      process.platform === 'win32'
        ? {
            command: await resolveExecutable('powershell', cwd),
            arguments: [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              job!.script,
            ],
            systemdUnit: undefined,
          }
        : secureVerificationCommand(executable, arguments_);
    if (process.platform === 'linux') {
      systemctlCommand = await resolveExecutable('systemctl', cwd);
      const guardianPayload = Buffer.from(
        JSON.stringify({
          parentPid: process.pid,
          parentIdentity: linuxProcessIdentity(
            await readFile(`/proc/${process.pid}/stat`, 'utf8'),
          ),
          command: await resolveExecutable(secured.command, cwd),
          arguments: secured.arguments,
          unit: secured.systemdUnit,
          systemctl: systemctlCommand,
        }),
      ).toString('base64');
      secured.command = process.execPath;
      secured.arguments = [
        '--input-type=module',
        '-e',
        LINUX_GUARDIAN,
        guardianPayload,
      ];
    }
    const result = await runProcess(
      secured.command,
      secured.arguments,
      cwd,
      timeoutMs,
      maxOutputBytes,
      secured.systemdUnit,
      {
        windowsJob: process.platform === 'win32',
        systemctl: systemctlCommand,
        input: process.platform === 'win32' ? undefined : input,
      },
    );
    if (
      process.platform === 'win32' &&
      (result.exitCode === -2 || result.exitCode === 4294967294)
    )
      return {
        ...result,
        exitCode: -1,
        overflowed: true,
        stdout: '[output omitted: exceeded configured limit]\n',
        stderr: '[output omitted: exceeded configured limit]\n',
      };
    return result;
  } finally {
    if (job) {
      await unlink(job.script);
      await rmdir(job.directory);
    }
  }
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
): Promise<{ script: string; directory: string }> {
  const payload = Buffer.from(
    JSON.stringify({
      command,
      arguments: arguments_,
      cwd,
      maxOutputBytes,
      parentPid: process.pid,
      inputBase64: Buffer.from(input ?? '', 'utf8').toString('base64'),
    }),
  ).toString('base64');
  const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\nAdd-Type -TypeDefinition @'\n${WINDOWS_JOB_HOST}\n'@\n$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json\nexit [AutoCodeQaJob]::Run($p.command, [string[]]$p.arguments, $p.cwd, [int]$p.maxOutputBytes, [int]$p.parentPid, $p.inputBase64)`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-qa-job-'));
  const scriptPath = path.join(directory, 'host.ps1');
  await writeFile(scriptPath, script, { flag: 'wx' });
  return { script: scriptPath, directory };
}

// Start suspended, assign before any adapter code executes, and kill the entire job
// before returning output. The host's handle also kills descendants if it is killed.
const WINDOWS_JOB_HOST = String.raw`
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
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
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
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
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfo startup,out ProcessInfo process);
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
  public static int Run(string command,string[] arguments,string cwd,int maxOutputBytes,int parentPid,string inputBase64) {
    IntPtr job=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero,input=IntPtr.Zero,parent=IntPtr.Zero;
    ProcessInfo process=new ProcessInfo();
    string outputPath=Path.GetTempFileName(),errorPath=Path.GetTempFileName(),inputPath=Path.GetTempFileName();
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
      var startup=new StartupInfo(); startup.Size=Marshal.SizeOf(startup); startup.Flags=0x100;
      startup.Input=input; startup.Output=output; startup.Error=error;
      var line=new StringBuilder(Quote(command)); foreach(string argument in arguments) line.Append(" ").Append(Quote(argument));
      Check(CreateProcess(command,line,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out process));
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
      File.Delete(outputPath); File.Delete(errorPath); File.Delete(inputPath);
    }
  }
}`;

function linuxProcessIdentity(stat: string): string {
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]!;
}

// A separate trusted guardian survives operator-process death long enough to kill
// the systemd cgroup. PID start time prevents confusing a reused PID with the owner.
const LINUX_GUARDIAN = String.raw`
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const p=JSON.parse(Buffer.from(process.argv.at(-1),'base64').toString('utf8'));
let finished=false;
function identity(stat){return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}
function parentAlive(){try{const stat=readFileSync('/proc/'+p.parentPid+'/stat','utf8');const state=stat.slice(stat.lastIndexOf(')')+2).split(' ')[0];return state!=='Z'&&state!=='X'&&identity(stat)===p.parentIdentity;}catch{return false;}}
function stop(code){if(finished)return;finished=true;clearInterval(timer);spawnSync(p.systemctl,['--user','kill','--kill-whom=all','--signal=SIGKILL',p.unit],{timeout:5000,stdio:'ignore'});process.exit(code);}
if(!parentAlive())process.exit(1);
const child=spawn(p.command,p.arguments,{stdio:'inherit'});
const timer=setInterval(()=>{if(!parentAlive())stop(1);},50);
child.on('error',()=>stop(1));child.on('exit',code=>stop(code??1));
process.on('SIGTERM',()=>stop(1));process.on('SIGINT',()=>stop(1));
`;
