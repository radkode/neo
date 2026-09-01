import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createExecaMock,
  createTempDir,
  createUiMock,
  type ExecaResponse,
  type TempDir,
  type UiMock,
} from '../../utils/test-helpers.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  Separator: class {},
}));

vi.mock('@/utils/ui.js', () => ({
  ui: { ...createUiMock(), section: vi.fn(), keyValue: vi.fn(), code: vi.fn(), divider: vi.fn() },
}));

import { join } from 'path';
import { execa } from 'execa';
import { confirm, select } from '@inquirer/prompts';
import { ui } from '@/utils/ui.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { GitErrorCode } from '@/utils/git-errors.js';
import { executeWorktreeAdd } from '@/commands/git/worktree/add.js';
import { executeWorktreeList } from '@/commands/git/worktree/list.js';
import { executeWorktreeRemove } from '@/commands/git/worktree/remove.js';
import { executeWorktreeSwitch } from '@/commands/git/worktree/switch.js';

type WorktreeUiMock = UiMock & {
  code: ReturnType<typeof vi.fn>;
  keyValue: ReturnType<typeof vi.fn>;
  section: ReturnType<typeof vi.fn>;
};

const execaMock = vi.mocked(execa);
const uiMock = ui as unknown as WorktreeUiMock;

function mockGit(responses: Record<string, ExecaResponse | Error>): void {
  execaMock.mockImplementation(
    createExecaMock({ responses }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]
  );
}

const MAIN_HEAD = '9c0f2b1a4d5e6f708192a3b4c5d6e7f809a1b2c3';
const FEATURE_HEAD = '1f2e3d4c5b6a798071625344556677889900aabb';
const DETACHED_HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const RELEASE_HEAD = '00112233445566778899aabbccddeeff00112233';

const MAIN_PATH = '/repo';
const FEATURE_PATH = '/repo/.worktrees/fix-foo';
const DETACHED_PATH = '/repo/.worktrees/detached';
const RELEASE_PATH = '/repo/.worktrees/release';

const ONLY_MAIN_PORCELAIN = [
  'worktree /repo',
  `HEAD ${MAIN_HEAD}`,
  'branch refs/heads/main',
  '',
].join('\n');

const THREE_WORKTREES_PORCELAIN = [
  'worktree /repo',
  `HEAD ${MAIN_HEAD}`,
  'branch refs/heads/main',
  '',
  'worktree /repo/.worktrees/fix-foo',
  `HEAD ${FEATURE_HEAD}`,
  'branch refs/heads/jacek/fix-foo',
  '',
  'worktree /repo/.worktrees/detached',
  `HEAD ${DETACHED_HEAD}`,
  'detached',
  '',
].join('\n');

const LOCKED_WORKTREE_PORCELAIN = [
  'worktree /repo',
  `HEAD ${MAIN_HEAD}`,
  'branch refs/heads/main',
  '',
  'worktree /repo/.worktrees/release',
  `HEAD ${RELEASE_HEAD}`,
  'branch refs/heads/release/1.2',
  'locked in use by CI',
  '',
].join('\n');

/** Route `git worktree list --porcelain` to a fixture and mark the given paths dirty. */
function mockWorktreeGit(porcelain: string, dirtyPaths: string[] = []): void {
  const responses: Record<string, ExecaResponse | Error> = {
    'git worktree list': { stdout: porcelain },
  };
  for (const path of dirtyPaths) {
    responses[`git -C ${path} status`] = { stdout: ' M src/index.ts' };
  }
  mockGit(responses);
}

async function captureJsonOutput(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    await run();
    const writes = writeSpy.mock.calls.map((call) => String(call[0]));
    expect(writes).toHaveLength(1);
    return JSON.parse(writes.join('')) as Record<string, unknown>;
  } finally {
    writeSpy.mockRestore();
  }
}

describe('git worktree command', () => {
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
    it('should create worktree command with subcommands', async () => {
      const { createWorktreeCommand } = await import('../../../src/commands/git/worktree/index.js');
      const command = createWorktreeCommand();
      expect(command.name()).toBe('worktree');
      expect(command.description()).toBe('Manage git worktrees');
    });

    it('should have list, add, remove, switch subcommands', async () => {
      const { createWorktreeCommand } = await import('../../../src/commands/git/worktree/index.js');
      const command = createWorktreeCommand();
      const subcommands = command.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('add');
      expect(subcommands).toContain('remove');
      expect(subcommands).toContain('switch');
    });
  });

  describe('worktree parsing', () => {
    it('should parse worktree list output correctly', async () => {
      const { parseWorktreeList } = await import('../../../src/commands/git/worktree/utils.js');

      const output = `worktree /path/to/main
HEAD abc1234567890
branch refs/heads/main

worktree /path/to/feature
HEAD def4567890123
branch refs/heads/feature-branch
`;

      const worktrees = parseWorktreeList(output);

      expect(worktrees).toHaveLength(2);
      expect(worktrees[0]).toMatchObject({
        path: '/path/to/main',
        head: 'abc1234567890',
        branch: 'main',
      });
      expect(worktrees[1]).toMatchObject({
        path: '/path/to/feature',
        head: 'def4567890123',
        branch: 'feature-branch',
      });
    });

    it('should handle detached worktrees', async () => {
      const { parseWorktreeList } = await import('../../../src/commands/git/worktree/utils.js');

      const output = `worktree /path/to/detached
HEAD abc1234567890
detached
`;

      const worktrees = parseWorktreeList(output);

      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]?.branch).toBeNull();
    });

    it('should handle locked worktrees', async () => {
      const { parseWorktreeList } = await import('../../../src/commands/git/worktree/utils.js');

      const output = `worktree /path/to/locked
HEAD abc1234567890
branch refs/heads/locked-branch
locked reason: in use
`;

      const worktrees = parseWorktreeList(output);

      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]?.isLocked).toBe(true);
      expect(worktrees[0]?.lockReason).toBe('reason: in use');
    });

    it('should handle empty output', async () => {
      const { parseWorktreeList } = await import('../../../src/commands/git/worktree/utils.js');

      expect(parseWorktreeList('')).toEqual([]);
      expect(parseWorktreeList('   ')).toEqual([]);
    });
  });

  describe('utility functions', () => {
    it('should format worktree status correctly', async () => {
      const { formatWorktreeStatus } = await import('../../../src/commands/git/worktree/utils.js');

      expect(
        formatWorktreeStatus({
          path: '/path',
          head: 'abc',
          branch: 'main',
          isMain: true,
          isLocked: false,
          isDirty: false,
        })
      ).toBe('(main)');

      expect(
        formatWorktreeStatus({
          path: '/path',
          head: 'abc',
          branch: 'feature',
          isMain: false,
          isLocked: true,
          isDirty: true,
        })
      ).toBe('(locked, dirty)');

      expect(
        formatWorktreeStatus({
          path: '/path',
          head: 'abc',
          branch: null,
          isMain: false,
          isLocked: false,
          isDirty: false,
        })
      ).toBe('(detached)');

      expect(
        formatWorktreeStatus({
          path: '/path',
          head: 'abc',
          branch: 'feature',
          isMain: false,
          isLocked: false,
          isDirty: false,
        })
      ).toBe('');
    });

    it('should generate correct worktree paths', async () => {
      const { getWorktreePath, getWorktreesBaseDir } =
        await import('../../../src/commands/git/worktree/utils.js');
      const os = await import('os');
      const path = await import('path');

      const baseDir = getWorktreesBaseDir();
      expect(baseDir).toBe(path.join(os.homedir(), '.neo', 'worktrees'));

      const result = getWorktreePath('my-repo', 'feature/my-branch');
      expect(result).toBe(
        path.join(os.homedir(), '.neo', 'worktrees', 'my-repo', 'feature-my-branch')
      );
    });

    it('should sanitize branch names in paths', async () => {
      const { getWorktreePath } = await import('../../../src/commands/git/worktree/utils.js');
      const os = await import('os');
      const path = await import('path');

      // Slashes should be replaced with dashes
      const result1 = getWorktreePath('repo', 'feature/test/branch');
      expect(result1).toBe(
        path.join(os.homedir(), '.neo', 'worktrees', 'repo', 'feature-test-branch')
      );

      // Special characters should be removed
      const result2 = getWorktreePath('repo', 'fix@bug#123');
      expect(result2).toBe(path.join(os.homedir(), '.neo', 'worktrees', 'repo', 'fixbug123'));
    });
  });

  describe('integration with git commands', () => {
    it('should be integrated into git command group', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      const subcommands = gitCommand.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('worktree');
    });

    it('should have worktree as a registered subcommand', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      const worktreeCommand = gitCommand.commands.find((cmd) => cmd.name() === 'worktree');
      expect(worktreeCommand).toBeDefined();
      expect(worktreeCommand?.description()).toBe('Manage git worktrees');
    });
  });

  describe('error codes', () => {
    it('should have worktree-specific error codes defined', async () => {
      const { GitErrorCode } = await import('../../../src/utils/git-errors.js');

      expect(GitErrorCode.WORKTREE_NOT_FOUND).toBe('GIT_WORKTREE_NOT_FOUND');
      expect(GitErrorCode.WORKTREE_ALREADY_EXISTS).toBe('GIT_WORKTREE_ALREADY_EXISTS');
      expect(GitErrorCode.WORKTREE_BRANCH_CHECKED_OUT).toBe('GIT_WORKTREE_BRANCH_CHECKED_OUT');
    });

    it('should have worktree error factory methods', async () => {
      const { GitErrors } = await import('../../../src/utils/git-errors.js');

      const notFoundError = GitErrors.worktreeNotFound('worktree', '/path/to/worktree');
      expect(notFoundError.message).toBe('Worktree not found: /path/to/worktree');

      const existsError = GitErrors.worktreeAlreadyExists('worktree', '/path/to/worktree');
      expect(existsError.message).toBe('Worktree already exists at: /path/to/worktree');

      const checkedOutError = GitErrors.worktreeBranchCheckedOut('worktree', 'my-branch');
      expect(checkedOutError.message).toBe(
        'Branch "my-branch" is already checked out in another worktree!'
      );
    });
  });

  describe('subcommand structure', () => {
    it('should have correct add command options', async () => {
      const { createWorktreeAddCommand } =
        await import('../../../src/commands/git/worktree/add.js');
      const addCommand = createWorktreeAddCommand();

      expect(addCommand.name()).toBe('add');
      expect(addCommand.description()).toBe('Create a worktree for a branch');

      const optionNames = addCommand.options.map((opt) => opt.long);
      expect(optionNames).toContain('--branch');
      expect(optionNames).toContain('--detach');
      expect(optionNames).toContain('--force');
      expect(optionNames).toContain('--lock');
      expect(optionNames).toContain('--path');
    });

    it('should have correct remove command options', async () => {
      const { createWorktreeRemoveCommand } =
        await import('../../../src/commands/git/worktree/remove.js');
      const removeCommand = createWorktreeRemoveCommand();

      expect(removeCommand.name()).toBe('remove');
      expect(removeCommand.description()).toBe('Remove a worktree');

      const optionNames = removeCommand.options.map((opt) => opt.long);
      expect(optionNames).toContain('--force');
    });

    it('should have correct list command', async () => {
      const { createWorktreeListCommand } =
        await import('../../../src/commands/git/worktree/list.js');
      const listCommand = createWorktreeListCommand();

      expect(listCommand.name()).toBe('list');
      expect(listCommand.description()).toBe('List all worktrees');
    });

    it('should have correct switch command', async () => {
      const { createWorktreeSwitchCommand } =
        await import('../../../src/commands/git/worktree/switch.js');
      const switchCommand = createWorktreeSwitchCommand();

      expect(switchCommand.name()).toBe('switch');
      expect(switchCommand.description()).toBe('Interactively select and switch to a worktree');
    });
  });

  describe('executeWorktreeAdd', () => {
    let tempDir: TempDir;

    beforeEach(async () => {
      uiMock.spinner.mockImplementation(() => uiMock._spinner);
      setRuntimeContext(buildRuntimeContext());
      tempDir = await createTempDir('neo-worktree-');
      mockGit({ 'git remote get-url': { stdout: 'git@github.com:radkode/neo.git' } });
    });

    afterEach(async () => {
      setRuntimeContext(buildRuntimeContext());
      await tempDir.cleanup();
    });

    it('fails with WORKTREE_ALREADY_EXISTS when the target path is taken', async () => {
      const result = await executeWorktreeAdd('jacek/fix-foo', { path: tempDir.path });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(GitErrorCode.WORKTREE_ALREADY_EXISTS);
        expect(result.error.message).toBe(`Worktree already exists at: ${tempDir.path}`);
      }
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add'])
      );
      expect(uiMock._spinner.start).not.toHaveBeenCalled();
    });

    it('maps an "already checked out" git failure to WORKTREE_BRANCH_CHECKED_OUT', async () => {
      const worktreePath = join(tempDir.path, 'fix-foo');
      const gitError = Object.assign(new Error('Command failed with exit code 128'), {
        stderr: `fatal: 'jacek/fix-foo' is already checked out at '/repo/.worktrees/fix-foo'`,
        exitCode: 128,
      });
      mockGit({ 'git worktree add': gitError });

      const result = await executeWorktreeAdd('jacek/fix-foo', { path: worktreePath });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(GitErrorCode.WORKTREE_BRANCH_CHECKED_OUT);
        expect(result.error.message).toBe(
          'Branch "jacek/fix-foo" is already checked out in another worktree!'
        );
      }
      expect(uiMock._spinner.fail).toHaveBeenCalledWith('Failed to create worktree');
    });

    it('emits the add payload as JSON and passes -b for a new branch', async () => {
      const worktreePath = join(tempDir.path, 'feature-x');
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const payload = await captureJsonOutput(() =>
        executeWorktreeAdd('main', { path: worktreePath, branch: 'feature-x' })
      );

      expect(payload).toEqual({
        ok: true,
        command: 'git.worktree.add',
        path: worktreePath,
        branch: 'feature-x',
      });
      expect(execaMock).toHaveBeenCalledWith('git', [
        'worktree',
        'add',
        '-b',
        'feature-x',
        worktreePath,
        'main',
      ]);
      expect(uiMock.keyValue).not.toHaveBeenCalled();
    });

    it('forwards --force, --lock and --detach and renders the cd hint in text mode', async () => {
      const worktreePath = join(tempDir.path, 'detached');

      const result = await executeWorktreeAdd('9c0f2b1', {
        path: worktreePath,
        force: true,
        lock: true,
        detach: true,
      });

      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith('git', [
        'worktree',
        'add',
        '--force',
        '--lock',
        '--detach',
        worktreePath,
        '9c0f2b1',
      ]);
      expect(uiMock.keyValue).toHaveBeenCalledWith([
        ['Path', worktreePath],
        ['Branch', '9c0f2b1'],
      ]);
      expect(uiMock.code).toHaveBeenCalledWith(`cd ${worktreePath}`);
      expect(uiMock._spinner.succeed).toHaveBeenCalledWith(`Created worktree at ${worktreePath}`);
    });
  });

  describe('executeWorktreeList', () => {
    beforeEach(() => {
      uiMock.spinner.mockImplementation(() => uiMock._spinner);
      setRuntimeContext(buildRuntimeContext());
    });

    afterEach(() => {
      setRuntimeContext(buildRuntimeContext());
    });

    it('emits every parsed worktree as JSON with its computed status', async () => {
      mockWorktreeGit(THREE_WORKTREES_PORCELAIN, [FEATURE_PATH]);
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const payload = await captureJsonOutput(() => executeWorktreeList());

      expect(payload).toEqual({
        ok: true,
        command: 'git.worktree.list',
        count: 3,
        worktrees: [
          {
            path: MAIN_PATH,
            branch: 'main',
            head: MAIN_HEAD,
            detached: false,
            status: '(main)',
          },
          {
            path: FEATURE_PATH,
            branch: 'jacek/fix-foo',
            head: FEATURE_HEAD,
            detached: false,
            status: '(dirty)',
          },
          {
            path: DETACHED_PATH,
            branch: null,
            head: DETACHED_HEAD,
            detached: true,
            status: '(detached)',
          },
        ],
      });
    });

    it('renders a table of worktrees in text mode', async () => {
      mockWorktreeGit(THREE_WORKTREES_PORCELAIN, [FEATURE_PATH]);

      const result = await executeWorktreeList();

      expect(result.success).toBe(true);
      expect(uiMock.table).toHaveBeenCalledWith({
        headers: ['Path', 'Branch', 'Commit', 'Status'],
        rows: [
          [MAIN_PATH, 'main', MAIN_HEAD.substring(0, 8), '(main)'],
          [FEATURE_PATH, 'jacek/fix-foo', FEATURE_HEAD.substring(0, 8), '(dirty)'],
          [DETACHED_PATH, '(detached)', DETACHED_HEAD.substring(0, 8), '(detached)'],
        ],
      });
      expect(uiMock._spinner.succeed).toHaveBeenCalledWith('Found 3 worktree(s)');
    });

    it('fails with NOT_A_REPOSITORY when git is not in a repository', async () => {
      mockGit({
        'git worktree list': Object.assign(new Error('Command failed with exit code 128'), {
          stderr: 'fatal: not a git repository (or any of the parent directories): .git',
          exitCode: 128,
        }),
      });

      const result = await executeWorktreeList();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(GitErrorCode.NOT_A_REPOSITORY);
      }
      expect(uiMock._spinner.fail).toHaveBeenCalledWith('Failed to list worktrees');
    });
  });

  describe('executeWorktreeRemove', () => {
    beforeEach(() => {
      uiMock.spinner.mockImplementation(() => uiMock._spinner);
      setRuntimeContext(buildRuntimeContext());
      mockWorktreeGit(THREE_WORKTREES_PORCELAIN, [FEATURE_PATH]);
    });

    afterEach(() => {
      setRuntimeContext(buildRuntimeContext());
    });

    it('fails with WORKTREE_NOT_FOUND for a path that is not a worktree', async () => {
      const result = await executeWorktreeRemove('/repo/.worktrees/nope', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(GitErrorCode.WORKTREE_NOT_FOUND);
        expect(result.error.message).toBe('Worktree not found: /repo/.worktrees/nope');
      }
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('refuses to remove the main worktree', async () => {
      const result = await executeWorktreeRemove(MAIN_PATH, {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(GitErrorCode.UNKNOWN);
      }
      expect(uiMock.error).toHaveBeenCalledWith('Cannot remove the main worktree!');
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('throws NonInteractiveError for a dirty worktree without --force', async () => {
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const error = await executeWorktreeRemove(FEATURE_PATH, {}).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NonInteractiveError);
      expect((error as NonInteractiveError).flag).toBe('--force');
      expect((error as NonInteractiveError).message).toContain(
        `Worktree at ${FEATURE_PATH} has uncommitted changes`
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('throws NonInteractiveError for a locked worktree without --force', async () => {
      mockWorktreeGit(LOCKED_WORKTREE_PORCELAIN);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const error = await executeWorktreeRemove(RELEASE_PATH, {}).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NonInteractiveError);
      expect((error as NonInteractiveError).flag).toBe('--force');
      expect((error as NonInteractiveError).message).toContain(
        `Worktree at ${RELEASE_PATH} is locked`
      );
      expect(uiMock.warn).toHaveBeenCalledWith('Worktree is locked: in use by CI');
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('keeps a dirty worktree when the confirmation is declined', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      const result = await executeWorktreeRemove(FEATURE_PATH, {});

      expect(result.success).toBe(true);
      expect(uiMock.muted).toHaveBeenCalledWith('Cancelled. Worktree not removed.');
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('removes a confirmed dirty worktree with --force', async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      const result = await executeWorktreeRemove(FEATURE_PATH, {});

      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith('git', [
        'worktree',
        'remove',
        '--force',
        FEATURE_PATH,
      ]);
      expect(uiMock._spinner.succeed).toHaveBeenCalledWith(`Removed worktree at ${FEATURE_PATH}`);
    });

    it('keeps a locked worktree when force removal is declined', async () => {
      mockWorktreeGit(LOCKED_WORKTREE_PORCELAIN);
      vi.mocked(confirm).mockResolvedValue(false);

      const result = await executeWorktreeRemove(RELEASE_PATH, {});

      expect(result.success).toBe(true);
      expect(confirm).toHaveBeenCalledWith({
        message: 'Force remove locked worktree?',
        default: false,
      });
      expect(uiMock.muted).toHaveBeenCalledWith('Cancelled. Worktree not removed.');
      expect(execaMock).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove'])
      );
    });

    it('force-removes a confirmed locked worktree', async () => {
      mockWorktreeGit(LOCKED_WORKTREE_PORCELAIN);
      vi.mocked(confirm).mockResolvedValue(true);

      const result = await executeWorktreeRemove(RELEASE_PATH, {});

      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith('git', [
        'worktree',
        'remove',
        '--force',
        RELEASE_PATH,
      ]);
    });

    it('resolves a path suffix and emits the removal payload as JSON', async () => {
      mockWorktreeGit(THREE_WORKTREES_PORCELAIN);
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const payload = await captureJsonOutput(() =>
        executeWorktreeRemove('.worktrees/fix-foo', {})
      );

      expect(payload).toEqual({
        ok: true,
        command: 'git.worktree.remove',
        path: FEATURE_PATH,
      });
      expect(execaMock).toHaveBeenCalledWith('git', ['worktree', 'remove', FEATURE_PATH]);
    });
  });

  describe('executeWorktreeSwitch', () => {
    beforeEach(() => {
      uiMock.spinner.mockImplementation(() => uiMock._spinner);
      setRuntimeContext(buildRuntimeContext());
      mockWorktreeGit(THREE_WORKTREES_PORCELAIN, [FEATURE_PATH]);
    });

    afterEach(() => {
      setRuntimeContext(buildRuntimeContext());
    });

    it('emits the worktree list instead of prompting in non-interactive mode', async () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));

      const payload = await captureJsonOutput(() => executeWorktreeSwitch());

      expect(payload).toEqual({
        ok: true,
        command: 'git.worktree.switch',
        worktrees: [
          {
            branch: 'main',
            path: MAIN_PATH,
            head: MAIN_HEAD,
            isDirty: false,
            isLocked: false,
            isMain: true,
          },
          {
            branch: 'jacek/fix-foo',
            path: FEATURE_PATH,
            head: FEATURE_HEAD,
            isDirty: true,
            isLocked: false,
            isMain: false,
          },
          {
            branch: null,
            path: DETACHED_PATH,
            head: DETACHED_HEAD,
            isDirty: false,
            isLocked: false,
            isMain: false,
          },
        ],
      });
      expect(select).not.toHaveBeenCalled();
    });

    it('reports the selected worktree as a cd command', async () => {
      vi.mocked(select).mockResolvedValue(1);

      const result = await executeWorktreeSwitch();

      expect(result).toEqual({ success: true, data: FEATURE_PATH });
      expect(uiMock.code).toHaveBeenCalledWith(`cd ${FEATURE_PATH}`);
      expect(uiMock.table).toHaveBeenCalledWith({
        headers: ['#', 'Branch', 'Path', 'Status'],
        rows: [
          ['1', 'main', MAIN_PATH, '(main)'],
          ['2', 'jacek/fix-foo', FEATURE_PATH, '(dirty)'],
          ['3', '(detached)', DETACHED_PATH, '(detached)'],
        ],
      });
    });

    it('returns nothing when the selection is cancelled', async () => {
      vi.mocked(select).mockResolvedValue(-1);

      const result = await executeWorktreeSwitch();

      expect(result).toEqual({ success: true, data: null });
      expect(uiMock.muted).toHaveBeenCalledWith('Cancelled.');
      expect(uiMock.code).not.toHaveBeenCalled();
    });

    it('skips the prompt when only the main worktree exists', async () => {
      mockWorktreeGit(ONLY_MAIN_PORCELAIN);

      const result = await executeWorktreeSwitch();

      expect(result).toEqual({ success: true, data: null });
      expect(uiMock.info).toHaveBeenCalledWith('No additional worktrees found.');
      expect(select).not.toHaveBeenCalled();
    });
  });
});
