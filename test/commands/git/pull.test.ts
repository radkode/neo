import { execa } from 'execa';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptSelect } from '@/utils/prompt.js';

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

vi.mock('@/utils/prompt.js', () => {
  const promptSelect = vi.fn();
  return { promptSelect };
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
  },
}));

describe('git pull command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    spinnerMock.start.mockClear();
    spinnerMock.stop.mockClear();
    spinnerMock.succeed.mockClear();
    spinnerMock.text = '';
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitMock.mockRestore();
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

  describe('multiple branches error', () => {
    it('retries with explicit branch when pull fails with multiple branches error', async () => {
      const { createPullCommand } = await import('../../../src/commands/git/pull/index.js');

      execaMock.mockResolvedValueOnce({ stdout: 'main' }); // branch name
      execaMock.mockResolvedValueOnce({ stdout: '' }); // upstream check
      const multiBranchError = new Error('fatal: Cannot fast-forward to multiple branches.');
      execaMock.mockRejectedValueOnce(multiBranchError); // initial pull
      execaMock.mockResolvedValueOnce({ stdout: 'Already up to date.' }); // retry with explicit branch

      const command = createPullCommand();
      await command.parseAsync([], { from: 'user' });

      expect(execaMock).toHaveBeenCalledWith(
        'git',
        ['pull', 'origin', 'main'],
        expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
      );
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('handles divergence on retry after multiple branches error', async () => {
      const { createPullCommand } = await import('../../../src/commands/git/pull/index.js');

      execaMock.mockResolvedValueOnce({ stdout: 'feature/test' }); // branch name
      execaMock.mockResolvedValueOnce({ stdout: '' }); // upstream check
      const multiBranchError = new Error('fatal: Cannot fast-forward to multiple branches.');
      execaMock.mockRejectedValueOnce(multiBranchError); // initial pull
      const divergenceError = new Error('Not possible to fast-forward');
      (divergenceError as { shortMessage?: string }).shortMessage = 'not possible to fast-forward';
      execaMock.mockRejectedValueOnce(divergenceError); // retry also diverges
      execaMock.mockResolvedValueOnce({ stdout: 'rebased' }); // rebase pull

      promptSelectMock.mockResolvedValueOnce('rebase');

      const command = createPullCommand();
      await command.parseAsync([], { from: 'user' });

      expect(execaMock).toHaveBeenCalledWith(
        'git',
        ['pull', 'origin', 'feature/test'],
        expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
      );
      expect(promptSelectMock).toHaveBeenCalled();
    });
  });

  describe('divergence handling', () => {
    it('rebases when pull cannot fast-forward and user selects rebase', async () => {
      const { createPullCommand } = await import('../../../src/commands/git/pull/index.js');

      execaMock.mockResolvedValueOnce({ stdout: 'feature/diverge' }); // branch name
      execaMock.mockResolvedValueOnce({ stdout: '' }); // upstream check
      const divergenceError = new Error('Not possible to fast-forward');
      (divergenceError as { shortMessage?: string }).shortMessage = 'not possible to fast-forward';
      execaMock.mockRejectedValueOnce(divergenceError); // initial pull
      execaMock.mockResolvedValueOnce({ stdout: 'rebased' }); // rebase pull

      promptSelectMock.mockResolvedValueOnce('rebase');

      const command = createPullCommand();
      await command.parseAsync([], { from: 'user' });

      expect(promptSelectMock).toHaveBeenCalled();
      expect(execaMock).toHaveBeenCalledWith(
        'git',
        ['pull', '--rebase'],
        expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
      );
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('merges when pull cannot fast-forward and user selects merge', async () => {
      const { createPullCommand } = await import('../../../src/commands/git/pull/index.js');

      execaMock.mockResolvedValueOnce({ stdout: 'feature/diverge' }); // branch name
      execaMock.mockResolvedValueOnce({ stdout: '' }); // upstream check
      const divergenceError = new Error('Not possible to fast-forward');
      execaMock.mockRejectedValueOnce(divergenceError); // initial pull
      execaMock.mockResolvedValueOnce({ stdout: '' }); // fetch
      execaMock.mockResolvedValueOnce({ stdout: 'merged' }); // merge

      promptSelectMock.mockResolvedValueOnce('merge');

      const command = createPullCommand();
      await command.parseAsync([], { from: 'user' });

      expect(promptSelectMock).toHaveBeenCalled();
      expect(execaMock).toHaveBeenCalledWith(
        'git',
        ['fetch', 'origin', 'feature/diverge'],
        expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
      );
      expect(execaMock).toHaveBeenCalledWith(
        'git',
        ['merge', '--no-ff', 'origin/feature/diverge'],
        expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
      );
    });
  });
});
