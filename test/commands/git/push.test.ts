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

describe('git push command', () => {
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  const confirmMock = vi.mocked(confirm);
  let exitMock: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  async function pushCommand() {
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');
    return createPushCommand();
  }

  const pushCalls = () =>
    execaMock.mock.calls.filter(([_cmd, args]) => Array.isArray(args) && args[0] === 'push');

  const jsonWrite = (index = 0): unknown =>
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
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');

    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'feature/diverge' })); // branch
    const rejectionError = new Error('non-fast-forward');
    (rejectionError as { shortMessage?: string }).shortMessage = 'fetch first';
    execaMock.mockRejectedValueOnce(rejectionError); // push rejected
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'rebased' })); // pull --rebase
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'pushed' })); // push retry

    promptSelectMock.mockResolvedValueOnce('pull-rebase');

    const command = createPushCommand();
    await command.parseAsync([], { from: 'user' });

    expect(promptSelectMock).toHaveBeenCalled();

    const pullRebaseCall = execaMock.mock.calls.find(
      ([_cmd, args]) =>
        Array.isArray(args) &&
        args[0] === 'pull' &&
        args[1] === '--rebase' &&
        args[2] === 'origin' &&
        args[3] === 'feature/diverge'
    );
    expect(pullRebaseCall).toBeTruthy();

    const pushCalls = execaMock.mock.calls.filter(
      ([_cmd, args]) =>
        Array.isArray(args) &&
        args[0] === 'push' &&
        args[1] === 'origin' &&
        args[2] === 'feature/diverge'
    );
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    // With Result pattern, successful commands don't call process.exit()
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });

  it('force pushes when remote is ahead and user selects force', async () => {
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');

    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'feature/diverge' })); // branch
    const rejectionError = new Error('rejected');
    (rejectionError as { shortMessage?: string }).shortMessage = 'non-fast-forward';
    execaMock.mockRejectedValueOnce(rejectionError); // push rejected
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'forced' })); // force push

    promptSelectMock.mockResolvedValueOnce('force');

    const command = createPushCommand();
    await command.parseAsync([], { from: 'user' });

    expect(promptSelectMock).toHaveBeenCalled();
    expect(
      execaMock.mock.calls.find(
        ([_cmd, args]) =>
          Array.isArray(args) && args.join(' ') === 'push --force origin feature/diverge'
      )
    ).toBeTruthy();
    // With Result pattern, successful commands don't call process.exit()
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });

  describe('main branch guard', () => {
    it('refuses to push to main in non-interactive mode and exits 2', async () => {
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const exitSignal = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new ExitSignal(code);
      });

      try {
        const command = await pushCommand();
        await expect(command.parseAsync([], { from: 'user' })).rejects.toBeInstanceOf(ExitSignal);

        expect(exitSignal.mock.calls).toEqual([[2]]);
        expect(jsonWrite()).toMatchObject({
          error: {
            code: 'NEO_NON_INTERACTIVE',
            flag: '--force-main',
            prompt: 'Pushing to main requires explicit confirmation',
          },
        });
        expect(pushCalls()).toHaveLength(0);
        expect(confirmMock).not.toHaveBeenCalled();
      } finally {
        exitSignal.mockRestore();
      }
    });

    it('refuses to push to main under --yes without --force-main', async () => {
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
      setRuntimeContext(buildRuntimeContext({ yes: true, nonInteractive: false }));

      const exitSignal = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new ExitSignal(code);
      });

      try {
        const command = await pushCommand();
        await expect(command.parseAsync([], { from: 'user' })).rejects.toBeInstanceOf(ExitSignal);

        expect(exitSignal.mock.calls).toEqual([[2]]);
        expect(ui.error).toHaveBeenCalledWith(
          expect.stringContaining('Pass --force-main to bypass.')
        );
        expect(confirmMock).not.toHaveBeenCalled();
        expect(pushCalls()).toHaveLength(0);
      } finally {
        exitSignal.mockRestore();
      }
    });

    it('pushes to main without prompting when --force-main is passed', async () => {
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'Everything up-to-date' }));
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const command = await pushCommand();
      await command.parseAsync(['--force-main'], { from: 'user' });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(ui.step).toHaveBeenCalledWith('Proceeding with push to main branch');
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
      });
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('cancels the push when the main-branch confirmation is declined', async () => {
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
      confirmMock.mockResolvedValueOnce(false);

      const command = await pushCommand();
      await command.parseAsync([], { from: 'user' });

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
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'pushed' }));
      confirmMock.mockResolvedValueOnce(true);

      const command = await pushCommand();
      await command.parseAsync([], { from: 'user' });

      expect(ui.step).toHaveBeenCalledWith('Proceeding with push to main branch');
      expect(execaMock).toHaveBeenCalledWith('git', ['push', 'origin', 'main'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      expect(exitMock).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
    });

    it('maps a missing repository to GIT_NOT_A_REPOSITORY', async () => {
      execaMock.mockRejectedValueOnce(
        execaFailure(
          'Command failed with exit code 128: git branch --show-current',
          'fatal: not a git repository (or any of the parent directories): .git'
        )
      );

      const command = await pushCommand();
      await command.parseAsync([], { from: 'user' });

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
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'feature/x' }));
      execaMock.mockRejectedValueOnce(
        execaFailure(
          'Command failed with exit code 128: git push origin feature/x',
          'fatal: The current branch feature/x has no upstream branch.'
        )
      );

      const command = await pushCommand();
      await command.parseAsync([], { from: 'user' });

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
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'feature/x' }));
      execaMock.mockRejectedValueOnce(
        execaFailure(
          'Command failed with exit code 128: git push origin feature/x',
          'ERROR: Permission denied (publickey).\nfatal: Could not read from remote repository.'
        )
      );

      const command = await pushCommand();
      await command.parseAsync([], { from: 'user' });

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

  describe('--on-reject', () => {
    it('cancels without prompting when --on-reject cancel is passed', async () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      execaMock.mockResolvedValueOnce(execaResult({ stdout: 'feature/diverge' }));
      execaMock.mockRejectedValueOnce(
        execaFailure(
          'Command failed with exit code 1: git push origin feature/diverge',
          'hint: Updates were rejected because the tip of your current branch is behind'
        )
      );

      const command = await pushCommand();
      await command.parseAsync(['--on-reject', 'cancel'], { from: 'user' });

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
