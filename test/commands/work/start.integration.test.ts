import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createTempDir, type TempDir } from '../../utils/test-helpers.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliPath = join(repoRoot, 'src', 'cli.ts');
const tsxImport = import.meta.resolve('tsx');
const tempDirs: TempDir[] = [];

interface WorkStartFixture {
  callerPath: string;
  env: NodeJS.ProcessEnv;
  repoPath: string;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env });
  return stdout.trim();
}

async function createFixture(): Promise<WorkStartFixture> {
  const tempDir = await createTempDir('neo-work-start-');
  tempDirs.push(tempDir);

  const repoPath = join(tempDir.path, 'repo');
  const callerPath = join(repoPath, '.worktrees', 'caller');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    NO_COLOR: '1',
    TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[name];
  }

  await execa('git', ['init', '--initial-branch=main', repoPath], { env });
  await git(repoPath, ['config', 'user.name', 'Neo Test'], env);
  await git(repoPath, ['config', 'user.email', 'neo@example.com'], env);
  await writeFile(join(repoPath, '.gitignore'), '.worktrees/\n');
  await writeFile(join(repoPath, 'initial.txt'), 'initial\n');
  await git(repoPath, ['add', '.gitignore', 'initial.txt'], env);
  await git(repoPath, ['commit', '-m', 'initial'], env);
  await mkdir(join(repoPath, '.worktrees'));
  await git(repoPath, ['worktree', 'add', '-b', 'caller', callerPath, 'main'], env);

  return { callerPath, env, repoPath };
}

async function runStart(cwd: string, env: NodeJS.ProcessEnv) {
  const { stdout } = await execa(
    process.execPath,
    [
      '--import',
      tsxImport,
      cliPath,
      'work',
      'start',
      'child',
      '--no-prefix',
      '--from',
      'main',
      '--worktree',
      '--json',
      '--yes',
    ],
    { cwd, env }
  );
  return JSON.parse(stdout) as { branch: string; worktreePath: string };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => tempDir.cleanup()));
});

describe.skipIf(process.platform === 'win32')('work start worktree integration', () => {
  it('creates a sibling worktree under the primary checkout', async () => {
    const fixture = await createFixture();
    const primaryPath = await realpath(fixture.repoPath);
    const expectedPath = join(primaryPath, '.worktrees', 'child');
    const nestedPath = join(fixture.callerPath, '.worktrees', 'child');

    const result = await runStart(fixture.callerPath, fixture.env);

    expect(result).toMatchObject({ branch: 'child', worktreePath: expectedPath });
    await expect(access(expectedPath)).resolves.toBeUndefined();
    await expect(access(nestedPath)).rejects.toThrow();
    expect(await git(expectedPath, ['branch', '--show-current'], fixture.env)).toBe('child');
    expect(await git(fixture.repoPath, ['worktree', 'list', '--porcelain'], fixture.env)).toContain(
      `worktree ${expectedPath}`
    );
  }, 30_000);
});
