import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = join(repoRoot, 'src', 'cli.ts');
const tsxImport = import.meta.resolve('tsx');
const tempDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
}

async function createRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'neo-commit-all-'));
  tempDirs.push(cwd);
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.name', 'Neo Test']);
  await git(cwd, ['config', 'user.email', 'neo-test@example.com']);
  await git(cwd, ['config', 'commit.gpgsign', 'false']);
  return cwd;
}

async function commitAll(cwd: string, message: string): Promise<Record<string, unknown>> {
  const { stdout } = await execa(
    process.execPath,
    [
      '--import',
      tsxImport,
      cliPath,
      'git',
      'commit',
      '--all',
      '--type',
      'test',
      '--message',
      message,
      '--no-verify',
      '--json',
    ],
    {
      cwd,
      env: { TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json') },
    }
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function committedFiles(cwd: string): Promise<string[]> {
  return (await git(cwd, ['show', '--pretty=format:', '--name-only', 'HEAD']))
    .split('\n')
    .filter(Boolean)
    .sort();
}

describe('git commit --all', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('commits tracked edits and untracked files', async () => {
    const cwd = await createRepo();
    await writeFile(join(cwd, 'tracked.txt'), 'before\n');
    await git(cwd, ['add', 'tracked.txt']);
    await git(cwd, ['commit', '-n', '-m', 'test: baseline']);

    await writeFile(join(cwd, 'tracked.txt'), 'after\n');
    await writeFile(join(cwd, 'untracked.txt'), 'new\n');

    const payload = await commitAll(cwd, 'include every change');
    expect(payload).toMatchObject({
      ok: true,
      command: 'git.commit',
      files: ['tracked.txt', 'untracked.txt'],
    });

    expect(await committedFiles(cwd)).toEqual(['tracked.txt', 'untracked.txt']);
    expect(await git(cwd, ['status', '--porcelain'])).toBe('');
  });

  it('commits an untracked-only repository state', async () => {
    const cwd = await createRepo();
    await writeFile(join(cwd, 'untracked.txt'), 'new\n');

    const payload = await commitAll(cwd, 'include new file');
    expect(payload).toMatchObject({
      ok: true,
      files: ['untracked.txt'],
    });

    expect(await committedFiles(cwd)).toEqual(['untracked.txt']);
    expect(await git(cwd, ['status', '--porcelain'])).toBe('');
  });
});
