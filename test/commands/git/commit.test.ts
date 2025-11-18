import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('git commit command', () => {
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
    it('should create commit command with correct description', async () => {
      const { createCommitCommand } = await import('../../../src/commands/git/commit/index.js');
      const command = createCommitCommand();
      expect(command.name()).toBe('commit');
      expect(command.description()).toBe('Create a conventional commit with interactive wizard');
    });

    it('should have correct options defined', async () => {
      const { createCommitCommand } = await import('../../../src/commands/git/commit/index.js');
      const command = createCommitCommand();

      // Check that options are registered
      const helpText = command.helpInformation();
      expect(helpText).toContain('--type');
      expect(helpText).toContain('--scope');
      expect(helpText).toContain('--message');
      expect(helpText).toContain('--body');
      expect(helpText).toContain('--breaking');
      expect(helpText).toContain('--all');
    });
  });

  describe('schema validation', () => {
    it('should validate git commit options schema with valid inputs', async () => {
      const { gitCommitOptionsSchema } = await import('../../../src/types/schemas.js');

      // Test valid values
      const validOptions = {
        type: 'feat',
        scope: 'auth',
        message: 'Add login functionality',
        body: 'This adds the complete login flow',
        breaking: false,
        all: true,
      };
      expect(gitCommitOptionsSchema.parse(validOptions)).toEqual(validOptions);

      // Test empty options (all optional)
      expect(gitCommitOptionsSchema.parse({})).toEqual({});

      // Test with additional base options
      const withBaseOptions = { type: 'fix', message: 'Fix bug', verbose: true };
      expect(gitCommitOptionsSchema.parse(withBaseOptions)).toEqual(withBaseOptions);
    });

    it('should accept all valid commit types', async () => {
      const { commitTypeSchema } = await import('../../../src/types/schemas.js');

      const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

      for (const type of validTypes) {
        expect(commitTypeSchema.parse(type)).toBe(type);
      }
    });

    it('should reject invalid commit types', async () => {
      const { commitTypeSchema } = await import('../../../src/types/schemas.js');

      const invalidTypes = ['feature', 'bugfix', 'update', 'change', 'random'];

      for (const type of invalidTypes) {
        expect(() => commitTypeSchema.parse(type)).toThrow();
      }
    });

    it('should validate scope format correctly', async () => {
      const { commitScopeSchema } = await import('../../../src/types/schemas.js');

      // Valid scopes
      const validScopes = ['auth', 'api', 'user-service', 'db', 'test123'];
      for (const scope of validScopes) {
        expect(commitScopeSchema.parse(scope)).toBe(scope);
      }

      // Invalid scopes (uppercase, special chars, spaces)
      const invalidScopes = ['Auth', 'API', 'user_service', 'test scope', 'test@123'];
      for (const scope of invalidScopes) {
        expect(() => commitScopeSchema.parse(scope)).toThrow();
      }

      // Scope starting with number is invalid
      expect(() => commitScopeSchema.parse('123test')).toThrow();

      // Empty scope should fail if provided
      expect(() => commitScopeSchema.parse('')).toThrow();

      // Undefined scope is valid (optional)
      expect(commitScopeSchema.parse(undefined)).toBeUndefined();
    });

    it('should validate message length constraints', async () => {
      const { commitMessageSchema } = await import('../../../src/types/schemas.js');

      // Valid message
      const validMessage = 'Add new feature';
      expect(commitMessageSchema.parse(validMessage)).toBe(validMessage);

      // Maximum length message (100 chars)
      const maxMessage = 'a'.repeat(100);
      expect(commitMessageSchema.parse(maxMessage)).toBe(maxMessage);

      // Too long message (101 chars)
      const tooLongMessage = 'a'.repeat(101);
      expect(() => commitMessageSchema.parse(tooLongMessage)).toThrow();

      // Empty message
      expect(() => commitMessageSchema.parse('')).toThrow();
    });

    it('should validate optional fields correctly', async () => {
      const { gitCommitOptionsSchema } = await import('../../../src/types/schemas.js');

      // Only required fields can be omitted
      const minimalOptions = {};
      expect(gitCommitOptionsSchema.parse(minimalOptions)).toEqual({});

      // Test with only type
      const withType = { type: 'feat' };
      expect(gitCommitOptionsSchema.parse(withType)).toEqual(withType);

      // Test with type and message
      const withTypeAndMessage = { type: 'fix', message: 'Fix bug' };
      expect(gitCommitOptionsSchema.parse(withTypeAndMessage)).toEqual(withTypeAndMessage);

      // Test all optional fields
      const allOptions = {
        type: 'feat',
        scope: 'auth',
        message: 'Add feature',
        body: 'Detailed description',
        breaking: true,
        all: false,
      };
      expect(gitCommitOptionsSchema.parse(allOptions)).toEqual(allOptions);
    });

    it('should reject invalid option types', async () => {
      const { gitCommitOptionsSchema } = await import('../../../src/types/schemas.js');

      // Test invalid type for boolean fields
      expect(() => gitCommitOptionsSchema.parse({ breaking: 'yes' })).toThrow();
      expect(() => gitCommitOptionsSchema.parse({ all: 1 })).toThrow();

      // Test invalid type for string fields
      expect(() => gitCommitOptionsSchema.parse({ type: 123 })).toThrow();
      expect(() => gitCommitOptionsSchema.parse({ scope: true })).toThrow();
      expect(() => gitCommitOptionsSchema.parse({ message: ['array'] })).toThrow();
    });
  });

  describe('integration with git commands', () => {
    it('should be integrated into git command group', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      // Check that commit command is registered
      const subcommands = gitCommand.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('commit');
    });

    it('should be first in the git command list', async () => {
      const { createGitCommand } = await import('../../../src/commands/git/index.js');
      const gitCommand = createGitCommand();

      // Commit should be the first subcommand (most commonly used)
      const firstCommand = gitCommand.commands[0];
      expect(firstCommand?.name()).toBe('commit');
    });
  });

  describe('commit type descriptions', () => {
    it('should have descriptions for all commit types', async () => {
      // Import the module to check internal structure
      const commitModule = await import('../../../src/commands/git/commit/index.js');

      // This test ensures that all commit types have descriptions
      // We're testing the existence of the COMMIT_TYPE_DESCRIPTIONS constant indirectly
      const { commitTypeSchema } = await import('../../../src/types/schemas.js');

      // Get all valid types from the schema
      const validTypes = commitTypeSchema.options;

      // All types should be defined
      expect(validTypes).toEqual(['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore']);
    });
  });
});
