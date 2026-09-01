import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createExecaMock,
  createUiMock,
  mockProcessExit,
  type ExecaResponse,
  type UiMock,
} from '../../utils/test-helpers.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  Separator: class {},
}));

vi.mock('@/utils/ui.js', () => ({
  ui: { ...createUiMock(), section: vi.fn(), keyValue: vi.fn(), divider: vi.fn() },
}));

import { execa } from 'execa';
import { select, input } from '@inquirer/prompts';
import { ui } from '@/utils/ui.js';
import { setRuntimeContext, buildRuntimeContext } from '@/utils/runtime-context.js';
import { isStashNotFoundError } from '@/utils/git-errors.js';

const execaMock = vi.mocked(execa);
const uiMock = ui as unknown as UiMock;

function mockGit(responses: Record<string, ExecaResponse | Error>): void {
  execaMock.mockImplementation(
    createExecaMock({ responses }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]
  );
}

/** An execa rejection, which embeds the failed command in `message` as well as `stderr`. */
function gitFailure(command: string, stderr: string, exitCode = 1): Error {
  const shortMessage = `Command failed with exit code ${exitCode}: ${command}`;
  const error = new Error(`${shortMessage}\n${stderr}`);
  return Object.assign(error, {
    command,
    escapedCommand: command,
    exitCode,
    shortMessage,
    stderr,
  });
}

describe('git stash command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.resetAllMocks();
  });

  describe('command structure', () => {
    it('should create unified stash command', async () => {
      const { createStashCommand } = await import('../../../src/commands/git/stash/index.js');
      const command = createStashCommand();
      expect(command.name()).toBe('stash');
      expect(command.description()).toBe('Interactively manage git stashes');
    });

    it('should be a single command without subcommands', async () => {
      const { createStashCommand } = await import('../../../src/commands/git/stash/index.js');
      const command = createStashCommand();
      // Unified command has no subcommands
      expect(command.commands.length).toBe(0);
    });
  });

  describe('stash parsing', () => {
    it('should parse stash list output correctly', async () => {
      const { parseStashList } = await import('../../../src/commands/git/stash/index.js');

      const output = `stash@{0}: WIP on main: abc1234 Add feature
stash@{1}: On develop: Fix bug
stash@{2}: WIP on feature-branch: def5678 Work in progress`;

      const entries = parseStashList(output);

      expect(entries).toHaveLength(3);
      expect(entries[0]).toMatchObject({
        index: 0,
        ref: 'stash@{0}',
        branch: 'main',
      });
      expect(entries[1]).toMatchObject({
        index: 1,
        ref: 'stash@{1}',
        branch: 'develop',
      });
      expect(entries[2]).toMatchObject({
        index: 2,
        ref: 'stash@{2}',
        branch: 'feature-branch',
      });
    });

    it('should handle empty stash list', async () => {
      const { parseStashList } = await import('../../../src/commands/git/stash/index.js');

      expect(parseStashList('')).toEqual([]);
      expect(parseStashList('   ')).toEqual([]);
    });

    it('should extract message from stash entry', async () => {
      const { parseStashList } = await import('../../../src/commands/git/stash/index.js');

      const output = 'stash@{0}: WIP on main: abc1234 My stash message';
      const entries = parseStashList(output);

      expect(entries[0]?.message).toBe('abc1234 My stash message');
    });

    it('should default to WIP when no message', async () => {
      const { parseStashList } = await import('../../../src/commands/git/stash/index.js');

      const output = 'stash@{0}: On main:';
      const entries = parseStashList(output);

      expect(entries[0]?.message).toBe('WIP');
    });
  });

  describe('utility functions', () => {
    it('should build correct stash reference', async () => {
      const { buildStashRef } = await import('../../../src/commands/git/stash/index.js');

      expect(buildStashRef(0)).toBe('stash@{0}');
      expect(buildStashRef(5)).toBe('stash@{5}');
      expect(buildStashRef(99)).toBe('stash@{99}');
    });

    it('should format relative time correctly', async () => {
      const { formatRelativeTime } = await import('../../../src/commands/git/stash/index.js');

      const now = new Date();

      // Just now
      expect(formatRelativeTime(now)).toBe('just now');

      // Minutes ago
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');

      // Hours ago
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');

      // Days ago
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
    });
  });

  describe('integration with git commands', () => {
    it('should be integrated into git command group', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      const subcommands = gitCommand.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('stash');
    });

    it('should have stash as a registered subcommand', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      const stashCommand = gitCommand.commands.find((cmd) => cmd.name() === 'stash');
      expect(stashCommand).toBeDefined();
      expect(stashCommand?.description()).toBe('Interactively manage git stashes');
    });
  });

  describe('error codes', () => {
    it('should have stash-specific error codes defined', async () => {
      const { GitErrorCode } = await import('../../../src/utils/git-errors.js');

      expect(GitErrorCode.STASH_NOT_FOUND).toBe('GIT_STASH_NOT_FOUND');
      expect(GitErrorCode.STASH_APPLY_CONFLICT).toBe('GIT_STASH_APPLY_CONFLICT');
      expect(GitErrorCode.STASH_NOTHING_TO_STASH).toBe('GIT_STASH_NOTHING_TO_STASH');
    });

    it('should have stash error factory methods', async () => {
      const { GitErrors } = await import('../../../src/utils/git-errors.js');

      const notFoundError = GitErrors.stashNotFound('stash');
      expect(notFoundError.message).toBe('Stash not found!');

      const conflictError = GitErrors.stashApplyConflict('stash');
      expect(conflictError.message).toBe('Conflicts detected when applying stash!');

      const nothingError = GitErrors.nothingToStash('stash');
      expect(nothingError.message).toBe('No changes to stash!');
    });
  });
});

const NOT_A_REPO = gitFailure(
  'git rev-parse --git-dir',
  'fatal: not a git repository (or any of the parent directories): .git',
  128
);

const DIRTY_STATUS = ['A  src/added.ts', ' M src/index.ts', '?? notes.md'].join('\n');

const CLEAN_REPO: Record<string, ExecaResponse | Error> = {
  'git rev-parse --git-dir': { stdout: '.git' },
  'git status --porcelain': { stdout: '' },
  'git stash list': { stdout: '' },
};

const REPO_WITH_ONE_STASH: Record<string, ExecaResponse | Error> = {
  ...CLEAN_REPO,
  'git stash list': { stdout: 'stash@{0}: WIP on main: abc1234 Refactor parser' },
  'git log -1 --format=%ci stash@{0}': { stdout: '2024-03-01 10:00:00 +0000' },
  'git stash show --name-only stash@{0}': { stdout: 'src/a.ts\nsrc/b.ts' },
  'git stash show --numstat stash@{0}': { stdout: '3\t1\tsrc/a.ts\n0\t4\tsrc/b.ts' },
};

const REPO_WITH_TWO_STASHES: Record<string, ExecaResponse | Error> = {
  ...REPO_WITH_ONE_STASH,
  'git stash list': {
    stdout: 'stash@{0}: WIP on main: abc1234 Refactor parser\nstash@{1}: On feature/api: Fix retry',
  },
  'git log -1 --format=%ci stash@{1}': { stdout: '2024-02-27 08:30:00 +0000' },
  'git stash show --name-only stash@{1}': { stdout: 'src/retry.ts' },
  'git stash show --numstat stash@{1}': { stdout: '9\t2\tsrc/retry.ts' },
};

describe('git stash execution', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    uiMock.spinner.mockReturnValue(uiMock._spinner);
    setRuntimeContext(buildRuntimeContext());
  });

  afterEach(() => {
    stdoutSpy?.mockRestore();
    stdoutSpy = undefined;
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
    vi.resetAllMocks();
  });

  /** Drive the menu: open the stash list, pick an entry, then choose an action. */
  function chooseStash(index: number, action: string): void {
    vi.mocked(select)
      .mockResolvedValueOnce('select')
      .mockResolvedValueOnce(index)
      .mockResolvedValueOnce(action);
  }

  it('fails with NOT_A_REPOSITORY without touching the working tree', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({ 'git rev-parse --git-dir': NOT_A_REPO });

    const result = await executeStash();

    if (result.success) throw new Error('expected executeStash to fail');
    expect(result.error.code).toBe('GIT_NOT_A_REPOSITORY');
    expect(result.error.message).toBe('Not a git repository!');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it('exits 1 and prints the git error when the command action fails', async () => {
    const { createStashCommand } = await import('../../../src/commands/git/stash/index.js');
    mockGit({ 'git rev-parse --git-dir': NOT_A_REPO });

    await createStashCommand().parseAsync([], { from: 'user' });

    expect(uiMock.error).toHaveBeenCalledWith('Not a git repository!');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('emits the working state as JSON and prompts for nothing when non-interactive', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({ ...REPO_WITH_ONE_STASH, 'git status --porcelain': { stdout: DIRTY_STATUS } });
    setRuntimeContext(buildRuntimeContext({ json: true }));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const result = await executeStash();

    expect(result.success).toBe(true);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]))).toEqual({
      ok: true,
      command: 'git.stash',
      changes: [
        { path: 'src/added.ts', status: 'added', staged: true },
        { path: 'src/index.ts', status: 'modified', staged: false },
        { path: 'notes.md', status: 'untracked', staged: false },
      ],
      stashes: [
        {
          index: 0,
          ref: 'stash@{0}',
          branch: 'main',
          message: 'abc1234 Refactor parser',
          timestamp: '2024-03-01T10:00:00.000Z',
          filesChanged: 2,
        },
      ],
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('reports an idle repository when there are no changes and no stashes', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit(CLEAN_REPO);

    const result = await executeStash();

    expect(result.success).toBe(true);
    expect(uiMock.info).toHaveBeenCalledWith('No uncommitted changes and no stashes.');
    expect(select).not.toHaveBeenCalled();
  });

  it('pushes a stash with the entered message and --include-untracked', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({ ...CLEAN_REPO, 'git status --porcelain': { stdout: DIRTY_STATUS } });
    vi.mocked(select).mockResolvedValueOnce('stash').mockResolvedValueOnce('untracked');
    vi.mocked(input).mockResolvedValueOnce('wip parser');

    const result = await executeStash();

    expect(result.success).toBe(true);
    expect(execaMock).toHaveBeenCalledWith('git', [
      'stash',
      'push',
      '-m',
      'wip parser',
      '--include-untracked',
    ]);
    expect(uiMock._spinner.succeed).toHaveBeenCalledWith('Stashed 3 files');
  });

  it('runs no git command when the stash type prompt is cancelled', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({ ...CLEAN_REPO, 'git status --porcelain': { stdout: DIRTY_STATUS } });
    vi.mocked(select).mockResolvedValueOnce('stash').mockResolvedValueOnce('cancel');

    const result = await executeStash();

    expect(result.success).toBe(true);
    expect(input).not.toHaveBeenCalled();
    const pushCall = execaMock.mock.calls.find(
      ([, args]) => Array.isArray(args) && args[0] === 'stash' && args[1] === 'push'
    );
    expect(pushCall).toBeUndefined();
  });

  it('applies the selected stash and keeps it', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit(REPO_WITH_ONE_STASH);
    chooseStash(0, 'apply');

    const result = await executeStash();

    expect(result.success).toBe(true);
    expect(execaMock).toHaveBeenCalledWith('git', ['stash', 'apply', 'stash@{0}']);
    expect(uiMock._spinner.succeed).toHaveBeenCalledWith('Stash applied (still saved)');
  });

  it('classifies a pop that leaves the entry behind as STASH_APPLY_CONFLICT', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({
      ...REPO_WITH_ONE_STASH,
      'git stash pop stash@{0}': gitFailure(
        "git stash pop 'stash@{0}'",
        'Auto-merging src/a.ts\n' +
          'CONFLICT (content): Merge conflict in src/a.ts\n' +
          'The stash entry is kept in case you need it again.'
      ),
    });
    chooseStash(0, 'pop');

    const result = await executeStash();

    if (result.success) throw new Error('expected executeStash to fail');
    expect(result.error.code).toBe('GIT_STASH_APPLY_CONFLICT');
    expect(result.error.message).toBe('Conflicts detected when applying stash!');
    expect(uiMock._spinner.fail).toHaveBeenCalledWith('Conflicts detected');
    expect(uiMock.warn).toHaveBeenCalledWith('Resolve conflicts manually, then:');
  });

  it('classifies "could not apply stash" as STASH_APPLY_CONFLICT', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({
      ...REPO_WITH_ONE_STASH,
      'git stash apply stash@{0}': gitFailure(
        "git stash apply 'stash@{0}'",
        'CONFLICT (content): Merge conflict in src/a.ts\n' +
          'error: could not apply stash entry stash@{0}'
      ),
    });
    chooseStash(0, 'apply');

    const result = await executeStash();

    if (result.success) throw new Error('expected executeStash to fail');
    expect(result.error.code).toBe('GIT_STASH_APPLY_CONFLICT');
  });

  it('classifies a dirty-tree refusal as UNCOMMITTED_CHANGES, not as the ref it names', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    const applyError = gitFailure(
      "git stash apply 'stash@{0}'",
      'error: Your local changes to the following files would be overwritten by merge:\n' +
        '\tsrc/a.ts\n' +
        'Please commit your changes or stash them before you merge.\n' +
        'Aborting'
    );
    expect(isStashNotFoundError(applyError)).toBe(true);
    mockGit({ ...REPO_WITH_ONE_STASH, 'git stash apply stash@{0}': applyError });
    chooseStash(0, 'apply');

    const result = await executeStash();

    if (result.success) throw new Error('expected executeStash to fail');
    expect(result.error.code).toBe('GIT_UNCOMMITTED_CHANGES');
    expect(result.error.message).toBe('You have uncommitted changes.');
    expect(uiMock._spinner.fail).toHaveBeenCalledWith('Failed to apply stash');
  });

  it('classifies a vanished stash ref as STASH_NOT_FOUND', async () => {
    const { executeStash } = await import('../../../src/commands/git/stash/index.js');
    mockGit({
      ...REPO_WITH_TWO_STASHES,
      'git stash apply stash@{1}': gitFailure(
        "git stash apply 'stash@{1}'",
        "fatal: log for 'refs/stash' only has 1 entries"
      ),
    });
    chooseStash(1, 'apply');

    const result = await executeStash();

    if (result.success) throw new Error('expected executeStash to fail');
    expect(result.error.code).toBe('GIT_STASH_NOT_FOUND');
    expect(result.error.message).toBe('Stash not found!');
    expect(uiMock._spinner.fail).toHaveBeenCalledWith('Stash not found');
  });
});
