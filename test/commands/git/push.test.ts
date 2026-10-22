import { confirm } from '@inquirer/prompts';
import { execa } from 'execa';
import { execaResult } from '../../utils/test-helpers.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptSelect } from '@/utils/prompt.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { ui } from '@/utils/ui.js';

const spinnerMock = {
  start: vi.fn(),
  stop: vi.fn(),
  succeed: vi.fn(),
  text: '',
};

vi.mock('execa', () => {
  const execa = vi.fn();
  return { execa };
});

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/utils/prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/prompt.js')>();
  const promptSelect = vi.fn();
  return { ...actual, promptSelect };
});

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    spinner: vi.fn(() => ({ ...spinnerMock })),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    newline: vi.fn(),
    plain: vi.fn(),
  },
}));

class ExitSignal extends Error {
  constructor(readonly exitCode: string | number | null | undefined) {
    super(`process.exit(${String(exitCode)})`);
  }
}

function execaFailure(message: string, stderr: string): Error {
  const error = new Error(message);
  (error as Error & { stderr?: string }).stderr = stderr;
  return error;
}

const behind = () =>
  execaFailure(
    'Command failed with exit code 1: git push',
    'hint: Updates were rejected because the tip of your current branch is behind'
  );

interface Scenario {
  /** `git branch --show-current`; an Error makes the call fail. */
  branch?: string | Error;
  /** The current branch's upstream; null means none. Defaults to its same-named origin branch. */
  upstream?: { remote: string; branch: string } | null;
  /** Branch `refs/remotes/origin/HEAD` points to; null leaves it unset. */
  remoteHead?: string | null;
  /** `remote.<name>.push` mapping, when configured. */
  pushMapping?: string;
  /** `git config neo.allowMainPush`. */
  allowMainPush?: boolean;
  /** Successive `git push` outcomes; the last one repeats. */
  pushes?: Array<'ok' | Error>;
  /** `git pull --rebase` outcome. */
  pull?: 'ok' | Error;
  /** `git log --oneline <range>` output per range, for dry runs; missing ranges fail. */
  logs?: Record<string, string>;
}

describe('git push command', () => {
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  const confirmMock = vi.mocked(confirm);
  let exitMock: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  function useGit({
    branch = 'feature/x',
    upstream,
    remoteHead = 'main',
    pushMapping,
    allowMainPush = false,
    pushes = ['ok'],
    pull = 'ok',
    logs = {},
  }: Scenario = {}): void {
    let pushCount = 0;
    const current = branch instanceof Error ? '' : branch;
    const tracking =
      upstream === undefined ? (current ? { remote: 'origin', branch: current } : null) : upstream;

    execaMock.mockImplementation((async (command: string, args?: readonly string[]) => {
      const argv = [...(args ?? [])];
      if (command !== 'git') throw new Error(`Unexpected command: ${command}`);

      if (argv[0] === 'branch' && argv[1] === '--show-current') {
        if (branch instanceof Error) throw branch;
        return execaResult({ stdout: branch });
      }
      if (argv[0] === 'symbolic-ref') {
        const ref = argv.at(-1) ?? '';
        return remoteHead && ref === 'refs/remotes/origin/HEAD'
          ? execaResult({ stdout: `origin/${remoteHead}` })
          : execaResult({ exitCode: 1, stderr: `fatal: ref ${ref} is not a symbolic ref` });
      }
      if (argv[0] === 'config' && argv.includes('neo.allowMainPush')) {
        return allowMainPush ? execaResult({ stdout: 'true' }) : execaResult({ exitCode: 1 });
      }
      if (argv[0] === 'config' && /^remote\..+\.push$/.test(argv.at(-1) ?? '')) {
        return pushMapping ? execaResult({ stdout: pushMapping }) : execaResult({ exitCode: 1 });
      }
      if (argv[0] === 'for-each-ref') {
        return execaResult({
          stdout: tracking ? `${tracking.remote}\0refs/heads/${tracking.branch}` : '',
        });
      }
      if (argv[0] === 'log') {
        const range = argv.at(-1) ?? '';
        return range in logs
          ? execaResult({ stdout: logs[range] })
          : execaResult({ exitCode: 128, stderr: `fatal: bad revision '${range}'` });
      }
      if (argv[0] === 'pull') {
        if (pull instanceof Error) throw pull;
        return execaResult({ stdout: 'rebased' });
      }
      if (argv[0] === 'push') {
        const outcome = pushes[Math.min(pushCount, pushes.length - 1)] ?? 'ok';
        pushCount += 1;
        if (outcome instanceof Error) throw outcome;
        return execaResult({ stdout: '' });
      }
      throw new Error(`Unexpected git call: git ${argv.join(' ')}`);
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);
  }

  async function pushCommand() {
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');
    return createPushCommand();
  }

  async function run(args: string[] = []) {
    const command = await pushCommand();
    await command.parseAsync(args, { from: 'user' });
  }

  /** Runs a push that should stop for authorization, returning the exit code it requested. */
  async function runRefused(args: string[] = []): Promise<unknown> {
    const exitSignal = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
    try {
      const command = await pushCommand();
      await expect(command.parseAsync(args, { from: 'user' })).rejects.toBeInstanceOf(ExitSignal);
      return exitSignal.mock.calls[0]?.[0];
    } finally {
      exitSignal.mockRestore();
    }
  }

  const pushCalls = () =>
    execaMock.mock.calls
      .filter(([_cmd, args]) => Array.isArray(args) && args[0] === 'push')
      .map(([, args]) => args as string[]);

  const upstreamChecks = () =>
    execaMock.mock.calls.filter(
      ([_cmd, args]) => Array.isArray(args) && args[0] === 'for-each-ref'
    );

  const jsonWrite = (index = 0): Record<string, unknown> =>
    JSON.parse(String(stdoutWriteSpy.mock.calls[index]?.[0]));

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setRuntimeContext(buildRuntimeContext());
    spinnerMock.start.mockClear();
    spinnerMock.stop.mockClear();
    spinnerMock.succeed.mockClear();
    spinnerMock.text = '';
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
    vi.resetAllMocks();
  });

  it('rebases then retries push when remote is ahead and user selects rebase', async () => {
    useGit({ branch: 'feature/diverge', pushes: [behind(), 'ok'] });
    promptSelectMock.mockResolvedValueOnce('pull-rebase');

    await run();

    expect(promptSelectMock).toHaveBeenCalled();
    expect(
      execaMock.mock.calls.find(
        ([_cmd, args]) =>
          Array.isArray(args) && args.join(' ') === 'pull --rebase origin feature/diverge'
      )
    ).toBeTruthy();
    expect(pushCalls()).toEqual([
      ['push', 'origin', 'feature/diverge'],
      ['push', 'origin', 'feature/diverge'],
    ]);
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });

  it('force pushes when remote is ahead and user selects force', async () => {
    useGit({ branch: 'feature/diverge', pushes: [behind(), 'ok'] });
    promptSelectMock.mockResolvedValueOnce('force');

    await run();

    expect(promptSelectMock).toHaveBeenCalled();
    expect(pushCalls()).toContainEqual(['push', '--force', 'origin', 'feature/diverge']);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });

  describe('protected branch guard', () => {
    it('refuses to push to main in non-interactive mode and exits 2', async () => {
      useGit({ branch: 'main' });
      setRuntimeContext(buildRuntimeContext({ json: true }));

      expect(await runRefused()).toBe(2);

      expect(jsonWrite()).toMatchObject({
        error: {
          code: 'NEO_NON_INTERACTIVE',
          flag: '--allow-main',
          prompt:
            'Pushing to main requires explicit confirmation (or run `git config neo.allowMainPush true` in this repo)',
        },
      });
      expect(pushCalls()).toHaveLength(0);
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it('refuses to push to main under --yes without --allow-main', async () => {
      useGit({ branch: 'main' });
      setRuntimeContext(buildRuntimeContext({ yes: true, nonInteractive: false }));

      expect(await runRefused()).toBe(2);

      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining('Pass --allow-main to bypass.')
      );
      expect(confirmMock).not.toHaveBeenCalled();
      expect(pushCalls()).toHaveLength(0);
    });

    it('pushes to main without prompting when --allow-main is passed', async () => {
      useGit({ branch: 'main' });
      setRuntimeContext(buildRuntimeContext({ json: true }));

      await run(['--allow-main']);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(ui.step).toHaveBeenCalledWith('Pushing to main (authorized by --allow-main)');
      expect(execaMock).toHaveBeenCalledWith('git', ['push', 'origin', 'main'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(jsonWrite()).toEqual({
        ok: true,
        command: 'git.push',
        remote: 'origin',
        branch: 'main',
        destinations: [
          { action: 'update', branch: 'main', force: false, protected: true, source: 'main' },
        ],
        upstream: null,
        replacedUpstream: null,
      });
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('still accepts the deprecated --force-main alias', async () => {
      useGit({ branch: 'main' });
      setRuntimeContext(buildRuntimeContext({ json: true }));

      await run(['--force-main']);

      expect(pushCalls()).toEqual([['push', 'origin', 'main']]);
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('hides --force-main from help in favor of --allow-main', async () => {
      const help = (await pushCommand()).helpInformation();

      expect(help).toContain('--allow-main');
      expect(help).not.toContain('--force-main');
    });

    it('cancels the push when the confirmation is declined', async () => {
      useGit({ branch: 'main' });
      confirmMock.mockResolvedValueOnce(false);

      await run();

      expect(confirmMock).toHaveBeenCalledWith({
        message: 'Are you sure you want to continue?',
        default: false,
      });
      expect(pushCalls()).toHaveLength(0);
      expect(ui.success).toHaveBeenCalledWith(
        "Push cancelled. Here's how to push your changes safely:"
      );
      expect(ui.list).toHaveBeenCalledWith([
        'Create a feature branch: git checkout -b feature/your-feature-name',
        'Push to your branch: git push -u origin feature/your-feature-name',
        'Create a pull request to merge into main',
      ]);
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('pushes to main once the confirmation is accepted', async () => {
      useGit({ branch: 'main' });
      confirmMock.mockResolvedValueOnce(true);

      await run();

      expect(ui.step).toHaveBeenCalledWith('Proceeding: Pushing to main');
      expect(pushCalls()).toEqual([['push', 'origin', 'main']]);
      expect(exitMock).not.toHaveBeenCalled();
    });

    describe('judges the destination, not the checked-out branch', () => {
      beforeEach(() => {
        setRuntimeContext(buildRuntimeContext({ json: true }));
      });

      it.each([
        ['HEAD:main', ['origin', 'HEAD:main']],
        ['feature:main', ['origin', 'feature/x:main']],
        ['main:main', ['origin', 'main:main']],
        ['a full destination ref', ['origin', 'HEAD:refs/heads/main']],
        ['one protected refspec among several', ['origin', 'feature/x', 'HEAD:main']],
      ])('guards a push of %s from a feature branch', async (_label, args) => {
        useGit();

        expect(await runRefused(args)).toBe(2);

        expect(jsonWrite()).toMatchObject({
          error: { flag: '--allow-main', prompt: expect.stringMatching(/^Pushing to main /) },
        });
        expect(pushCalls()).toHaveLength(0);
      });

      it('guards the default branch the remote reports, not just main', async () => {
        useGit({ remoteHead: 'develop' });

        expect(await runRefused(['origin', 'HEAD:develop'])).toBe(2);

        expect(jsonWrite()).toMatchObject({
          error: { prompt: expect.stringMatching(/^Pushing to develop /) },
        });
      });

      it('keeps guarding main and master when the default branch is something else', async () => {
        useGit({ remoteHead: 'develop' });

        expect(await runRefused(['origin', 'HEAD:master'])).toBe(2);
      });

      it('guards master when the remote HEAD is unknown', async () => {
        useGit({ branch: 'master', remoteHead: null });

        expect(await runRefused()).toBe(2);

        expect(jsonWrite()).toMatchObject({
          error: { prompt: expect.stringMatching(/^Pushing to master /) },
        });
      });

      it.each([
        ['a + refspec', ['origin', '+HEAD:main'], 'Force-pushing main'],
        ['--force', ['--force', 'origin', 'HEAD:main'], 'Force-pushing main'],
        ['--force-with-lease', ['--force-with-lease', 'origin', 'HEAD:main'], 'Force-pushing main'],
        ['bundled -fu', ['-fu', 'origin', 'HEAD:main'], 'Force-pushing main'],
        ['--delete', ['--delete', 'origin', 'main'], 'Deleting main'],
        ['a :main refspec', ['origin', ':main'], 'Deleting main'],
        ['--mirror', ['--mirror', 'origin'], 'Pushing with --mirror'],
        ['--all', ['--all', 'origin'], 'Pushing with --all'],
        ['--prune', ['--prune', 'origin', 'feature/x'], 'Pushing with --prune'],
        [
          'a wildcard refspec',
          ['origin', 'refs/heads/*:refs/heads/*'],
          'Pushing with the wildcard refspec',
        ],
      ])(
        'treats %s as needing explicit authorization, even with neo.allowMainPush',
        async (_label, args, prompt) => {
          useGit({ allowMainPush: true });

          expect(await runRefused(args)).toBe(2);

          const { error } = jsonWrite() as { error: { flag: string; prompt: string } };
          expect(error.flag).toBe('--allow-main');
          expect(error.prompt.startsWith(prompt)).toBe(true);
          expect(error.prompt).not.toContain('neo.allowMainPush');
          expect(pushCalls()).toHaveLength(0);
        }
      );

      it('lets --allow-main authorize a force-push of main', async () => {
        useGit({ branch: 'main' });

        await run(['--force', '--allow-main']);

        expect(pushCalls()).toEqual([['push', '--force', 'origin', 'main']]);
        expect(exitMock).not.toHaveBeenCalled();
      });

      it('treats a configured remote push mapping as unresolved', async () => {
        useGit({ pushMapping: 'refs/heads/*:refs/heads/main' });

        expect(await runRefused()).toBe(2);

        expect(jsonWrite()).toMatchObject({
          error: { prompt: expect.stringContaining('remote.origin.push') },
        });
      });

      it('deletes an unrelated remote branch from main without a prompt', async () => {
        useGit({ branch: 'main' });

        await run(['--delete', 'origin', 'jacek/merged']);

        expect(pushCalls()).toEqual([['push', '--delete', 'origin', 'jacek/merged']]);
        expect(jsonWrite()).toMatchObject({
          ok: true,
          destinations: [{ action: 'delete', branch: 'jacek/merged', protected: false }],
        });
      });

      it('force-pushes a feature branch without a prompt', async () => {
        useGit();

        await run(['--force']);

        expect(pushCalls()).toEqual([['push', '--force', 'origin', 'feature/x']]);
        expect(exitMock).not.toHaveBeenCalled();
      });

      it('ignores tag and review refs, which are not branches', async () => {
        useGit({ branch: 'main' });

        await run(['origin', 'v1.0.0:refs/tags/v1.0.0', 'HEAD:refs/for/main']);

        expect(pushCalls()).toHaveLength(1);
        expect(jsonWrite()).toMatchObject({ ok: true, destinations: [] });
      });

      it('keeps the value of a flag such as -o out of the refspecs', async () => {
        useGit();

        await run(['-o', 'ci.skip', 'origin', 'feature/x']);

        expect(pushCalls()).toEqual([['push', '-o', 'ci.skip', 'origin', 'feature/x']]);
      });
    });

    describe('neo.allowMainPush', () => {
      beforeEach(() => {
        setRuntimeContext(buildRuntimeContext({ json: true }));
      });

      it('lets a fast-forward to main through without a flag or prompt', async () => {
        useGit({ branch: 'main', allowMainPush: true });

        await run();

        expect(ui.step).toHaveBeenCalledWith('Pushing to main (allowed by neo.allowMainPush)');
        expect(pushCalls()).toEqual([['push', 'origin', 'main']]);
        expect(exitMock).not.toHaveBeenCalled();
      });

      it('does not cover escalating a rejected push to a force-push', async () => {
        useGit({ branch: 'main', allowMainPush: true, pushes: [behind()] });

        expect(await runRefused(['--on-reject', 'force'])).toBe(2);

        expect(jsonWrite()).toMatchObject({
          error: {
            flag: '--allow-main',
            prompt: 'Force-pushing main requires explicit confirmation',
          },
        });
        expect(pushCalls()).toEqual([['push', 'origin', 'main']]);
      });

      it('lets a confirmation authorize that force-push interactively', async () => {
        setRuntimeContext(buildRuntimeContext());
        useGit({ branch: 'main', allowMainPush: true, pushes: [behind(), 'ok'] });
        confirmMock.mockResolvedValueOnce(true);

        await run(['--on-reject', 'force']);

        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(pushCalls()).toEqual([
          ['push', 'origin', 'main'],
          ['push', '--force', 'origin', 'main'],
        ]);
      });
    });
  });

  describe('--dry-run', () => {
    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
    });

    it('reports the destinations of the refspecs given, without pushing or prompting', async () => {
      useGit({ logs: { 'origin/main..feature/x': 'abc1234 unreviewed' } });

      await run(['--dry-run', 'origin', 'feature/x:main']);

      expect(pushCalls()).toHaveLength(0);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(jsonWrite()).toEqual({
        ok: true,
        command: 'git.push',
        dryRun: true,
        remote: 'origin',
        destinations: [
          {
            action: 'update',
            branch: 'main',
            commits: ['abc1234 unreviewed'],
            force: false,
            protected: true,
            source: 'feature/x',
          },
        ],
        unresolved: null,
        authorizationRequired: '--allow-main, a confirmation, or neo.allowMainPush',
      });
    });

    it('reports a new remote branch as having unknown commits', async () => {
      useGit({ upstream: null });

      await run(['--dry-run']);

      expect(jsonWrite()).toMatchObject({
        destinations: [{ branch: 'feature/x', commits: null, protected: false }],
        authorizationRequired: null,
      });
    });

    it('reports that a force-push of main needs --allow-main even with neo.allowMainPush', async () => {
      useGit({ branch: 'main', allowMainPush: true });

      await run(['--dry-run', '--force']);

      expect(jsonWrite()).toMatchObject({
        authorizationRequired: '--allow-main or a confirmation',
      });
    });

    it('reports an unresolvable push', async () => {
      useGit();

      await run(['--dry-run', '--mirror', 'origin']);

      expect(jsonWrite()).toMatchObject({ destinations: [], unresolved: '--mirror' });
    });
  });

  describe('error mapping', () => {
    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
    });

    it('maps a missing repository to GIT_NOT_A_REPOSITORY', async () => {
      useGit({
        branch: execaFailure(
          'Command failed with exit code 128: git branch --show-current',
          'fatal: not a git repository (or any of the parent directories): .git'
        ),
      });

      await run();

      expect(pushCalls()).toHaveLength(0);
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(jsonWrite()).toMatchObject({
        error: {
          code: 'GIT_NOT_A_REPOSITORY',
          message: 'Not a git repository!',
          suggestions: ['Make sure you are in a git repository directory'],
        },
      });
    });

    it('maps a missing upstream to GIT_NO_UPSTREAM naming the current branch', async () => {
      useGit({
        pushes: [
          execaFailure(
            'Command failed with exit code 128: git push origin feature/x',
            'fatal: The current branch feature/x has no upstream branch.'
          ),
        ],
      });

      await run();

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(jsonWrite()).toMatchObject({
        error: {
          code: 'GIT_NO_UPSTREAM',
          message: 'No upstream branch configured!',
          suggestions: [
            'Set an upstream branch: git branch --set-upstream-to=origin/feature/x feature/x',
            'Or push with upstream: git push -u origin feature/x',
          ],
        },
      });
    });

    it('maps a rejected credential to GIT_AUTHENTICATION_FAILED', async () => {
      useGit({
        pushes: [
          execaFailure(
            'Command failed with exit code 128: git push origin feature/x',
            'ERROR: Permission denied (publickey).\nfatal: Could not read from remote repository.'
          ),
        ],
      });

      await run();

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(jsonWrite()).toMatchObject({
        error: {
          code: 'GIT_AUTHENTICATION_FAILED',
          message: 'Authentication failed!',
          suggestions: ['Check your git credentials or SSH keys'],
        },
      });
    });
  });

  describe('upstream tracking', () => {
    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
    });

    it('sets the upstream when the current branch has none yet', async () => {
      useGit({ branch: 'feature/new', upstream: null });

      await run();

      expect(pushCalls()).toEqual([['push', '--set-upstream', 'origin', 'feature/new']]);
      expect(jsonWrite()).toEqual({
        ok: true,
        command: 'git.push',
        remote: 'origin',
        branch: 'feature/new',
        destinations: [
          {
            action: 'update',
            branch: 'feature/new',
            force: false,
            protected: false,
            source: 'feature/new',
          },
        ],
        upstream: 'origin/feature/new',
        replacedUpstream: null,
      });
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('retargets a branch that still tracks the default branch', async () => {
      useGit({ branch: 'feature/new', upstream: { remote: 'origin', branch: 'main' } });

      await run();

      expect(pushCalls()).toEqual([['push', '--set-upstream', 'origin', 'feature/new']]);
      expect(jsonWrite()).toMatchObject({
        upstream: 'origin/feature/new',
        replacedUpstream: 'origin/main',
      });
    });

    it('falls back to main and master when the remote HEAD is unknown', async () => {
      useGit({
        branch: 'feature/new',
        upstream: { remote: 'origin', branch: 'master' },
        remoteHead: null,
      });

      await run();

      expect(jsonWrite()).toMatchObject({ replacedUpstream: 'origin/master' });
    });

    it('reports the replaced upstream in text mode', async () => {
      setRuntimeContext(buildRuntimeContext());
      useGit({ branch: 'feature/new', upstream: { remote: 'origin', branch: 'main' } });

      await run();

      expect(ui.info).toHaveBeenCalledWith(
        'Set upstream branch: origin/feature/new (was origin/main)'
      );
    });

    it('leaves a stacked branch tracking another feature branch alone', async () => {
      useGit({
        branch: 'feature/child',
        upstream: { remote: 'origin', branch: 'feature/parent' },
      });

      await run();

      expect(pushCalls()).toEqual([['push', 'origin', 'feature/child']]);
      expect(jsonWrite()).toMatchObject({ upstream: null, replacedUpstream: null });
    });

    it('leaves a fork workflow alone: tracking origin/main while pushing to another remote', async () => {
      useGit({ branch: 'feature/new', upstream: { remote: 'origin', branch: 'main' } });

      await run(['fork']);

      expect(pushCalls()).toEqual([['push', 'fork', 'feature/new']]);
      expect(jsonWrite()).toMatchObject({ upstream: null, replacedUpstream: null });
    });

    it('leaves an existing upstream alone', async () => {
      useGit({ branch: 'feature/old' });

      await run();

      expect(pushCalls()).toEqual([['push', 'origin', 'feature/old']]);
      expect(jsonWrite()).toMatchObject({ upstream: null });
    });

    it('does not check for an upstream when -u is already passed', async () => {
      useGit({ branch: 'feature/new', upstream: null });

      await run(['-u']);

      expect(upstreamChecks()).toHaveLength(0);
      expect(pushCalls()).toEqual([['push', '-u', 'origin', 'feature/new']]);
      expect(jsonWrite()).toMatchObject({ upstream: 'origin/feature/new' });
    });

    it('does not track a differently named remote branch', async () => {
      useGit({ branch: 'feature/new', upstream: null });

      await run(['origin', 'release']);

      expect(upstreamChecks()).toHaveLength(0);
      expect(pushCalls()).toEqual([['push', 'origin', 'release']]);
    });

    it('does not set an upstream for a deletion', async () => {
      useGit({ branch: 'feature/new', upstream: null });

      await run(['--delete']);

      expect(upstreamChecks()).toHaveLength(0);
      expect(pushCalls()).toEqual([['push', '--delete', 'origin', 'feature/new']]);
    });

    it('keeps --set-upstream on the retry after a pull-rebase', async () => {
      useGit({ branch: 'feature/new', upstream: null, pushes: [behind(), 'ok'] });

      await run(['--on-reject', 'pull-rebase']);

      expect(pushCalls()).toEqual([
        ['push', '--set-upstream', 'origin', 'feature/new'],
        ['push', '--set-upstream', 'origin', 'feature/new'],
      ]);
      expect(ui.info).toHaveBeenCalledWith('Set upstream branch: origin/feature/new');
    });
  });

  describe('--on-reject', () => {
    it('cancels without prompting when --on-reject cancel is passed', async () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      useGit({ branch: 'feature/diverge', pushes: [behind()] });

      await run(['--on-reject', 'cancel']);

      expect(promptSelectMock).not.toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith('Push cancelled. No changes were pushed.');
      expect(pushCalls()).toHaveLength(1);
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(jsonWrite()).toMatchObject({ error: { code: 'GIT_UNKNOWN_ERROR' } });
    });

    it('rejects an unrecognized strategy at parse time', async () => {
      const command = await pushCommand();
      command.exitOverride();
      command.configureOutput({ writeErr: () => {} });

      const parseError = await command.parseAsync(['--on-reject', 'bogus'], { from: 'user' }).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(parseError).toMatchObject({
        code: 'commander.invalidArgument',
        message: expect.stringContaining('Allowed choices are pull-rebase, force, cancel.'),
      });
      expect(execaMock).not.toHaveBeenCalled();
    });
  });
});
