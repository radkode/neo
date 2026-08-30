import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createTempDir, type TempDir } from '../../utils/test-helpers.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliPath = join(repoRoot, 'src', 'cli.ts');
const tsxImport = import.meta.resolve('tsx');
const tempDirs: TempDir[] = [];

interface PullFixture {
  aheadCommit: string;
  env: NodeJS.ProcessEnv;
  remoteCommit: string;
  remotePath: string;
  repoPath: string;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env });
  return stdout.trim();
}

async function createFixture(): Promise<PullFixture> {
  const tempDir = await createTempDir('neo-git-pull-');
  tempDirs.push(tempDir);

  const remotePath = join(tempDir.path, 'origin.git');
  const repoPath = join(tempDir.path, 'repo');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    NO_COLOR: '1',
    TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[name];
  }

  await execa('git', ['init', '--bare', '--initial-branch=remote-base', remotePath], { env });
  await execa('git', ['clone', remotePath, repoPath], { env });
  await git(repoPath, ['config', 'user.name', 'Neo Test'], env);
  await git(repoPath, ['config', 'user.email', 'neo@example.com'], env);
  await git(repoPath, ['commit', '--allow-empty', '-m', 'initial'], env);
  await git(repoPath, ['push', '--set-upstream', 'origin', 'remote-base'], env);
  await git(repoPath, ['switch', '-c', 'local-feature', '--track', 'origin/remote-base'], env);
  await git(repoPath, ['commit', '--allow-empty', '-m', 'local ahead'], env);
  await rm(join(repoPath, '.git', 'FETCH_HEAD'), { force: true });

  return {
    aheadCommit: await git(repoPath, ['rev-parse', 'HEAD'], env),
    env,
    remoteCommit: await git(remotePath, ['rev-parse', 'refs/heads/remote-base'], env),
    remotePath,
    repoPath,
  };
}

async function runPull(cwd: string, env: NodeJS.ProcessEnv) {
  const { stdout } = await execa(
    process.execPath,
    ['--import', tsxImport, cliPath, 'git', 'pull', '--rebase', '--json', '--yes'],
    { cwd, env }
  );
  return JSON.parse(stdout) as { command: string; ok: boolean };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => tempDir.cleanup()));
});

describe.skipIf(process.platform === 'win32')('git pull integration', () => {
  it('keeps a clean ahead branch that tracks a differently named upstream', async () => {
    const fixture = await createFixture();

    const result = await runPull(fixture.repoPath, fixture.env);

    expect(result).toEqual({ command: 'git.pull', ok: true });
    const fetchHead = await readFile(join(fixture.repoPath, '.git', 'FETCH_HEAD'), 'utf8');
    expect(fetchHead).toContain(fixture.remoteCommit);
    expect(fetchHead).toContain("branch 'remote-base'");
    expect(await git(fixture.repoPath, ['branch', '--show-current'], fixture.env)).toBe(
      'local-feature'
    );
    expect(await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env)).toBe(
      fixture.aheadCommit
    );
    expect(await git(fixture.repoPath, ['rev-parse', '--abbrev-ref', '@{u}'], fixture.env)).toBe(
      'origin/remote-base'
    );
    expect(await git(fixture.repoPath, ['rev-list', '--count', '@{u}..HEAD'], fixture.env)).toBe(
      '1'
    );
    expect(await git(fixture.repoPath, ['rev-list', '--count', 'HEAD..@{u}'], fixture.env)).toBe(
      '0'
    );
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
    expect(
      await git(fixture.remotePath, ['rev-parse', 'refs/heads/remote-base'], fixture.env)
    ).toBe(fixture.remoteCommit);

    const localRemoteBranch = await execa(
      'git',
      ['show-ref', '--verify', '--quiet', 'refs/heads/local-feature'],
      { cwd: fixture.remotePath, env: fixture.env, reject: false }
    );
    expect(localRemoteBranch.exitCode).toBe(1);
  }, 30_000);
});
