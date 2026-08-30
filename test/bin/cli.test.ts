import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import packageJson from '../../package.json' with { type: 'json' };

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const tempPrefixes: string[] = [];

beforeAll(async () => {
  await execa('pnpm', ['run', 'build'], { cwd: repoRoot });
}, 30_000);

afterEach(async () => {
  await Promise.all(
    tempPrefixes.splice(0).map((prefix) => rm(prefix, { recursive: true, force: true }))
  );
});

describe.skipIf(process.platform === 'win32')('npm bin launcher', () => {
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
