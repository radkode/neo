import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import packageJson from '../../package.json' with { type: 'json' };

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const tempPrefixes: string[] = [];

async function listArchiveDirs(packageDir: string): Promise<string[]> {
  return (await readdir(packageDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('package-'))
    .map((entry) => entry.name);
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForEntry(dir: string, prefix: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      if ((await readdir(dir)).some((entry) => entry.startsWith(prefix))) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${prefix} in ${dir}`);
}

beforeAll(async () => {
  await execa('pnpm', ['run', 'build'], { cwd: repoRoot });
}, 30_000);

afterEach(async () => {
  await Promise.all(
    tempPrefixes.splice(0).map((prefix) => rm(prefix, { recursive: true, force: true }))
  );
});

describe.skipIf(process.platform === 'win32')('CLI launchers', () => {
  it('starts Neo through npm and module symlinks', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'neo npm bin '));
    tempPrefixes.push(prefix);

    const binDir = join(prefix, 'bin');
    await mkdir(binDir);

    const launcher = join(binDir, 'neo');
    await symlink(join(repoRoot, 'bin', 'cli.js'), launcher);
    const moduleLauncher = join(prefix, 'neo cli.js');
    await symlink(join(repoRoot, 'dist', 'cli.js'), moduleLauncher);

    const [binResult, moduleResult] = await Promise.all([
      execa(launcher, ['--version'], { reject: false }),
      execa(process.execPath, [moduleLauncher, '--version'], { reject: false }),
    ]);

    for (const result of [binResult, moduleResult]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(packageJson.version);
      expect(result.stderr).toBe('');
    }
  });

  it('keeps the global launcher after its source checkout is removed', async () => {
    const prefix = await realpath(await mkdtemp(join(tmpdir(), 'neo-pnpm-global-')));
    tempPrefixes.push(prefix);

    const legacySourceDir = join(prefix, 'legacy-source');
    const legacySourceBin = join(legacySourceDir, 'bin', 'cli.js');
    const sourceDir = join(prefix, 'source');
    const sourceBin = join(sourceDir, 'bin', 'cli.js');
    const pnpmHome = join(prefix, 'pnpm');
    const globalBinDir = join(pnpmHome, 'bin');
    await mkdir(join(legacySourceDir, 'bin'), { recursive: true });
    await mkdir(join(sourceDir, 'bin'), { recursive: true });
    await mkdir(join(sourceDir, 'scripts'), { recursive: true });
    await mkdir(globalBinDir, { recursive: true });
    await copyFile(
      join(repoRoot, 'scripts', 'link-local.mjs'),
      join(sourceDir, 'scripts', 'link-local.mjs')
    );
    await writeFile(
      join(sourceDir, 'package.json'),
      JSON.stringify({
        name: '@radkode/neo',
        version: '1.0.0',
        type: 'module',
        packageManager: packageJson.packageManager,
        bin: { neo: './bin/cli.js' },
        files: ['bin'],
        scripts: {
          build: 'node -e ""',
          'link-local': packageJson.scripts['link-local'],
        },
      })
    );
    await writeFile(sourceBin, "#!/usr/bin/env node\nconsole.log('first build');\n");
    await chmod(sourceBin, 0o755);
    await writeFile(
      join(legacySourceDir, 'package.json'),
      JSON.stringify({
        name: '@radkode/neo',
        version: '1.0.0',
        type: 'module',
        packageManager: packageJson.packageManager,
        bin: { neo: './bin/cli.js' },
        files: ['bin'],
      })
    );
    await writeFile(legacySourceBin, "#!/usr/bin/env node\nconsole.log('first build');\n");
    await chmod(legacySourceBin, 0o755);

    const env = {
      ...process.env,
      PATH: `${globalBinDir}${delimiter}${pnpmHome}${delimiter}${process.env['PATH'] ?? ''}`,
      PNPM_HOME: pnpmHome,
    };
    await execa('pnpm', ['add', '--global', '.'], { cwd: legacySourceDir, env });
    const { stdout: globalBinOutput } = await execa('pnpm', ['bin', '--global'], {
      cwd: sourceDir,
      env,
    });
    const launcher = join(globalBinOutput.split(/\r?\n/).at(-1)!, 'neo');
    await access(launcher);
    expect((await execa(launcher, [], { env })).stdout).toBe('first build');

    await rm(legacySourceDir, { recursive: true, force: true });
    const brokenLauncher = await execa(launcher, [], { env, reject: false });
    expect(brokenLauncher.exitCode).not.toBe(0);
    expect(`${brokenLauncher.stdout}\n${brokenLauncher.stderr}`).toContain('MODULE_NOT_FOUND');

    await execa('pnpm', ['run', 'link-local'], { cwd: sourceDir, env });
    const { stdout: globalRootOutput } = await execa('pnpm', ['root', '--global'], {
      cwd: sourceDir,
      env,
    });
    const globalRoot = globalRootOutput.split(/\r?\n/).at(-1)!;
    const globalProjectDir =
      basename(globalRoot) === 'node_modules' ? dirname(globalRoot) : globalRoot;
    const localPackagesDir = join(
      dirname(globalProjectDir),
      '.link-local-packages',
      encodeURIComponent('@radkode/neo')
    );
    const lockDir = join(localPackagesDir, '.lock');
    const firstArchiveDirs = await listArchiveDirs(localPackagesDir);
    expect(firstArchiveDirs).toHaveLength(1);
    const firstArchiveDir = join(localPackagesDir, firstArchiveDirs[0]!);
    const firstArchives = (await readdir(firstArchiveDir)).filter((entry) =>
      entry.endsWith('.tgz')
    );
    expect(firstArchives).toHaveLength(1);
    const firstArchive = join(firstArchiveDir, firstArchives[0]!);
    await expect(access(firstArchive)).resolves.toBeUndefined();

    expect((await execa(launcher, [], { env })).stdout).toBe('first build');

    const replacementBin = join(sourceDir, 'bin', 'replacement.js');
    await writeFile(replacementBin, "#!/usr/bin/env node\nconsole.log('second build');\n");
    await chmod(replacementBin, 0o755);
    await rename(replacementBin, sourceBin);
    expect((await execa(launcher, [], { env })).stdout).toBe('first build');

    const fakeBinDir = join(prefix, 'fake-bin');
    const fakePnpm = join(fakeBinDir, 'pnpm.cjs');
    const failedAddArgsPath = join(prefix, 'failed-add-args.json');
    const { stdout: pnpmPath } = await execa('which', ['pnpm']);
    await mkdir(fakeBinDir);
    await writeFile(
      fakePnpm,
      `const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'add' && args[1] === '--global') {
  writeFileSync(${JSON.stringify(failedAddArgsPath)}, JSON.stringify(args));
  process.exit(86);
}
const result = spawnSync(${JSON.stringify(pnpmPath)}, args, { env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`
    );
    const helperEnv: NodeJS.ProcessEnv = {
      ...env,
      PATH: `${fakeBinDir}${delimiter}${env.PATH}`,
      npm_config_user_agent: 'pnpm/test',
      npm_execpath: fakePnpm,
    };
    await rm(firstArchiveDir, { recursive: true, force: true });
    expect((await execa(launcher, [], { env })).stdout).toBe('first build');
    const failedInstall = await execa(
      process.execPath,
      [join(sourceDir, 'scripts', 'link-local.mjs')],
      {
        cwd: sourceDir,
        env: helperEnv,
        reject: false,
      }
    );
    expect(failedInstall.exitCode).toBe(1);
    expect(failedInstall.stderr).toContain('exited with code 86');
    const failedAddArgs = JSON.parse(await readFile(failedAddArgsPath, 'utf8')) as string[];
    expect(failedAddArgs.slice(0, 2)).toEqual(['add', '--global']);
    expect(
      failedAddArgs[2]?.startsWith(`@radkode/neo@file:${join(localPackagesDir, 'package-')}`)
    ).toBe(true);
    expect(failedAddArgs[2]?.endsWith('.tgz')).toBe(true);
    expect(await listArchiveDirs(localPackagesDir)).toEqual([]);
    await expect(access(firstArchive)).rejects.toThrow();
    await expect(access(lockDir)).rejects.toThrow();
    expect((await execa(launcher, [], { env })).stdout).toBe('first build');

    const packClaimDir = join(prefix, 'pack-claimed');
    const packEntered = join(prefix, 'pack-entered');
    const releasePack = join(prefix, 'release-pack');
    await writeFile(
      fakePnpm,
      `const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'pack') {
  try {
    mkdirSync(${JSON.stringify(packClaimDir)});
    writeFileSync(${JSON.stringify(packEntered)}, '');
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(${JSON.stringify(releasePack)})) Atomics.wait(waiter, 0, 0, 20);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
const result = spawnSync(${JSON.stringify(pnpmPath)}, args, { env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`
    );
    await rm(firstArchiveDir, { recursive: true, force: true });
    expect((await execa(launcher, [], { env })).stdout).toBe('first build');

    const exitedProcess = execa(process.execPath, ['-e', '']);
    const deadPid = exitedProcess.pid;
    await exitedProcess;
    if (deadPid === undefined) {
      throw new Error('Failed to capture the exited process ID');
    }
    await mkdir(lockDir);
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid, token: 'stale' }));

    const installsInFlight = [
      execa(process.execPath, [join(sourceDir, 'scripts', 'link-local.mjs')], {
        cwd: sourceDir,
        env: helperEnv,
      }),
    ];
    let installs: PromiseSettledResult<unknown>[];
    try {
      await waitForFile(packEntered);
      installsInFlight.push(
        execa(process.execPath, [join(sourceDir, 'scripts', 'link-local.mjs')], {
          cwd: sourceDir,
          env: helperEnv,
        })
      );
      await waitForEntry(localPackagesDir, '.lock-candidate-');
    } finally {
      try {
        await writeFile(releasePack, '');
      } finally {
        installs = await Promise.allSettled(installsInFlight);
      }
    }
    const installFailures = installs
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason));
    expect(
      installs.map((result) => result.status),
      installFailures.join('\n')
    ).toEqual(['fulfilled', 'fulfilled']);
    const lockArtifacts = (await readdir(localPackagesDir)).filter((entry) =>
      entry.startsWith('.lock')
    );
    expect(lockArtifacts).toEqual(['.lock-abandoned-stale']);
    expect((await execa(launcher, [], { env })).stdout).toBe('second build');
    const secondArchiveDirs = await listArchiveDirs(localPackagesDir);
    expect(secondArchiveDirs).toHaveLength(1);
    expect(secondArchiveDirs[0]).not.toBe(firstArchiveDirs[0]);
    await expect(access(firstArchive)).rejects.toThrow();
    const activeArchiveDir = join(localPackagesDir, secondArchiveDirs[0]!);
    const activeArchives = (await readdir(activeArchiveDir)).filter((entry) =>
      entry.endsWith('.tgz')
    );
    expect(activeArchives).toHaveLength(1);
    const activeArchive = join(activeArchiveDir, activeArchives[0]!);

    const shim = await readFile(launcher, 'utf8');
    expect(shim).not.toContain(sourceDir);

    await rm(sourceDir, { recursive: true, force: true });
    await expect(access(activeArchive)).resolves.toBeUndefined();
    expect((await execa(launcher, [], { env })).stdout).toBe('second build');
  }, 60_000);
});

describe('CLI entrypoint', () => {
  it('stays inert when the package entry is imported', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'neo consumer '));
    tempPrefixes.push(prefix);

    const packageScopePath = join(prefix, 'node_modules', '@radkode');
    await mkdir(packageScopePath, { recursive: true });
    await symlink(
      repoRoot,
      join(packageScopePath, 'neo'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const consumerPath = join(prefix, 'consumer-cli.js');
    await writeFile(join(prefix, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(consumerPath, "import '@radkode/neo';\n\nconsole.log('CONSUMER_IMPORT_OK');\n");

    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env['FORCE_COLOR'];
    const [consumer, stdinConsumer, directModule, binModule] = await Promise.all([
      execa(process.execPath, [consumerPath, '--version'], {
        cwd: prefix,
        env,
        extendEnv: false,
        reject: false,
      }),
      execa(process.execPath, ['--input-type=module', '-'], {
        cwd: prefix,
        env,
        extendEnv: false,
        input: "await import('@radkode/neo');\nconsole.log('STDIN_IMPORT_OK');\n",
        reject: false,
      }),
      execa(process.execPath, [join(repoRoot, 'dist', 'cli.js'), '--version'], {
        env,
        extendEnv: false,
        reject: false,
      }),
      execa(process.execPath, [join(repoRoot, 'bin', 'cli.js'), '--version'], {
        env,
        extendEnv: false,
        reject: false,
      }),
    ]);

    expect(consumer.exitCode).toBe(0);
    expect(consumer.stdout).toBe('CONSUMER_IMPORT_OK');
    expect(consumer.stderr).toBe('');
    expect(stdinConsumer.exitCode).toBe(0);
    expect(stdinConsumer.stdout).toBe('STDIN_IMPORT_OK');
    expect(stdinConsumer.stderr).toBe('');
    for (const result of [directModule, binModule]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(packageJson.version);
      expect(result.stderr).toBe('');
    }
  });

  it('routes rejected async hooks through the CLI error handler', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'neo-async-hook-'));
    tempPrefixes.push(prefix);

    const preloadPath = join(prefix, 'reject-hook.mjs');
    const commanderImport = import.meta.resolve('@commander-js/extra-typings');
    await writeFile(
      preloadPath,
      `import { Command } from ${JSON.stringify(commanderImport)};

const installFailure = (command) => {
  command.hook('preAction', async () => {
    throw new Error('ASYNC_HOOK_FAILURE');
  });
};

for (const method of ['parse', 'parseAsync']) {
  const original = Command.prototype[method];
  Command.prototype[method] = function (...args) {
    installFailure(this);
    return original.apply(this, args);
  };
}
`
    );

    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env['FORCE_COLOR'];
    const result = await execa(
      process.execPath,
      [
        '--import',
        pathToFileURL(preloadPath).href,
        join(repoRoot, 'bin', 'cli.js'),
        '--no-color',
        '--no-banner',
        '--quiet',
        'schema',
      ],
      {
        env,
        extendEnv: false,
        reject: false,
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('✖ ASYNC_HOOK_FAILURE');
  });
});
