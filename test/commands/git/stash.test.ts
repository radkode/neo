import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
