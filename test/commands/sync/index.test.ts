import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { execa } from 'execa';
import {
  createExecaMock,
  createSpinnerMock,
  mockProcessExit,
  type ExecaResponse,
} from '../../utils/test-helpers.js';

// createSpinnerMock has no `warn`, which the final stash-pop path calls.
const spinnerMock = { ...createSpinnerMock(), warn: vi.fn() };

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    spinner: vi.fn(() => spinnerMock),
  },
}));

import { createSyncCommand, executeSync } from '@/commands/sync/index.js';
import { ui } from '@/utils/ui.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { GitError, GitErrorCode } from '@/utils/git-errors.js';
import { CommandError, ErrorCategory, type AppError } from '@/core/errors/index.js';

/**
 * Canonical execa-call order in executeSync:
 *
 *   1. rev-parse --is-inside-work-tree        (in-repo guard)
 *   2. branch --show-current                  (getCurrentBranch / detached-HEAD guard)
 *   3. symbolic-ref refs/remotes/origin/HEAD  (detectDefaultBranch, skipped with --branch)
 *      └ on failure: show-ref origin/main, then show-ref origin/master
 *   4. status --porcelain                     (isTreeDirty)
 *   5. stash push --include-untracked ...     (only when dirty and stashing is allowed)
 *   6. fetch origin <base>
 *   7. rebase origin/<base> | merge --no-ff origin/<base>
 *   8. stash pop                              (only when step 5 ran)
 *   9. rev-list --left-right --count origin/<base>...HEAD
 */

const mockExeca = execa as unknown as Mock;
const BRANCH = 'jacek/sync-fix';

function baseResponses(): Record<string, ExecaResponse | Error> {
  return {
    'git rev-parse --is-inside-work-tree': { stdout: 'true' },
    'git branch --show-current': { stdout: BRANCH },
    'git symbolic-ref refs/remotes/origin/HEAD': { stdout: 'refs/remotes/origin/main' },
    'git status --porcelain': { stdout: '' },
    'git stash push': { stdout: 'Saved working directory' },
    'git stash pop': { stdout: 'Dropped refs/stash@{0}' },
    'git fetch origin': { stdout: '' },
    'git rebase origin/main': { stdout: '' },
    'git merge --no-ff origin/main': { stdout: '' },
    'git rev-list': { stdout: '2\t3' },
  };
}

function gitResponds(overrides: Record<string, ExecaResponse | Error> = {}): void {
  mockExeca.mockImplementation(
    createExecaMock({ responses: { ...baseResponses(), ...overrides } })
  );
}

function gitFailure(stderr: string): Error {
  return Object.assign(new Error('Command failed with exit code 1'), { stderr });
}

function gitCommands(): string[] {
  return (mockExeca.mock.calls as [string, string[]][]).map(
    ([command, args]) => `${command} ${args.join(' ')}`
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected executeSync to reject');
}

const DIRTY = { 'git status --porcelain': { stdout: ' M src/a.ts' } };
const STASH_PUSH = ['stash', 'push', '--include-untracked', '--message', 'neo sync: auto-stash'];

describe('executeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gitResponds();
  });

  afterEach(() => {
    setRuntimeContext(buildRuntimeContext());
  });

  describe('repository guards', () => {
    it('throws a classified NOT_A_REPOSITORY error and stops immediately', async () => {
      gitResponds({
        'git rev-parse --is-inside-work-tree': gitFailure(
          'fatal: not a git repository (or any of the parent directories): .git'
        ),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.NOT_A_REPOSITORY);
      expect(error.message).toBe('Not a git repository!');
      expect(gitCommands()).toEqual(['git rev-parse --is-inside-work-tree']);
    });

    it('classifies an unrecognized rev-parse failure as UNKNOWN', async () => {
      gitResponds({
        'git rev-parse --is-inside-work-tree': gitFailure('fatal: unable to read index file'),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.UNKNOWN);
      expect(error.message).toBe('Git command failed: sync');
    });

    it('refuses to sync a detached HEAD before touching the remote', async () => {
      gitResponds({ 'git branch --show-current': { stdout: '' } });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('SYNC_DETACHED_HEAD');
      expect(error.message).toBe('Detached HEAD.');
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
      ]);
    });
  });

  describe('default branch resolution', () => {
    it('resolves the base from origin HEAD and rebases onto it', async () => {
      const result = await executeSync({});

      expect(result).toEqual({
        branch: BRANCH,
        base: 'main',
        strategy: 'rebase',
        stashed: false,
        ahead: 3,
        behind: 2,
      });
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
        'git symbolic-ref refs/remotes/origin/HEAD',
        'git status --porcelain',
        'git fetch origin main',
        'git rebase origin/main',
        'git rev-list --left-right --count origin/main...HEAD',
      ]);
    });

    it('probes origin/main when symbolic-ref has never been set', async () => {
      gitResponds({
        'git symbolic-ref refs/remotes/origin/HEAD': gitFailure('fatal: ref not a symbolic ref'),
        'git show-ref --verify --quiet refs/remotes/origin/main': { stdout: '' },
      });

      const result = await executeSync({});

      expect(result.base).toBe('main');
      expect(gitCommands()).toContain('git show-ref --verify --quiet refs/remotes/origin/main');
      expect(mockExeca).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main']);
    });

    it('falls through to origin/master when origin/main is absent', async () => {
      gitResponds({
        'git symbolic-ref refs/remotes/origin/HEAD': gitFailure('fatal: ref not a symbolic ref'),
        'git show-ref --verify --quiet refs/remotes/origin/main': gitFailure('exit 1'),
        'git show-ref --verify --quiet refs/remotes/origin/master': { stdout: '' },
      });

      const result = await executeSync({});

      expect(result.base).toBe('master');
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
        'git symbolic-ref refs/remotes/origin/HEAD',
        'git show-ref --verify --quiet refs/remotes/origin/main',
        'git show-ref --verify --quiet refs/remotes/origin/master',
        'git status --porcelain',
        'git fetch origin master',
        'git rebase origin/master',
        'git rev-list --left-right --count origin/master...HEAD',
      ]);
    });

    it('throws SYNC_NO_DEFAULT_BRANCH when neither main nor master resolves', async () => {
      gitResponds({
        'git symbolic-ref refs/remotes/origin/HEAD': gitFailure('fatal: ref not a symbolic ref'),
        'git show-ref --verify --quiet refs/remotes/origin/main': gitFailure('exit 1'),
        'git show-ref --verify --quiet refs/remotes/origin/master': gitFailure('exit 1'),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('SYNC_NO_DEFAULT_BRANCH');
      expect(error.message).toBe('Could not detect default branch.');
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.suggestions).toEqual([
        'Run: git remote set-head origin --auto',
        'Or pass the base explicitly: neo sync --branch <name>',
      ]);
      expect(gitCommands()).not.toContain('git fetch origin main');
    });

    it('skips detection entirely when --branch names the base', async () => {
      const result = await executeSync({ branch: 'develop' });

      expect(result.base).toBe('develop');
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
        'git status --porcelain',
        'git fetch origin develop',
        'git rebase origin/develop',
        'git rev-list --left-right --count origin/develop...HEAD',
      ]);
    });
  });

  describe('dirty working tree', () => {
    it('refuses to sync with --no-stash and never reaches the remote', async () => {
      gitResponds(DIRTY);

      const error = await rejectionOf(executeSync({ stash: false }));

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('SYNC_UNCOMMITTED_CHANGES');
      expect(error.message).toBe('Working tree has uncommitted changes.');
      expect(error.suggestions).toEqual([
        'Commit them first: neo git commit',
        'Or drop --no-stash to auto-stash',
      ]);
      expect(gitCommands()).not.toContain('git fetch origin main');
      expect(gitCommands()).not.toContain(`git ${STASH_PUSH.join(' ')}`);
    });

    it('auto-stashes before the rebase and pops afterwards', async () => {
      gitResponds(DIRTY);

      const result = await executeSync({});

      expect(result.stashed).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('git', STASH_PUSH);
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
        'git symbolic-ref refs/remotes/origin/HEAD',
        'git status --porcelain',
        `git ${STASH_PUSH.join(' ')}`,
        'git fetch origin main',
        'git rebase origin/main',
        'git stash pop',
        'git rev-list --left-right --count origin/main...HEAD',
      ]);
      expect(spinnerMock.succeed).toHaveBeenCalledWith('Stashed local changes');
      expect(spinnerMock.succeed).toHaveBeenCalledWith('Restored stashed changes');
    });

    it('aborts with UNKNOWN when the stash push itself fails', async () => {
      gitResponds({ ...DIRTY, 'git stash push': gitFailure('fatal: unable to write new index') });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.UNKNOWN);
      expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to stash local changes');
      expect(gitCommands()).not.toContain('git fetch origin main');
    });

    it('leaves the stash in place and warns when the final pop conflicts', async () => {
      gitResponds({
        ...DIRTY,
        'git stash pop': gitFailure('CONFLICT (content): Merge conflict in src/a.ts'),
      });

      const result = await executeSync({});

      expect(result.stashed).toBe(true);
      expect(spinnerMock.warn).toHaveBeenCalledWith(
        'Stash pop had conflicts — left stash in place. Run `git stash list`.'
      );
    });
  });

  describe('fetch failures', () => {
    it('pops the stash back before throwing AUTHENTICATION_FAILED', async () => {
      gitResponds({
        ...DIRTY,
        'git fetch origin': gitFailure(
          'Permission denied (publickey).\nfatal: Could not read from remote repository.'
        ),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.AUTHENTICATION_FAILED);
      expect(spinnerMock.fail).toHaveBeenCalledWith('Fetch failed');
      expect(gitCommands()).toEqual([
        'git rev-parse --is-inside-work-tree',
        'git branch --show-current',
        'git symbolic-ref refs/remotes/origin/HEAD',
        'git status --porcelain',
        `git ${STASH_PUSH.join(' ')}`,
        'git fetch origin main',
        'git stash pop',
      ]);
      expect(ui.muted).toHaveBeenCalledWith('Restored stashed changes.');
    });

    it('warns with recovery instructions when the compensating pop also fails', async () => {
      gitResponds({
        ...DIRTY,
        'git fetch origin': gitFailure('Permission denied (publickey).'),
        'git stash pop': gitFailure('error: could not restore untracked files from stash'),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error.code).toBe(GitErrorCode.AUTHENTICATION_FAILED);
      expect(ui.warn).toHaveBeenCalledWith('Stash pop failed; run `git stash list` to recover.');
    });

    it('classifies a resolution failure as NETWORK_ERROR without popping a clean tree', async () => {
      gitResponds({
        'git fetch origin': gitFailure(
          "fatal: unable to access 'https://github.test/x.git/': Could not resolve host: github.test"
        ),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error.code).toBe(GitErrorCode.NETWORK_ERROR);
      expect(gitCommands()).not.toContain('git stash pop');
    });

    it('classifies an unrecognized fetch failure as UNKNOWN', async () => {
      gitResponds({ 'git fetch origin': gitFailure('fatal: the remote end hung up') });

      const error = await rejectionOf(executeSync({}));

      expect(error.code).toBe(GitErrorCode.UNKNOWN);
    });
  });

  describe('rebase and merge', () => {
    it('throws REBASE_CONFLICT and deliberately leaves the stash unpopped', async () => {
      gitResponds({
        ...DIRTY,
        'git rebase origin/main': gitFailure(
          'CONFLICT (content): Merge conflict in src/a.ts\nhint: Resolve all conflicts manually'
        ),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.REBASE_CONFLICT);
      expect(spinnerMock.fail).toHaveBeenCalledWith('Rebasing failed');
      expect(gitCommands()).toContain(`git ${STASH_PUSH.join(' ')}`);
      expect(gitCommands()).not.toContain('git stash pop');
    });

    it('classifies an unrecognized rebase failure as UNKNOWN', async () => {
      gitResponds({
        'git rebase origin/main': gitFailure('fatal: unable to write new index file'),
      });

      const error = await rejectionOf(executeSync({}));

      expect(error.code).toBe(GitErrorCode.UNKNOWN);
    });

    it('merges with --no-ff when --merge is passed', async () => {
      const result = await executeSync({ merge: true });

      expect(result.strategy).toBe('merge');
      expect(mockExeca).toHaveBeenCalledWith('git', ['merge', '--no-ff', 'origin/main']);
      expect(gitCommands()).not.toContain('git rebase origin/main');
      expect(spinnerMock.succeed).toHaveBeenCalledWith('Merged onto origin/main');
    });

    it('throws MERGE_CONFLICT when the merge conflicts', async () => {
      gitResponds({
        'git merge --no-ff origin/main': gitFailure(
          'Automatic merge failed; fix conflicts and then commit the result.'
        ),
      });

      const error = await rejectionOf(executeSync({ merge: true }));

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.MERGE_CONFLICT);
      expect(spinnerMock.fail).toHaveBeenCalledWith('Merging failed');
    });
  });

  describe('ahead/behind counts', () => {
    it('reads behind from the left column and ahead from the right', async () => {
      gitResponds({ 'git rev-list': { stdout: '7\t4\n' } });

      const result = await executeSync({});

      expect(result).toMatchObject({ behind: 7, ahead: 4 });
    });

    it('falls back to zero when rev-list prints nothing', async () => {
      gitResponds({ 'git rev-list': { stdout: '' } });

      const result = await executeSync({});

      expect(result).toMatchObject({ behind: 0, ahead: 0 });
    });
  });
});

describe('createSyncCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gitResponds();
    exitMock = mockProcessExit();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  function jsonPayload(): Record<string, unknown> {
    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    return JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
  }

  it('exposes the documented flags', () => {
    const command = createSyncCommand();

    expect(command.name()).toBe('sync');
    expect(command.options.map(({ flags }) => flags)).toEqual([
      '--merge',
      '--branch <name>',
      '--no-stash',
    ]);
  });

  it('emits the sync envelope under --json', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createSyncCommand().parseAsync([], { from: 'user' });

    expect(jsonPayload()).toEqual({
      ok: true,
      command: 'sync',
      branch: BRANCH,
      base: 'main',
      strategy: 'rebase',
      stashed: false,
      ahead: 3,
      behind: 2,
    });
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('forwards --merge and --branch through to the git invocations', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createSyncCommand().parseAsync(['--merge', '--branch', 'develop'], { from: 'user' });

    expect(jsonPayload()).toMatchObject({ base: 'develop', strategy: 'merge' });
    expect(mockExeca).toHaveBeenCalledWith('git', ['merge', '--no-ff', 'origin/develop']);
  });

  it('exits 1 with the serialized error when --no-stash meets a dirty tree', async () => {
    gitResponds(DIRTY);
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createSyncCommand().parseAsync(['--no-stash'], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(jsonPayload()).toEqual({
      error: {
        code: 'SYNC_UNCOMMITTED_CHANGES',
        message: 'Working tree has uncommitted changes.',
        category: 'COMMAND',
        severity: 'medium',
        suggestions: ['Commit them first: neo git commit', 'Or drop --no-stash to auto-stash'],
      },
    });
    expect(gitCommands()).not.toContain('git fetch origin main');
  });

  it('exits 1 with a classified git error and its suggestions', async () => {
    gitResponds({ 'git fetch origin': gitFailure('Permission denied (publickey).') });
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createSyncCommand().parseAsync([], { from: 'user' });

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(jsonPayload()).toEqual({
      error: {
        code: GitErrorCode.AUTHENTICATION_FAILED,
        message: 'Authentication failed!',
        category: 'COMMAND',
        severity: 'medium',
        suggestions: ['Check your git credentials or SSH keys'],
      },
    });
  });

  it('renders the human summary in text mode', async () => {
    gitResponds(DIRTY);
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

    await createSyncCommand().parseAsync([], { from: 'user' });

    expect(ui.success).toHaveBeenCalledWith(`Synced ${BRANCH} onto origin/main`);
    expect(ui.muted).toHaveBeenCalledWith('ahead: 3, behind: 2');
    expect(ui.muted).toHaveBeenCalledWith('auto-stash restored');
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
