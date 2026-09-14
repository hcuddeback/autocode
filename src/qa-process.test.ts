import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createContainedQaAdapter,
  assertContainedQaAdapter,
  runContainedProcess,
} from './qa-process.js';
import { runProjectWorkflow } from './workflow.js';
import { runRoleSeparatedCodexSessions } from './codex.js';
import { runDeterministicVerification } from './verification.js';

async function snapshotWindowsAcl(paths: string[]): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(paths)).toString('base64');
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json | ForEach-Object { $acl=if([IO.Directory]::Exists($_)){[IO.Directory]::GetAccessControl($_)}else{[IO.File]::GetAccessControl($_)};$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]7) } | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true },
  );
  return stdout.trim();
}

async function editWindowsAcl(
  target: string,
  operation: string,
): Promise<void> {
  const encoded = Buffer.from(target).toString('base64');
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$acl=[IO.File]::GetAccessControl($target);${operation};[IO.File]::SetAccessControl($target,$acl)`,
    ],
    { windowsHide: true },
  );
}

test(
  'Windows refuses existing package credential grants without changing them',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-package-acl-'),
    );
    try {
      const target = path.join(directory, '.npmrc');
      await writeFile(
        target,
        '//registry.example.invalid/:_authToken=synthetic-private',
      );
      for (const inherited of [false, true]) {
        const grantTarget = inherited ? directory : target;
        const encoded = Buffer.from(grantTarget).toString('base64');
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$acl=if([IO.Directory]::Exists($target)){[IO.Directory]::GetAccessControl($target)}else{[IO.File]::GetAccessControl($target)};$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-15-2-1'),'Read',${inherited ? "'ContainerInherit,ObjectInherit','None'," : ''}'Allow');$acl.AddAccessRule($rule);if([IO.Directory]::Exists($target)){[IO.Directory]::SetAccessControl($target,$acl)}else{[IO.File]::SetAccessControl($target,$acl)}`,
          ],
          { windowsHide: true },
        );
        const original = await snapshotWindowsAcl([directory, target]);
        const result = await runContainedProcess(
          process.execPath,
          ['-e', "require('node:fs').writeFileSync('launched','bad')"],
          directory,
          10_000,
          10_000,
        );
        assert.notEqual(result.exitCode, 0);
        assert.match(
          result.stderr,
          /credential ACL already grants application-package access/,
        );
        assert.equal(await snapshotWindowsAcl([directory, target]), original);
        await assert.rejects(() => readFile(path.join(directory, 'launched')), {
          code: 'ENOENT',
        });
        // Remove only the synthetic fixture grant between cases.
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$acl=if([IO.Directory]::Exists($target)){[IO.Directory]::GetAccessControl($target)}else{[IO.File]::GetAccessControl($target)};$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-15-2-1'),'Read',${inherited ? "'ContainerInherit,ObjectInherit','None'," : ''}'Allow');$acl.RemoveAccessRuleSpecific($rule);if([IO.Directory]::Exists($target)){[IO.Directory]::SetAccessControl($target,$acl)}else{[IO.File]::SetAccessControl($target,$acl)}`,
          ],
          { windowsHide: true },
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows refuses preexisting package write access within protected metadata',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-metadata-package-'),
    );
    try {
      await mkdir(path.join(directory, '.autocode'));
      const target = path.join(directory, '.autocode', 'state.json');
      await writeFile(target, 'operator-state');
      await editWindowsAcl(
        target,
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-15-2-1'),'Read','Allow');$acl.AddAccessRule($rule)",
      );
      const readOnlyAcl = await snapshotWindowsAcl([
        directory,
        path.dirname(target),
        target,
      ]);
      const readOnly = await runContainedProcess(
        process.execPath,
        [
          '-e',
          "const fs=require('node:fs');console.log(fs.readFileSync('.autocode/state.json','utf8'));try{fs.writeFileSync('.autocode/state.json','forged');process.exit(2)}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}",
        ],
        directory,
        10000,
        10000,
      );
      assert.equal(readOnly.exitCode, 0, readOnly.stderr);
      assert.match(readOnly.stdout, /operator-state/);
      assert.equal(
        await snapshotWindowsAcl([directory, path.dirname(target), target]),
        readOnlyAcl,
      );
      await editWindowsAcl(
        target,
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-15-2-1'),'Modify','Allow');$acl.AddAccessRule($rule)",
      );
      const original = await snapshotWindowsAcl([
        directory,
        path.dirname(target),
        target,
      ]);
      const result = await runContainedProcess(
        process.execPath,
        [
          '-e',
          "require('node:fs').writeFileSync('.autocode/state.json','forged')",
        ],
        directory,
        10000,
        10000,
      );
      assert.notEqual(
        result.exitCode,
        0,
        'preexisting package grants must not bypass metadata isolation',
      );
      assert.match(
        result.stderr,
        /metadata ACL already grants application-package write access/,
      );
      assert.equal(await readFile(target, 'utf8'), 'operator-state');
      assert.equal(
        await snapshotWindowsAcl([directory, path.dirname(target), target]),
        original,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows excludes credentials and metadata in every writable root',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of ['sibling', 'parent', 'nested', 'linked', 'aliases'])
      await t.test(mode, async () => {
        const base = await mkdtemp(
          path.join(os.tmpdir(), 'autocode-extra-boundary-'),
        );
        const cwd = path.join(base, 'cwd');
        const extra =
          mode === 'nested'
            ? path.join(cwd, 'extra')
            : path.join(base, 'extra');
        const exec = promisify(execFile);
        try {
          await mkdir(cwd, { recursive: true });
          await mkdir(extra, { recursive: true });
          const repository = path.join(
            extra,
            mode === 'linked' ? 'config' : 'nested',
          );
          let common: string;
          if (mode === 'linked') {
            const source = path.join(base, 'source');
            await mkdir(source);
            const git = (args: string[]) =>
              exec('git', args, { cwd: source, windowsHide: true });
            await git(['init', '-b', 'main']);
            await git(['config', 'user.email', 'fixture@example.invalid']);
            await git(['config', 'user.name', 'Fixture']);
            await writeFile(path.join(source, 'ordinary.txt'), 'tracked');
            await git(['add', '.']);
            await git(['commit', '-m', 'fixture']);
            await git(['branch', 'config']);
            await git([
              'worktree',
              'add',
              '-b',
              'credential-boundary',
              repository,
            ]);
            common = path.join(source, '.git');
          } else {
            await mkdir(repository);
            await exec('git', ['init', '-b', 'main'], {
              cwd: repository,
              windowsHide: true,
            });
            common = path.join(repository, '.git');
          }
          await writeFile(
            path.join(repository, '.gitignore'),
            '.netrc\n.autocode/\n',
          );
          const credentials = [
            path.join(base, '.env'),
            path.join(extra, '.npmrc'),
            path.join(extra, '.aws', 'config'),
            path.join(extra, 'id_rsa'),
            path.join(repository, '.netrc'),
            path.join(common, 'secrets.json'),
          ];
          for (const target of credentials) {
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, 'operator-private');
          }
          const metadata = [
            path.join(cwd, '.autocode', 'state.json'),
            path.join(extra, '.autocode', 'state.json'),
            path.join(repository, '.autocode', 'state.json'),
            path.join(common, 'config'),
          ];
          if (mode === 'linked') metadata.push(path.join(repository, '.git'));
          for (const target of metadata.slice(0, 3)) {
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, 'operator-state');
          }
          const originalMetadata = await Promise.all(
            metadata.map((target) => readFile(target, 'utf8')),
          );
          const aclPaths = [
            base,
            cwd,
            extra,
            path.join(extra, '.aws'),
            ...credentials,
            ...metadata,
            common,
          ];
          const originalAcl = await snapshotWindowsAcl(aclPaths);
          const publicGit =
            mode === 'linked'
              ? [
                  path.join(common, 'refs', 'heads', 'credential-boundary'),
                  path.join(common, 'refs', 'heads', 'config'),
                ]
              : [];
          const script = `const fs=require('node:fs');const violations=[];${JSON.stringify(publicGit)}.forEach(p=>fs.readFileSync(p));const denied=(action,label)=>{try{action();violations.push(label)}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}};${JSON.stringify(credentials)}.forEach((p,i)=>{denied(()=>fs.readFileSync(p),'credential-read-'+i);denied(()=>fs.writeFileSync(p,'corrupt'),'credential-write-'+i);denied(()=>fs.renameSync(p,p+'.moved'),'credential-rename-'+i);denied(()=>fs.unlinkSync(p),'credential-delete-'+i)});${JSON.stringify(metadata)}.forEach((p,i)=>{denied(()=>fs.writeFileSync(p,'corrupt'),'metadata-write-'+i);denied(()=>fs.renameSync(p,p+'.moved'),'metadata-rename-'+i);denied(()=>fs.unlinkSync(p),'metadata-delete-'+i)});fs.writeFileSync(${JSON.stringify(path.join(extra, 'ordinary.txt'))},'allowed');fs.writeFileSync('ordinary.txt','allowed');if(violations.length)throw Error(violations.join(','));console.log('all-roots-protected');`;
          const options =
            mode === 'nested'
              ? []
              : mode === 'aliases'
                ? [extra, extra.toUpperCase()]
                : [mode === 'parent' ? base : extra];
          const result = await runContainedProcess(
            process.execPath,
            ['-e', script],
            cwd,
            30000,
            10000,
            undefined,
            options,
          );
          assert.equal(result.exitCode, 0, result.stderr);
          assert.match(result.stdout, /all-roots-protected/);
          assert.equal(
            await snapshotWindowsAcl(aclPaths),
            originalAcl,
            'resource ACLs restore exactly',
          );
          for (const target of credentials)
            assert.equal(await readFile(target, 'utf8'), 'operator-private');
          assert.deepEqual(
            await Promise.all(
              metadata.map((target) => readFile(target, 'utf8')),
            ),
            originalMetadata,
          );
          assert.equal(
            await readFile(path.join(extra, 'ordinary.txt'), 'utf8'),
            'allowed',
          );
          assert.equal(
            await readFile(path.join(cwd, 'ordinary.txt'), 'utf8'),
            'allowed',
          );
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows requires authorization for unrelated external Git metadata',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of ['unregistered', 'wrong-registration', 'explicit'])
      await t.test(mode, async () => {
        const base = await mkdtemp(
          path.join(os.tmpdir(), 'autocode-git-authority-'),
        );
        try {
          const cwd = path.join(base, 'cwd');
          const extra = path.join(base, 'extra');
          const privateRoot = path.join(base, 'private');
          const exec = promisify(execFile);
          await mkdir(cwd);
          await mkdir(extra);
          await mkdir(privateRoot);
          const git = (args: string[]) =>
            exec('git', args, { cwd: privateRoot, windowsHide: true });
          await git(['init', '-b', 'main']);
          let pointer = path.join(privateRoot, '.git');
          if (mode === 'wrong-registration') {
            await git(['config', 'user.name', 'Fixture']);
            await git(['config', 'user.email', 'fixture@example.invalid']);
            await writeFile(path.join(privateRoot, 'ordinary.txt'), 'tracked');
            await git(['add', '.']);
            await git(['commit', '-m', 'fixture']);
            const registered = path.join(base, 'registered');
            await git(['worktree', 'add', '-b', 'fixture', registered]);
            pointer = (
              await exec('git', ['rev-parse', '--absolute-git-dir'], {
                cwd: registered,
                windowsHide: true,
              })
            ).stdout.trim();
          }
          await writeFile(
            path.join(extra, '.git'),
            'gitdir: ' + pointer + '\n',
          );
          const common = path.join(privateRoot, '.git');
          const target = path.join(common, 'private-object.txt');
          await writeFile(target, 'private-repository-data');
          const paths = [cwd, extra, common, target, path.join(extra, '.git')];
          const original = await snapshotWindowsAcl(paths);
          const script =
            mode === 'explicit'
              ? `const fs=require('node:fs');console.log(fs.readFileSync(${JSON.stringify(target)},'utf8'));fs.writeFileSync('launched','yes')`
              : "require('node:fs').writeFileSync('launched','yes')";
          const launch = () =>
            runContainedProcess(
              process.execPath,
              ['-e', script],
              cwd,
              15000,
              10000,
              undefined,
              [extra],
              mode === 'explicit' ? [common] : [],
            );
          if (mode === 'explicit') {
            const result = await launch();
            assert.equal(result.exitCode, 0, result.stderr);
            assert.match(result.stdout, /private-repository-data/);
          } else {
            await assert.rejects(
              launch,
              /External Git metadata requires explicit read authorization or a registered worktree/,
            );
            await assert.rejects(() => readFile(path.join(cwd, 'launched')), {
              code: 'ENOENT',
            });
          }
          assert.equal(await snapshotWindowsAcl(paths), original);
          assert.equal(
            await readFile(target, 'utf8'),
            'private-repository-data',
          );
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows isolates credential-bearing Git configuration and retains public config reads',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of [
      'url',
      'header',
      'worktree',
      'askpass',
      'include',
      'file-reference',
      'public',
    ])
      await t.test(mode, async () => {
        const base = await mkdtemp(
          path.join(os.tmpdir(), 'autocode-git-config-'),
        );
        try {
          const cwd = path.join(base, 'cwd');
          const extra = path.join(base, 'extra');
          await mkdir(cwd);
          await mkdir(extra);
          const exec = promisify(execFile);
          const configs: string[] = [];
          const privateReferences: string[] = [];
          for (const root of [cwd, extra]) {
            await exec('git', ['init', '-b', 'main'], {
              cwd: root,
              windowsHide: true,
            });
            const config = path.join(
              root,
              '.git',
              mode === 'worktree' ? 'config.worktree' : 'config',
            );
            const setting =
              mode === 'url'
                ? [
                    'remote.origin.url',
                    'https://operator-private@example.invalid/repo',
                  ]
                : mode === 'header' || mode === 'worktree'
                  ? [
                      'http.https://example.invalid/.extraHeader',
                      'Authorization: Basic operator-private',
                    ]
                  : mode === 'askpass'
                    ? ['core.askPass', '!echo operator-private']
                    : mode === 'include'
                      ? ['include.path', path.join(base, 'private-config')]
                      : ['user.name', 'Public Fixture'];
            await exec('git', ['config', '--file', config, ...setting], {
              cwd: root,
              windowsHide: true,
            });
            if (mode === 'file-reference') {
              const fields = [
                'http.sslKey',
                'http.sslCert',
                'http.cookieFile',
                'credential.helper',
                'core.sshCommand',
                'core.askPass',
              ];
              for (const [index, field] of fields.entries()) {
                const reference = `./.git/opaque-${index}`;
                const target = path.join(root, '.git', `opaque-${index}`);
                await writeFile(target, 'synthetic-private-file');
                privateReferences.push(target);
                const value =
                  field === 'credential.helper'
                    ? `store --file="${reference}"`
                    : field === 'core.sshCommand'
                      ? `ssh -i "${reference}"`
                      : field === 'core.askPass'
                        ? `"${reference}"`
                        : reference;
                await exec('git', ['config', '--file', config, field, value], {
                  cwd: root,
                  windowsHide: true,
                });
              }
            }
            configs.push(config);
          }
          if (mode === 'public')
            for (const config of configs)
              await writeFile(
                config,
                (await readFile(config, 'utf8')) +
                  '\n[feature]\nexperimental\n',
              );
          await writeFile(
            path.join(base, 'private-config'),
            '[http]\nextraHeader = Authorization: Basic operator-private\n',
          );
          const targets = [...configs, ...privateReferences];
          const originals = await Promise.all(
            targets.map((file) => readFile(file, 'utf8')),
          );
          const paths = [cwd, extra, ...targets];
          const originalAcl = await snapshotWindowsAcl(paths);
          const script =
            mode === 'public'
              ? `const fs=require('node:fs');${JSON.stringify(configs)}.forEach(p=>{if(!fs.readFileSync(p,'utf8').includes('Public Fixture'))throw Error('missing public config')});console.log('public-config-readable')`
              : `const fs=require('node:fs');${JSON.stringify(targets)}.forEach(p=>{try{fs.readFileSync(p);throw Error('private config/reference readable')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}});fs.writeFileSync('ordinary.txt','allowed');console.log('private-config-protected')`;
          const result = await runContainedProcess(
            process.execPath,
            ['-e', script],
            cwd,
            15000,
            10000,
            undefined,
            [extra],
          );
          assert.equal(result.exitCode, 0, result.stderr);
          assert.match(
            result.stdout,
            mode === 'public'
              ? /public-config-readable/
              : /private-config-protected/,
          );
          assert.equal(await snapshotWindowsAcl(paths), originalAcl);
          assert.deepEqual(
            await Promise.all(targets.map((file) => readFile(file, 'utf8'))),
            originals,
          );
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows keeps submodule metadata and opaque config fragments private',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of [
      'cwd',
      'additional',
      'linked',
      'package-read',
      'custom-common',
    ])
      await t.test(mode, async () => {
        const base = await mkdtemp(path.join(os.tmpdir(), 'autocode-modules-'));
        try {
          const source = path.join(base, 'source');
          const workspace = path.join(base, 'workspace');
          await mkdir(source);
          const exec = promisify(execFile);
          const git = (args: string[]) =>
            exec('git', args, { cwd: source, windowsHide: true });
          const common = path.join(
            source,
            mode === 'custom-common' ? '.autocode' : '.git',
          );
          await git(
            mode === 'custom-common'
              ? ['init', '-b', 'main', '--separate-git-dir', common]
              : ['init', '-b', 'main'],
          );
          await git(['config', 'user.name', 'Public Fixture']);
          await git(['config', 'user.email', 'fixture@example.invalid']);
          await writeFile(path.join(source, 'ordinary.txt'), 'tracked');
          await git(['add', '.']);
          await git(['commit', '-m', 'fixture']);
          await mkdir(workspace);
          if (mode === 'linked') {
            await git(['worktree', 'add', '-b', 'feature', workspace]);
          }
          const module = path.join(common, 'modules', 'config');
          await mkdir(module, { recursive: true });
          await exec('git', ['init', '--bare', module], {
            cwd: source,
            windowsHide: true,
          });
          const nested = path.join(module, 'modules', 'nested');
          await mkdir(nested, { recursive: true });
          await exec('git', ['init', '--bare', nested], {
            cwd: source,
            windowsHide: true,
          });
          const targets = [
            path.join(module, 'config'),
            path.join(module, 'opaque-fragment'),
            path.join(nested, 'config'),
            path.join(nested, 'opaque.bin'),
            path.join(common, 'shared-fragment'),
            path.join(source, 'ordinary-config-fragment'),
          ];
          await exec(
            'git',
            [
              'config',
              '--file',
              targets[0]!,
              mode === 'additional'
                ? 'includeIf.gitdir:never/.path'
                : 'include.path',
              '../../shared-fragment',
            ],
            { cwd: source, windowsHide: true },
          );
          await writeFile(
            targets[1]!,
            '[http]\nextraHeader = Authorization: Basic synthetic-private\n',
          );
          await exec(
            'git',
            [
              'config',
              '--file',
              targets[2]!,
              'remote.origin.url',
              'https://synthetic-private@example.invalid/repo',
            ],
            { cwd: source, windowsHide: true },
          );
          await writeFile(targets[3]!, 'synthetic-private');
          await writeFile(
            targets[4]!,
            '[include]\npath = ../ordinary-config-fragment\n',
          );
          await writeFile(
            targets[5]!,
            `[include]\npath = ./${path.basename(common)}/modules/config/config\n[http]\nextraHeader = Authorization: Basic synthetic-private\n`,
          );
          if (mode === 'package-read')
            await editWindowsAcl(
              targets[5]!,
              "$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-15-2-1'),'Read','Allow');$acl.AddAccessRule($rule)",
            );
          const cwd =
            mode === 'cwd' ||
            mode === 'package-read' ||
            mode === 'custom-common'
              ? source
              : workspace;
          const paths = [source, workspace, common, module, nested, ...targets];
          const originalAcl = await snapshotWindowsAcl(paths);
          const contents = await Promise.all(
            targets.map((file) => readFile(file)),
          );
          const script = `const fs=require('node:fs');${JSON.stringify(targets)}.forEach(p=>{try{fs.readFileSync(p);throw Error('private submodule metadata readable')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}});if(!fs.readFileSync(${JSON.stringify(path.join(common, 'config'))},'utf8').includes('Public Fixture'))throw Error('missing public config');if(!fs.readFileSync(${JSON.stringify(path.join(common, 'refs', 'heads', 'main'))},'utf8').trim())throw Error('missing public ref');fs.writeFileSync('launched','yes');console.log('submodule-metadata-private')`;
          const result = await runContainedProcess(
            process.execPath,
            ['-e', script],
            cwd,
            20000,
            10000,
            undefined,
            mode === 'additional' ? [source] : [],
          );
          if (mode === 'package-read') {
            assert.notEqual(result.exitCode, 0);
            assert.match(
              result.stderr,
              /credential ACL already grants application-package access/,
            );
            await assert.rejects(() => readFile(path.join(cwd, 'launched')), {
              code: 'ENOENT',
            });
          } else {
            assert.equal(result.exitCode, 0, result.stderr);
            assert.match(result.stdout, /submodule-metadata-private/);
            assert.equal(
              await readFile(path.join(cwd, 'launched'), 'utf8'),
              'yes',
            );
          }
          assert.equal(await snapshotWindowsAcl(paths), originalAcl);
          assert.deepEqual(
            await Promise.all(targets.map((file) => readFile(file))),
            contents,
          );
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows protects a directly authorized cloud credential directory',
  { skip: process.platform !== 'win32' },
  async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'autocode-cloud-root-'));
    try {
      const cwd = path.join(base, 'cwd');
      const cloud = path.join(base, '.aws');
      await mkdir(cwd);
      await mkdir(cloud);
      const target = path.join(cloud, 'config');
      await writeFile(target, 'operator-private');
      const original = await snapshotWindowsAcl([cwd, cloud, target]);
      const script = `const fs=require('node:fs');try{fs.readFileSync(${JSON.stringify(target)});process.exit(2)}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}fs.writeFileSync('ordinary.txt','allowed');`;
      const result = await runContainedProcess(
        process.execPath,
        ['-e', script],
        cwd,
        15000,
        10000,
        undefined,
        [cloud],
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await snapshotWindowsAcl([cwd, cloud, target]), original);
      assert.equal(await readFile(target, 'utf8'), 'operator-private');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);

test(
  'Windows preserves metadata ancestors despite Git markers and permits registered infrastructure',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of ['cache-git', 'worktree-git', 'registered'])
      await t.test(mode, async () => {
        const base = await mkdtemp(
          path.join(os.tmpdir(), 'autocode-state-enclave-'),
        );
        try {
          const cwd = path.join(base, 'cwd');
          const resource = path.join(
            base,
            'other',
            '.autocode',
            mode === 'cache-git' ? 'cache' : 'worktrees',
            'feature',
          );
          await mkdir(cwd);
          const exec = promisify(execFile);
          if (mode === 'registered') {
            const source = path.join(base, 'source');
            await mkdir(source);
            const git = (args: string[]) =>
              exec('git', args, { cwd: source, windowsHide: true });
            await git(['init', '-b', 'main']);
            await git(['config', 'user.name', 'Fixture']);
            await git(['config', 'user.email', 'fixture@example.invalid']);
            await writeFile(path.join(source, 'ordinary.txt'), 'tracked');
            await git(['add', '.']);
            await git(['commit', '-m', 'fixture']);
            await git(['worktree', 'add', '-b', 'feature', resource]);
          } else {
            await mkdir(resource, { recursive: true });
            await exec('git', ['init', '-b', 'feature'], {
              cwd: resource,
              windowsHide: true,
            });
          }
          const target = path.join(resource, 'operator-state.json');
          await writeFile(target, 'operator-state');
          const paths = [cwd, resource, target, path.join(resource, '.git')];
          const original = await snapshotWindowsAcl(paths);
          const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(target)},'changed');fs.writeFileSync('launched','yes')`;
          const launch = () =>
            runContainedProcess(
              process.execPath,
              ['-e', script],
              mode === 'registered' ? resource : cwd,
              20000,
              10000,
              undefined,
              mode === 'registered' ? [] : [resource],
            );
          if (mode === 'registered') {
            const result = await launch();
            assert.equal(result.exitCode, 0, result.stderr);
            assert.equal(await readFile(target, 'utf8'), 'changed');
          } else {
            await assert.rejects(
              launch,
              /sandbox writable roots must not overlap protected metadata/,
            );
            await assert.rejects(() => readFile(path.join(cwd, 'launched')), {
              code: 'ENOENT',
            });
            assert.equal(await readFile(target, 'utf8'), 'operator-state');
          }
          assert.equal(await snapshotWindowsAcl(paths), original);
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows protects directly authorized hidden credential directories',
  { skip: process.platform !== 'win32' },
  async () => {
    for (const name of ['.credentials', '.secrets']) {
      const base = await mkdtemp(
        path.join(os.tmpdir(), 'autocode-hidden-root-'),
      );
      try {
        const cwd = path.join(base, 'cwd');
        const resource = path.join(base, name);
        await mkdir(cwd);
        await mkdir(resource);
        const target = path.join(resource, 'opaque.bin');
        await writeFile(target, 'operator-private-bytes');
        const paths = [cwd, resource, target];
        const original = await snapshotWindowsAcl(paths);
        const script = `const fs=require('node:fs');try{fs.readFileSync(${JSON.stringify(target)});throw Error('hidden credential root readable')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}fs.writeFileSync('ordinary.txt','allowed');console.log('hidden-root-protected')`;
        const result = await runContainedProcess(
          process.execPath,
          ['-e', script],
          cwd,
          15000,
          10000,
          undefined,
          [resource],
        );
        assert.equal(result.exitCode, 0, result.stderr);
        assert.match(result.stdout, /hidden-root-protected/);
        assert.equal(await snapshotWindowsAcl(paths), original);
        assert.equal(await readFile(target, 'utf8'), 'operator-private-bytes');
        assert.equal(
          await readFile(path.join(cwd, 'ordinary.txt'), 'utf8'),
          'allowed',
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    }
  },
);

test(
  'Windows refuses writable roots inside protected metadata before launch',
  { skip: process.platform !== 'win32' },
  async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-metadata-overlap-'),
    );
    try {
      const writable = path.join(cwd, '.autocode', 'cache');
      await mkdir(writable, { recursive: true });
      const original = await snapshotWindowsAcl([
        cwd,
        path.dirname(writable),
        writable,
      ]);
      await assert.rejects(
        () =>
          runContainedProcess(
            process.execPath,
            ['-e', "require('node:fs').writeFileSync('launched','bad')"],
            cwd,
            15000,
            10000,
            undefined,
            [writable],
          ),
        /writable roots must not overlap protected metadata/,
      );
      assert.equal(
        await snapshotWindowsAcl([cwd, path.dirname(writable), writable]),
        original,
      );
      await assert.rejects(() => readFile(path.join(cwd, 'launched')), {
        code: 'ENOENT',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test(
  'Windows normal and timeout cleanup preserve concurrent credential ACL hardening',
  { skip: process.platform !== 'win32' },
  async (t) => {
    for (const mode of ['normal', 'timeout'])
      await t.test(mode, async () => {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), 'autocode-concurrent-acl-'),
        );
        let pending: ReturnType<typeof runContainedProcess> | undefined;
        try {
          const target = path.join(directory, '.env');
          await writeFile(target, 'PRIVATE=synthetic-private');
          await editWindowsAcl(
            target,
            "$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'Read','Allow');$acl.AddAccessRule($rule)",
          );
          const ready = path.join(directory, 'ready');
          pending = runContainedProcess(
            process.execPath,
            [
              '-e',
              `const fs=require('node:fs');fs.writeFileSync('ready','ready');setInterval(()=>{if(fs.existsSync('finish'))process.exit(0)},10);`,
            ],
            directory,
            mode === 'timeout' ? 6000 : 15_000,
            10_000,
          );
          const deadline = Date.now() + 5000;
          while (true) {
            try {
              await readFile(ready);
              break;
            } catch {
              if (Date.now() >= deadline)
                throw new Error('contained ACL fixture did not start');
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
          }
          // This replacement is performed by the trusted operator while the command runs.
          await editWindowsAcl(
            target,
            "$acl.PurgeAccessRules([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'));$acl.SetAccessRuleProtection($true,$true)",
          );
          const hardened = await snapshotWindowsAcl([target]);
          if (mode === 'normal')
            await writeFile(path.join(directory, 'finish'), 'finish');
          const result = await pending;
          assert.equal(result.timedOut, mode === 'timeout');
          if (mode === 'normal')
            assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(
            await snapshotWindowsAcl([target]),
            hardened,
            'cleanup must preserve the operator replacement exactly',
          );
        } finally {
          await pending?.catch(() => {});
          await rm(directory, { recursive: true, force: true });
        }
      });
  },
);

test(
  'Windows sandbox rejects a helper inside an authorized writable directory',
  { skip: process.platform !== 'win32' },
  async () => {
    await assert.rejects(
      () =>
        runContainedProcess(
          process.execPath,
          ['-e', 'process.exit(0)'],
          os.tmpdir(),
          5000,
          1000,
        ),
      /helper must be outside every writable resource/,
    );
  },
);

test(
  'Windows AppContainer denies durable metadata writes before process exit',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-metadata-'),
    );
    try {
      await mkdir(path.join(directory, '.autocode'));
      await promisify(execFile)('git', ['init', '-b', 'main'], {
        cwd: directory,
        windowsHide: true,
      });
      await writeFile(
        path.join(directory, '.autocode', 'events.jsonl'),
        'trusted',
      );
      await writeFile(
        path.join(directory, '.git', 'HEAD'),
        'ref: refs/heads/main\n',
      );
      const snapshotAcl = () =>
        snapshotWindowsAcl([
          directory,
          path.join(directory, '.autocode'),
          path.join(directory, '.git'),
          path.join(directory, '.autocode', 'events.jsonl'),
          path.join(directory, '.git', 'HEAD'),
        ]);
      const originalAcl = await snapshotAcl();
      const result = await runContainedProcess(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs');
const attempts=[()=>fs.writeFileSync('.autocode/events.jsonl','forged'),()=>fs.writeFileSync('.autocode/completion.json','forged'),()=>fs.unlinkSync('.autocode/events.jsonl'),()=>fs.renameSync('.autocode','moved-state'),()=>fs.writeFileSync('.git/HEAD','forged'),()=>fs.renameSync('.git','moved-git')];
for(const [index,attempt] of attempts.entries()){try{attempt();console.error("allowed mutation",index);process.exit(9)}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error}}
fs.writeFileSync('result.txt','initial');fs.writeFileSync('result.txt',fs.readFileSync('result.txt','utf8')==='initial'?'good':'bad');console.log(fs.readFileSync('.autocode/events.jsonl','utf8'));`,
        ],
        directory,
        10_000,
        10_000,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(
        await snapshotAcl(),
        originalAcl,
        'metadata and worktree ACLs must be restored',
      );
      assert.match(result.stdout, /trusted/);
      assert.equal(
        await readFile(
          path.join(directory, '.autocode', 'events.jsonl'),
          'utf8',
        ),
        'trusted',
      );
      assert.equal(
        await readFile(path.join(directory, '.git', 'HEAD'), 'utf8'),
        'ref: refs/heads/main\n',
      );
      assert.equal(
        await readFile(path.join(directory, 'result.txt'), 'utf8'),
        'good',
      );
      await assert.rejects(
        () => readFile(path.join(directory, '.autocode', 'completion.json')),
        { code: 'ENOENT' },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows sandbox blocks credential files and inherited operator tokens',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-private-'),
    );
    const keys = [
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'OPENAI_API_KEY',
      'AUTOCODE_PRIVATE_UNKNOWN',
    ];
    const previous = keys.map((key) => process.env[key]);
    try {
      await promisify(execFile)('git', ['init', '-b', 'main'], {
        cwd: directory,
        windowsHide: true,
      });
      await writeFile(
        path.join(directory, '.gitignore'),
        '.env*\n*credentials*\n.npmrc\n.netrc\n_netrc\nauth.json\nid_rsa\n.pypirc\n.git-credentials\n*.pem\n.aws/\n.docker/\n',
      );
      await mkdir(path.join(directory, 'nested'));
      await mkdir(path.join(directory, '.aws'));
      await mkdir(path.join(directory, '.docker'));
      const credentialPaths = [
        '.env',
        '.credentials.json',
        'nested/service.credentials.json',
        '.npmrc',
        '.netrc',
        '_netrc',
        'nested/auth.json',
        'id_rsa',
        '.pypirc',
        '.git-credentials',
        'nested/private.pem',
        '.aws/config',
        '.docker/config.json',
      ];
      for (const credential of credentialPaths)
        await writeFile(
          path.join(directory, credential),
          credential === '.env'
            ? 'PRIVATE_VALUE=operator-private'
            : '{"private":"operator-private"}',
        );
      const paths = credentialPaths.map((credential) =>
        path.join(directory, credential),
      );
      const originalAcl = await snapshotWindowsAcl(paths);
      for (const key of keys)
        process.env[key] = 'operator-token-never-inherited';
      const run = await runContainedProcess(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs');for(const credential of ${JSON.stringify(credentialPaths)}){try{fs.readFileSync(credential);process.exit(9)}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error}}for(const key of ${JSON.stringify(keys)})if(process.env[key]!==undefined)process.exit(8);if(!process.env.SystemRoot||!process.env.PATH||!process.env.AUTOCODE_NODE)process.exit(7);fs.writeFileSync('ordinary.txt','good');console.log('private-boundary-passed');`,
        ],
        directory,
        10_000,
        10_000,
      );
      assert.equal(run.exitCode, 0, run.stderr);
      assert.equal(
        await snapshotWindowsAcl(paths),
        originalAcl,
        'credential ACLs must be restored exactly',
      );
      assert.match(run.stdout, /private-boundary-passed/);
      for (const credential of credentialPaths)
        assert.match(
          await readFile(path.join(directory, credential), 'utf8'),
          /operator-private/,
        );
      assert.equal(
        await readFile(path.join(directory, 'ordinary.txt'), 'utf8'),
        'good',
      );
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows AppContainer denies Task Scheduler brokers and ungranted files',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-broker-'));
    const vault = await mkdtemp(path.join(os.tmpdir(), 'autocode-vault-'));
    const scheduler = path.join(
      process.env.SystemRoot ?? 'C:/Windows',
      'System32',
      'schtasks.exe',
    );
    const taskName = 'autocode-sandbox-' + path.basename(directory);
    const exec = promisify(execFile);
    try {
      const secret = path.join(vault, 'secret.txt');
      await writeFile(secret, 'operator-private');
      const registration = await runContainedProcess(
        scheduler,
        [
          '/create',
          '/tn',
          taskName,
          '/sc',
          'once',
          '/st',
          '23:59',
          '/sd',
          '12/31/2099',
          '/tr',
          'cmd /c exit 0',
        ],
        directory,
        30000,
        100000,
      );
      assert.notEqual(registration.exitCode, 0, registration.stdout);
      await assert.rejects(
        exec(scheduler, ['/query', '/tn', taskName], { windowsHide: true }),
        /cannot find/i,
      );
      // An existing operator-owned task distinguishes denial from a missing task.
      const marker = path.join(vault, 'scheduler-marker.txt');
      const action = `cmd.exe /d /c echo harmless-control>"${marker}"`;
      await exec(
        scheduler,
        [
          '/create',
          '/tn',
          taskName,
          '/sc',
          'once',
          '/st',
          '23:59',
          '/sd',
          '12/31/2099',
          '/it',
          '/rl',
          'LIMITED',
          '/tr',
          action,
        ],
        { windowsHide: true },
      );
      const launch = await runContainedProcess(
        scheduler,
        ['/run', '/tn', taskName],
        directory,
        30000,
        100000,
      );
      assert.notEqual(launch.exitCode, 0, launch.stdout);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      // The same broker request from the trusted parent must actually run the task.
      await exec(scheduler, ['/run', '/tn', taskName], { windowsHide: true });
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await readFile(marker);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert.match(await readFile(marker, 'utf8'), /harmless-control/);
      const script = `const fs=require('node:fs');let privateRead;try{fs.readFileSync(${JSON.stringify(secret)});privateRead='allowed';}catch(e){privateRead=e.code;}fs.writeFileSync('ordinary-task.txt','allowed');console.log(JSON.stringify({privateRead,runtime:process.env.AUTOCODE_NODE}));`;
      const result = await runContainedProcess(
        process.execPath,
        ['-e', script],
        directory,
        15000,
        100000,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.match(output.privateRead, /EACCES|EPERM/);
      await assert.rejects(readFile(output.runtime), { code: 'ENOENT' });
      assert.equal(
        await readFile(path.join(directory, 'ordinary-task.txt'), 'utf8'),
        'allowed',
      );
    } finally {
      // Even an unexpectedly successful registration is removed by the trusted parent.
      await promisify(execFile)(scheduler, ['/delete', '/tn', taskName, '/f'], {
        windowsHide: true,
      }).catch(() => {});
      await rm(directory, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  },
);

test(
  'Windows batch commands preserve stdin and literal argv inside containment',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode batch&-'));
    const previous = process.env.AUTOCODE_BATCH_VALUE;
    process.env.AUTOCODE_BATCH_VALUE = 'must-not-expand';
    try {
      const bin = path.join(directory, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      const echo = path.join(directory, 'echo.mjs');
      await writeFile(
        echo,
        "let input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify({arguments:process.argv.slice(2),input}));",
      );
      const arguments_ = [
        'spaces é',
        'embedded "quotes"',
        'trailing\\',
        '%AUTOCODE_BATCH_VALUE%',
        '!AUTOCODE_BATCH_VALUE!',
        'a&b|c^d(e)<f>g;h,i',
        '" & echo injected > escaped.txt & "',
        '',
      ];
      const input = 'UTF-8 é prompt\n"%&^!"';
      for (const extension of ['cmd', 'bat'])
        await t.test(extension, async () => {
          const batch = path.join(
            extension === 'cmd' ? bin : directory,
            `fixture.${extension}`,
          );
          await writeFile(
            batch,
            `@echo off\r\n"%AUTOCODE_NODE%" "${echo}" %*\r\n`,
          );
          const result = await runContainedProcess(
            batch,
            arguments_,
            directory,
            10_000,
            100_000,
            input,
          );
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(JSON.parse(result.stdout), {
            arguments: arguments_,
            input,
          });
          await assert.rejects(
            () => readFile(path.join(directory, 'escaped.txt')),
            { code: 'ENOENT' },
          );
          for (const argument of ['line\nbreak', 'line\rbreak', '\0'])
            await assert.rejects(
              () =>
                runContainedProcess(batch, [argument], directory, 1000, 1024),
              /batch arguments cannot contain NUL or line breaks/,
            );
        });
    } finally {
      if (previous === undefined) delete process.env.AUTOCODE_BATCH_VALUE;
      else process.env.AUTOCODE_BATCH_VALUE = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('unsupported platforms cannot execute processes or accept workflow history', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autocode-platform-'));
  const marker = path.join(directory, 'executed');
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const platform of ['linux', 'darwin']) {
      await t.test(platform, async () => {
        Object.defineProperty(process, 'platform', {
          ...descriptor,
          value: platform,
        });
        try {
          const unavailable =
            /secure process containment is currently unavailable/;
          await assert.rejects(
            () =>
              createContainedQaAdapter(directory, {
                command: 'node',
                arguments: [],
              }).run(
                {
                  name: 'blocked',
                  description: 'Unsupported process containment.',
                },
                { sequence: 1 },
              ),
            unavailable,
          );
          await assert.rejects(
            () =>
              runContainedProcess(
                process.execPath,
                [
                  '-e',
                  `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`,
                ],
                directory,
                1000,
                1024,
              ),
            unavailable,
          );
          await assert.rejects(
            () => runProjectWorkflow(directory, { resumeOnly: true }),
            unavailable,
          );
          await assert.rejects(
            () =>
              runRoleSeparatedCodexSessions(directory, {
                command: process.execPath,
              }),
            unavailable,
          );
          await assert.rejects(
            () => runDeterministicVerification(directory),
            unavailable,
          );
          await assert.rejects(() => readFile(marker), { code: 'ENOENT' });
        } finally {
          Object.defineProperty(process, 'platform', descriptor);
        }
      });
    }
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'Windows QA job is terminated if its operator process dies',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-parent-'),
    );
    let worker: ReturnType<typeof spawn> | undefined;
    try {
      const ready = path.join(directory, 'ready'),
        trigger = path.join(directory, 'trigger'),
        escaped = path.join(directory, 'escaped');
      const child = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)}))fs.writeFileSync(${JSON.stringify(escaped)},'escaped');},10);`;
      const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();setInterval(()=>{},1000);`;
      const workerPath = path.join(directory, 'worker.mjs');
      await writeFile(
        workerPath,
        `import {createContainedQaAdapter} from ${JSON.stringify(new URL('./qa-process.ts', import.meta.url).href)};
await createContainedQaAdapter(${JSON.stringify(directory)},{command:'node',arguments:['-e',${JSON.stringify(script)}],timeoutMs:60_000}).run({name:'fixture',description:'Observe contained descendant lifetime.'},{sequence:1});`,
      );
      worker = spawn(process.execPath, ['--import', 'tsx', workerPath], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          await readFile(ready);
          break;
        } catch {
          if (Date.now() > deadline)
            throw new Error('QA descendant did not start');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const closed = new Promise((resolve) => worker!.once('close', resolve));
      worker.kill('SIGKILL');
      await closed;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await writeFile(trigger, 'trigger');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
    } finally {
      worker?.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('contained QA adapters reject unregistered callbacks and mismatched workspaces', () => {
  const root = process.cwd();
  assert.throws(
    () =>
      assertContainedQaAdapter(root, {
        async run() {
          return {};
        },
      }),
    /contained process adapter/,
  );
  const adapter = createContainedQaAdapter(root, {
    command: 'node',
    arguments: [],
  });
  assertContainedQaAdapter(root, adapter);
  assert.throws(
    () => assertContainedQaAdapter(path.join(root, 'other'), adapter),
    /contained process adapter/,
  );
  assert.equal(Object.isFrozen(adapter), true);
});

test(
  'Windows QA Job Object captures output and kills orphaned detached grandchildren',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-fixture-'),
    );
    try {
      const ready = path.join(directory, 'ready');
      const trigger = path.join(directory, 'trigger');
      const escaped = path.join(directory, 'escaped');
      const grandchild = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready + '.runtime')},process.env.AUTOCODE_NODE);fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)})){fs.writeFileSync(${JSON.stringify(escaped)},'escaped');process.exit(0);}},10);`;
      const intermediary = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();`;
      const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(intermediary)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(timer);console.log(JSON.stringify({kind:'passed',reason:'Observed contained fixture result.'}));}},10);`;
      const adapter = createContainedQaAdapter(directory, {
        command: 'node',
        arguments: ['-e', script],
        timeoutMs: 20_000,
      });
      const result = await adapter.run(
        {
          name: 'fixture',
          description: 'Exercise the contained process fixture.',
        },
        { sequence: 1 },
      );
      assert.deepEqual(result, {
        kind: 'passed',
        reason: 'Observed contained fixture result.',
      });
      assert.equal(await readFile(ready, 'utf8'), 'ready');
      await assert.rejects(
        readFile(await readFile(ready + '.runtime', 'utf8')),
        { code: 'ENOENT' },
      );
      await writeFile(trigger, 'trigger');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'Windows QA containment preserves argv and bounds timeout/output failures',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'autocode-qa-failures-'),
    );
    try {
      const argument = 'spaces é "quoted" and trailing\\';
      const echo = createContainedQaAdapter(directory, {
        command: 'node',
        arguments: [
          '-e',
          "console.log(JSON.stringify({kind:'passed',reason:process.argv[1]}))",
          argument,
        ],
      });
      assert.deepEqual(
        await echo.run(
          { name: 'argv', description: 'Check preserved process arguments.' },
          { sequence: 1 },
        ),
        { kind: 'passed', reason: argument },
      );
      for (const failure of ['timeout', 'overflow']) {
        await t.test(failure, async () => {
          const ready = path.join(directory, failure + '-ready');
          const trigger = path.join(directory, failure + '-trigger');
          const escaped = path.join(directory, failure + '-escaped');
          const child = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{if(fs.existsSync(${JSON.stringify(trigger)}))fs.writeFileSync(${JSON.stringify(escaped)},'escaped');},10);`;

          const script = `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(timer);${failure === 'overflow' ? "process.stdout.write('x'.repeat(64*1024));setInterval(()=>{},1000);" : 'setInterval(()=>{},1000);'}}},10);`;
          const adapter = createContainedQaAdapter(directory, {
            command: 'node',
            arguments: ['-e', script],
            timeoutMs: 8_000,
            maxOutputBytes: 1024,
          });
          await assert.rejects(
            () =>
              adapter.run(
                {
                  name: 'failure',
                  description: 'Check cleanup after contained process failure.',
                },
                { sequence: 1 },
              ),
            /contained QA process failed/,
          );
          assert.equal(await readFile(ready, 'utf8'), 'ready');
          await writeFile(trigger, 'trigger');
          await new Promise((resolve) => setTimeout(resolve, 200));
          await assert.rejects(() => readFile(escaped), { code: 'ENOENT' });
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
