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
  it('starts Neo through an npm-style symlink', async () => {
    const prefix = await mkdtemp(join(tmpdir(), 'neo-npm-bin-'));
    tempPrefixes.push(prefix);

    const binDir = join(prefix, 'bin');
    await mkdir(binDir);

    const launcher = join(binDir, 'neo');
    await symlink(join(repoRoot, 'bin', 'cli.js'), launcher);

    const { stdout } = await execa(launcher, ['--version']);

    expect(stdout).toBe(packageJson.version);
  });
});

describe('CLI entrypoint', () => {
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
