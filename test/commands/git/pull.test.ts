import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('git pull command', () => {
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
    it('should create pull command with correct description', async () => {
      // This test verifies that the command can be created
      const { createPullCommand } = await import('../../../src/commands/git/pull/index.js');
      const command = createPullCommand();
      expect(command.name()).toBe('pull');
      expect(command.description()).toBe(
        'Pull changes from remote repository with automatic rebase fallback'
      );
    });
  });

  describe('schema validation', () => {
    it('should validate deleted branch action schema', async () => {
      // Import the schema to test it directly
      const { deletedBranchActionSchema } = await import('../../../src/types/schemas.js');

      // Test valid values
      expect(deletedBranchActionSchema.parse('switch_main_delete')).toBe('switch_main_delete');
      expect(deletedBranchActionSchema.parse('switch_main_keep')).toBe('switch_main_keep');
      expect(deletedBranchActionSchema.parse('set_upstream')).toBe('set_upstream');
      expect(deletedBranchActionSchema.parse('cancel')).toBe('cancel');

      // Test invalid value
      expect(() => deletedBranchActionSchema.parse('invalid')).toThrow();
    });
  });
});
