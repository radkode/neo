import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('git branch command', () => {
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
});
