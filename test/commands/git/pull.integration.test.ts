import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

interface FixtureOptions {
  localAhead?: boolean;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execa('git', args, { cwd, env });
  return stdout.trim();
}

async function createFixture(options: FixtureOptions = {}): Promise<PullFixture> {
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
    LANG: 'C',
    LC_ALL: 'C',
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
  if (options.localAhead !== false) {
    await git(repoPath, ['commit', '--allow-empty', '-m', 'local ahead'], env);
  }
  await rm(join(repoPath, '.git', 'FETCH_HEAD'), { force: true });

  return {
    aheadCommit: await git(repoPath, ['rev-parse', 'HEAD'], env),
    env,
    remoteCommit: await git(remotePath, ['rev-parse', 'refs/heads/remote-base'], env),
    remotePath,
    repoPath,
  };
}

async function createPublisher(fixture: PullFixture): Promise<string> {
  const publisherPath = join(dirname(fixture.repoPath), 'publisher');
  await execa('git', ['clone', fixture.remotePath, publisherPath], { env: fixture.env });
  await git(publisherPath, ['config', 'user.name', 'Neo Test'], fixture.env);
  await git(publisherPath, ['config', 'user.email', 'neo@example.com'], fixture.env);
  return publisherPath;
}

async function createDivergedRemote(fixture: PullFixture) {
  const publisherPath = await createPublisher(fixture);
  await git(publisherPath, ['commit', '--allow-empty', '-m', 'remote ahead'], fixture.env);
  await git(publisherPath, ['push', 'origin', 'remote-base'], fixture.env);
  const upstreamCommit = await git(publisherPath, ['rev-parse', 'HEAD'], fixture.env);

  await git(publisherPath, ['switch', '-c', 'local-feature', fixture.remoteCommit], fixture.env);
  await git(publisherPath, ['commit', '--allow-empty', '-m', 'decoy branch'], fixture.env);
  await git(publisherPath, ['push', 'origin', 'local-feature'], fixture.env);

  return {
    decoyCommit: await git(publisherPath, ['rev-parse', 'HEAD'], fixture.env),
    upstreamCommit,
  };
}

async function createMultipleRemoteHeads(fixture: PullFixture) {
  const publisherPath = await createPublisher(fixture);
  await git(publisherPath, ['commit', '--allow-empty', '-m', 'first upstream'], fixture.env);
  await git(publisherPath, ['push', 'origin', 'remote-base'], fixture.env);
  const firstCommit = await git(publisherPath, ['rev-parse', 'HEAD'], fixture.env);

  await git(publisherPath, ['switch', '-c', 'other-head', fixture.remoteCommit], fixture.env);
  await git(publisherPath, ['commit', '--allow-empty', '-m', 'second upstream'], fixture.env);
  await git(publisherPath, ['push', 'origin', 'other-head'], fixture.env);

  return {
    firstCommit,
    secondCommit: await git(publisherPath, ['rev-parse', 'HEAD'], fixture.env),
  };
}

async function runPull(cwd: string, env: NodeJS.ProcessEnv, pullOptions = ['--rebase']) {
  const { stdout } = await execa(
    process.execPath,
    ['--import', tsxImport, cliPath, 'git', 'pull', ...pullOptions, '--json', '--yes'],
    { cwd, env }
  );
  return JSON.parse(stdout) as { command: string; ok: boolean };
}

async function expectConfiguredMerge(
  fixture: PullFixture,
  localCommit: string,
  upstreamCommit: string,
  decoyCommit: string
) {
  const head = await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env);
  expect(
    (await git(fixture.repoPath, ['rev-list', '--parents', '-n', '1', 'HEAD'], fixture.env)).split(
      ' '
    )
  ).toEqual([head, localCommit, upstreamCommit]);
  expect(await git(fixture.repoPath, ['rev-parse', '--abbrev-ref', '@{u}'], fixture.env)).toBe(
    'origin/remote-base'
  );
  expect(await git(fixture.repoPath, ['rev-list', '--count', 'HEAD..@{u}'], fixture.env)).toBe('0');
  expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
  expect(await git(fixture.remotePath, ['rev-parse', 'refs/heads/remote-base'], fixture.env)).toBe(
    upstreamCommit
  );
  expect(
    await git(fixture.remotePath, ['rev-parse', 'refs/heads/local-feature'], fixture.env)
  ).toBe(decoyCommit);

  const decoyAncestor = await execa('git', ['merge-base', '--is-ancestor', decoyCommit, 'HEAD'], {
    cwd: fixture.repoPath,
    env: fixture.env,
    reject: false,
  });
  expect(decoyAncestor.exitCode).toBe(1);
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

  it('requires an explicit merge before combining multiple configured upstreams', async () => {
    const fixture = await createFixture({ localAhead: false });
    const { firstCommit, secondCommit } = await createMultipleRemoteHeads(fixture);
    await git(
      fixture.repoPath,
      ['config', '--add', 'branch.local-feature.merge', 'refs/heads/other-head'],
      fixture.env
    );
    await git(fixture.repoPath, ['config', 'pull.ff', 'only'], fixture.env);

    const refused = await execa(
      process.execPath,
      ['--import', tsxImport, cliPath, 'git', 'pull', '--json', '--yes'],
      { cwd: fixture.repoPath, env: fixture.env, reject: false }
    );

    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({
      error: {
        code: 'GIT_UNKNOWN_ERROR',
        context: {
          command: 'git pull',
          stderr: expect.stringContaining('Cannot fast-forward to multiple branches'),
        },
      },
    });
    expect(await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env)).toBe(
      fixture.aheadCommit
    );
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');
    await rm(join(fixture.repoPath, '.git', 'FETCH_HEAD'), { force: true });

    const result = await runPull(fixture.repoPath, fixture.env, ['--no-rebase']);

    expect(result).toEqual({ command: 'git.pull', ok: true });
    const head = await git(fixture.repoPath, ['rev-parse', 'HEAD'], fixture.env);
    const [mergeCommit, ...parents] = (
      await git(fixture.repoPath, ['rev-list', '--parents', '-n', '1', 'HEAD'], fixture.env)
    ).split(' ');
    expect(mergeCommit).toBe(head);
    expect(new Set(parents)).toEqual(new Set([firstCommit, secondCommit]));
    expect(await git(fixture.repoPath, ['rev-parse', '--abbrev-ref', '@{u}'], fixture.env)).toBe(
      'origin/remote-base'
    );
    expect(await git(fixture.repoPath, ['status', '--porcelain'], fixture.env)).toBe('');

    const fetchHead = await readFile(join(fixture.repoPath, '.git', 'FETCH_HEAD'), 'utf8');
    expect(fetchHead.trim().split('\n')).toHaveLength(2);
    expect(fetchHead).toContain(firstCommit);
    expect(fetchHead).toContain(secondCommit);
    expect(fetchHead).toContain("branch 'remote-base'");
    expect(fetchHead).toContain("branch 'other-head'");
    expect(fetchHead).not.toContain('local-feature');
  }, 30_000);

  it('merges a diverged configured upstream when rebase is disabled', async () => {
    const fixture = await createFixture();
    const localCommit = fixture.aheadCommit;
    const { decoyCommit, upstreamCommit } = await createDivergedRemote(fixture);
    await git(fixture.repoPath, ['config', 'pull.ff', 'only'], fixture.env);

    const result = await runPull(fixture.repoPath, fixture.env, ['--no-rebase']);

    expect(result).toEqual({ command: 'git.pull', ok: true });
    await expectConfiguredMerge(fixture, localCommit, upstreamCommit, decoyCommit);
    expect(await git(fixture.repoPath, ['rev-list', '--count', '@{u}..HEAD'], fixture.env)).toBe(
      '2'
    );
  }, 30_000);

  it('lets no-rebase override repository rebase configuration', async () => {
    const fixture = await createFixture();
    const localCommit = fixture.aheadCommit;
    const { decoyCommit, upstreamCommit } = await createDivergedRemote(fixture);
    await git(fixture.repoPath, ['config', 'pull.rebase', 'true'], fixture.env);

    const result = await runPull(fixture.repoPath, fixture.env, ['--no-rebase']);

    expect(result).toEqual({ command: 'git.pull', ok: true });
    await expectConfiguredMerge(fixture, localCommit, upstreamCommit, decoyCommit);
  }, 30_000);
});
