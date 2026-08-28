import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import packageJson from '../../package.json' with { type: 'json' };

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const tempPrefixes: string[] = [];

describe.skipIf(process.platform === 'win32')('npm bin launcher', () => {
  beforeAll(async () => {
    await execa('pnpm', ['run', 'build'], { cwd: repoRoot });
  }, 30_000);

  afterEach(async () => {
    await Promise.all(
      tempPrefixes.splice(0).map((prefix) => rm(prefix, { recursive: true, force: true }))
    );
  });

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
