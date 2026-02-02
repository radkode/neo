import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
      const { getWorktreePath, getWorktreesBaseDir } = await import(
        '../../../src/commands/git/worktree/utils.js'
      );
      const os = await import('os');
      const path = await import('path');

      const baseDir = getWorktreesBaseDir();
      expect(baseDir).toBe(path.join(os.homedir(), '.neo', 'worktrees'));

      const result = getWorktreePath('my-repo', 'feature/my-branch');
      expect(result).toBe(path.join(os.homedir(), '.neo', 'worktrees', 'my-repo', 'feature-my-branch'));
    });

    it('should sanitize branch names in paths', async () => {
      const { getWorktreePath } = await import('../../../src/commands/git/worktree/utils.js');
      const os = await import('os');
      const path = await import('path');

      // Slashes should be replaced with dashes
      const result1 = getWorktreePath('repo', 'feature/test/branch');
      expect(result1).toBe(path.join(os.homedir(), '.neo', 'worktrees', 'repo', 'feature-test-branch'));

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
      expect(checkedOutError.message).toBe('Branch "my-branch" is already checked out in another worktree!');
    });
  });

  describe('subcommand structure', () => {
    it('should have correct add command options', async () => {
      const { createWorktreeAddCommand } = await import('../../../src/commands/git/worktree/add.js');
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
      const { createWorktreeRemoveCommand } = await import('../../../src/commands/git/worktree/remove.js');
      const removeCommand = createWorktreeRemoveCommand();

      expect(removeCommand.name()).toBe('remove');
      expect(removeCommand.description()).toBe('Remove a worktree');

      const optionNames = removeCommand.options.map((opt) => opt.long);
      expect(optionNames).toContain('--force');
    });

    it('should have correct list command', async () => {
      const { createWorktreeListCommand } = await import('../../../src/commands/git/worktree/list.js');
      const listCommand = createWorktreeListCommand();

      expect(listCommand.name()).toBe('list');
      expect(listCommand.description()).toBe('List all worktrees');
    });

    it('should have correct switch command', async () => {
      const { createWorktreeSwitchCommand } = await import('../../../src/commands/git/worktree/switch.js');
      const switchCommand = createWorktreeSwitchCommand();

      expect(switchCommand.name()).toBe('switch');
      expect(switchCommand.description()).toBe('Interactively select and switch to a worktree');
    });
  });
});
