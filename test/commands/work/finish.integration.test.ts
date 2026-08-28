import { afterEach, describe, expect, it } from 'vitest';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createTempDir, type TempDir } from '../../utils/test-helpers.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliPath = join(repoRoot, 'src', 'cli.ts');
const tsxImport = import.meta.resolve('tsx');
const tempDirs: TempDir[] = [];

interface WorkFinishFixture {
  env: NodeJS.ProcessEnv;
  featureCommit: string;
  featurePath: string;
  initialCommit: string;
  repoPath: string;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env });
  return stdout.trim();
}

async function createFixture(): Promise<WorkFinishFixture> {
  const tempDir = await createTempDir('neo-work-finish-');
  tempDirs.push(tempDir);

  const remotePath = join(tempDir.path, 'origin.git');
  const repoPath = join(tempDir.path, 'repo');
  const fakeBinPath = join(tempDir.path, 'bin');
  const featurePath = join(repoPath, '.worktrees', 'finished');

  await mkdir(fakeBinPath);
  const ghPath = join(fakeBinPath, 'gh');
  await writeFile(ghPath, '#!/bin/sh\nexit 1\n');
  await chmod(ghPath, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    NO_COLOR: '1',
    PATH: `${fakeBinPath}${delimiter}${process.env['PATH'] ?? ''}`,
    TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[name];
  }

  await execa('git', ['init', '--bare', '--initial-branch=main', remotePath], { env });
  await execa('git', ['clone', remotePath, repoPath], { env });
  await git(repoPath, ['config', 'user.name', 'Neo Test'], env);
  await git(repoPath, ['config', 'user.email', 'neo@example.com'], env);

  await writeFile(join(repoPath, '.gitignore'), '.worktrees/\n');
  await writeFile(join(repoPath, 'initial.txt'), 'initial\n');
  await git(repoPath, ['add', '.gitignore', 'initial.txt'], env);
  await git(repoPath, ['commit', '-m', 'initial'], env);
  await git(repoPath, ['push', '--set-upstream', 'origin', 'main'], env);
  const initialCommit = await git(repoPath, ['rev-parse', 'HEAD'], env);

  await mkdir(join(repoPath, '.worktrees'));
  await git(repoPath, ['worktree', 'add', '-b', 'jacek/finished', featurePath, 'main'], env);
  await writeFile(join(featurePath, 'feature.txt'), 'feature\n');
  await git(featurePath, ['add', 'feature.txt'], env);
  await git(featurePath, ['commit', '-m', 'feature'], env);
  const featureCommit = await git(featurePath, ['rev-parse', 'HEAD'], env);
  await git(featurePath, ['push', 'origin', 'HEAD:main'], env);
  await git(repoPath, ['fetch', 'origin'], env);

  return { env, featureCommit, featurePath, initialCommit, repoPath };
}

async function runFinish(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const { stdout } = await execa(
    process.execPath,
    ['--import', tsxImport, cliPath, 'work', 'finish', ...args, '--json', '--yes'],
    { cwd, env }
  );
  return JSON.parse(stdout) as {
    branchDeleted: boolean;
    pulled: boolean;
    worktreeRemoved: boolean;
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => tempDir.cleanup()));
});

describe.skipIf(process.platform === 'win32')('work finish worktree integration', () => {
  it('updates the base in its primary worktree before removing the caller worktree', async () => {
    const fixture = await createFixture();

    const result = await runFinish(fixture.featurePath, ['--base', 'main'], fixture.env);

    expect(result).toMatchObject({
      branchDeleted: true,
      pulled: true,
      worktreeRemoved: true,
    });
    expect(await git(fixture.repoPath, ['branch', '--show-current'], fixture.env)).toBe('main');
    expect(await git(fixture.repoPath, ['rev-parse', 'main'], fixture.env)).toBe(
      fixture.featureCommit
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'origin/main'], fixture.env)).toBe(
      fixture.featureCommit
    );
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
    expect(
      await git(fixture.repoPath, ['worktree', 'list', '--porcelain'], fixture.env)
    ).not.toContain(fixture.featurePath);
    await expect(access(fixture.featurePath)).rejects.toThrow();
    await expect(
      execa('git', ['show-ref', '--verify', '--quiet', 'refs/heads/jacek/finished'], {
        cwd: fixture.repoPath,
        env: fixture.env,
      })
    ).rejects.toThrow();
  }, 30_000);

  it('discards dirty tracked changes in the primary worktree when forced', async () => {
    const fixture = await createFixture();
    await git(fixture.repoPath, ['worktree', 'remove', fixture.featurePath], fixture.env);
    await git(fixture.repoPath, ['switch', 'jacek/finished'], fixture.env);
    await writeFile(join(fixture.repoPath, 'initial.txt'), 'dirty\n');

    const result = await runFinish(fixture.repoPath, ['--base', 'main', '--force'], fixture.env);

    expect(result).toMatchObject({
      branchDeleted: true,
      pulled: true,
      worktreeRemoved: false,
    });
    expect(await git(fixture.repoPath, ['branch', '--show-current'], fixture.env)).toBe('main');
    expect(await readFile(join(fixture.repoPath, 'initial.txt'), 'utf8')).toBe('initial\n');
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
  }, 30_000);

  it('does not pull the base into an unrelated caller branch', async () => {
    const fixture = await createFixture();
    await git(
      fixture.repoPath,
      ['switch', '-c', 'jacek/caller', fixture.initialCommit],
      fixture.env
    );

    const result = await runFinish(
      fixture.repoPath,
      ['jacek/finished', '--base', 'main'],
      fixture.env
    );

    expect(result).toMatchObject({
      branchDeleted: true,
      pulled: false,
      worktreeRemoved: true,
    });
    expect(await git(fixture.repoPath, ['branch', '--show-current'], fixture.env)).toBe(
      'jacek/caller'
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env)).toBe(
      fixture.initialCommit
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'main'], fixture.env)).toBe(
      fixture.initialCommit
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'origin/main'], fixture.env)).toBe(
      fixture.featureCommit
    );
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
    expect(
      await git(fixture.repoPath, ['worktree', 'list', '--porcelain'], fixture.env)
    ).not.toContain(fixture.featurePath);
    await expect(access(fixture.featurePath)).rejects.toThrow();
  }, 30_000);

  it('preserves a dirty target worktree when invoked from another branch', async () => {
    const fixture = await createFixture();
    await git(
      fixture.repoPath,
      ['switch', '-c', 'jacek/caller', fixture.initialCommit],
      fixture.env
    );
    await writeFile(join(fixture.featurePath, 'uncommitted.txt'), 'keep me\n');

    await expect(
      runFinish(fixture.repoPath, ['jacek/finished', '--base', 'main'], fixture.env)
    ).rejects.toThrow(/uncommitted changes/);

    await expect(access(fixture.featurePath)).resolves.toBeUndefined();
    expect(await git(fixture.featurePath, ['status', '--porcelain'], fixture.env)).toContain(
      'uncommitted.txt'
    );
    expect(
      await git(
        fixture.repoPath,
        ['show-ref', '--verify', 'refs/heads/jacek/finished'],
        fixture.env
      )
    ).not.toBe('');
    expect(await git(fixture.repoPath, ['branch', '--show-current'], fixture.env)).toBe(
      'jacek/caller'
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env)).toBe(
      fixture.initialCommit
    );
  }, 30_000);
});
