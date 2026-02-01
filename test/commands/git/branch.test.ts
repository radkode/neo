import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit, createSpinnerMock } from '../../utils/test-helpers.js';

// Mock all dependencies before importing the module
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

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
    success: vi.fn(),
    warn: vi.fn(),
    muted: vi.fn(),
    keyValue: vi.fn(),
    section: vi.fn(),
    list: vi.fn(),
    spinner: vi.fn(() => createSpinnerMock()),
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((schema, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

import { execa, type ExecaReturnValue } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';

describe('git branch command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitMock = mockProcessExit();
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitMock.mockRestore();
    vi.resetAllMocks();
  });

  describe('command structure', () => {
    it('should create branch command with correct description', async () => {
      const { createBranchCommand } = await import('../../../src/commands/git/branch/index.js');
      const command = createBranchCommand();
      expect(command.name()).toBe('branch');
      expect(command.description()).toBe('Analyze and manage local git branches');
    });

    it('should have correct options defined', async () => {
      const { createBranchCommand } = await import('../../../src/commands/git/branch/index.js');
      const command = createBranchCommand();

      // Check that options are registered
      const helpText = command.helpInformation();
      expect(helpText).toContain('--dry-run');
      expect(helpText).toContain('--force');
    });
  });

  describe('schema validation', () => {
    it('should validate git branch options schema', async () => {
      const { gitBranchOptionsSchema } = await import('../../../src/types/schemas.js');

      // Test valid values
      const validOptions = { dryRun: true, force: false };
      expect(gitBranchOptionsSchema.parse(validOptions)).toEqual(validOptions);

      // Test empty options (all optional)
      expect(gitBranchOptionsSchema.parse({})).toEqual({});

      // Test with additional base options
      const withBaseOptions = { dryRun: true, verbose: true };
      expect(gitBranchOptionsSchema.parse(withBaseOptions)).toEqual(withBaseOptions);
    });

    it('should reject invalid option types', async () => {
      const { gitBranchOptionsSchema } = await import('../../../src/types/schemas.js');

      // Test invalid types
      expect(() => gitBranchOptionsSchema.parse({ dryRun: 'yes' })).toThrow();
      expect(() => gitBranchOptionsSchema.parse({ force: 1 })).toThrow();
    });
  });

  describe('integration with git commands', () => {
    it('should be integrated into git command group', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      // Check that branch command is registered
      const subcommands = gitCommand.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('branch');
    });
  });

  describe('executeBranch', () => {
    it('should handle not being in a git repository', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not a git repository'));

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(false);
    });

    it('should analyze branches successfully with all tracked branches', async () => {
      // Mock git rev-parse (verify git repo)
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv - all branches have remote tracking
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial commit\n  feature def456 [origin/feature] Feature work',
      } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
      expect(ui.success).toHaveBeenCalledWith(
        expect.stringContaining('All branches are either protected')
      );
    });

    it('should show cleanup candidates in dry run mode', async () => {
      // Mock git rev-parse (verify git repo)
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with untracked branch
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial commit\n  old-feature def456 Old feature',
      } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({ dryRun: true });

      expect(result.success).toBe(true);
      expect(ui.warn).toHaveBeenCalledWith('Dry run mode - no branches will be deleted');
    });

    it('should prompt for cleanup action', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with untracked branch
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial commit\n  old-feature def456 Old feature',
      } as ExecaReturnValue<string>);

      // Mock user cancels
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'cancel' });

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
      expect(ui.muted).toHaveBeenCalledWith('Operation cancelled. No branches were deleted.');
    });

    it('should handle delete all action', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with untracked branch
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial commit\n  old-feature def456 Old feature',
      } as ExecaReturnValue<string>);

      // Mock user selects delete all
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ action: 'delete_all' })
        .mockResolvedValueOnce({ confirm: true });

      // Mock successful branch deletion
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
      expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('Deleted branch'));
    });

    it('should handle select specific branches action', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with untracked branches
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial\n  feat-a def456 A\n  feat-b ghi789 B',
      } as ExecaReturnValue<string>);

      // Mock user selects specific branches
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ action: 'delete_selected' })
        .mockResolvedValueOnce({ selectedBranches: ['feat-a'] })
        .mockResolvedValueOnce({ confirm: true });

      // Mock successful branch deletion
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
    });

    it('should handle no branches found error', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv returns empty
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(false);
    });

    it('should handle branches with deleted remote', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with deleted remote branch
      vi.mocked(execa).mockResolvedValueOnce({
        stdout:
          '* main abc123 [origin/main] Initial commit\n  stale def456 [origin/stale: gone] Old work',
      } as ExecaReturnValue<string>);

      // Mock user cancels
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'cancel' });

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
      // Should detect deleted remote branch
      expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('branch(es) available for cleanup'));
    });

    it('should skip protected branches', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with protected branches
      vi.mocked(execa).mockResolvedValueOnce({
        stdout:
          '* main abc123 [origin/main] Initial\n  develop def456 Dev\n  staging ghi789 Stage',
      } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
      // Protected branches should not be candidates for cleanup
      expect(ui.success).toHaveBeenCalledWith(
        expect.stringContaining('All branches are either protected')
      );
    });

    it('should handle force mode without confirmation', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv with untracked branch
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial\n  old-feature def456 Old',
      } as ExecaReturnValue<string>);

      // Mock delete all action
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'delete_all' });

      // Mock successful branch deletion
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({ force: true });

      expect(result.success).toBe(true);
      // Should not have been asked to confirm
      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    });

    it('should handle unmerged branch with squash merge detection', async () => {
      // Mock git rev-parse
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '.git' } as ExecaReturnValue<string>);

      // Mock git branch -vv
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '* main abc123 [origin/main] Initial\n  old-feature def456 Old',
      } as ExecaReturnValue<string>);

      // Mock delete all action and confirmation
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ action: 'delete_all' })
        .mockResolvedValueOnce({ confirm: true });

      // Mock branch deletion fails with "not fully merged"
      const unmergedError = new Error('not fully merged');
      vi.mocked(execa).mockRejectedValueOnce(unmergedError);

      // Mock squash merge detection - show-ref for main
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'refs/heads/main' } as ExecaReturnValue<string>);

      // Mock merge-base
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'abc123' } as ExecaReturnValue<string>);

      // Mock diff (branch content)
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '+added line\n-removed line',
      } as ExecaReturnValue<string>);

      // Mock rev-list (recent commits)
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'commit1\ncommit2' } as ExecaReturnValue<string>);

      // Mock git show for each commit
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '+added line\n-removed line',
      } as ExecaReturnValue<string>);

      // Mock force delete after squash merge detection
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as ExecaReturnValue<string>);

      const { executeBranch } = await import('../../../src/commands/git/branch/index.js');
      const result = await executeBranch({});

      expect(result.success).toBe(true);
    });
  });
});
