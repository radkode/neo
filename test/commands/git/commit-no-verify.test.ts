import { execa } from 'execa';
import { execaResult } from '../../utils/test-helpers.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { generateCommitMessage, isAICommitAvailable } from '@/services/ai/index.js';

/**
 * Argv-level coverage for `--no-verify`, on both commit paths.
 *
 * The quick/interactive flow and the `--ai --yes` flow reach git through
 * separate call sites. A flag added to one and missed on the other works for
 * some invocations and silently does nothing for others, which is the failure
 * these two assertions exist to prevent.
 */

const spinnerMock = {
  start: vi.fn(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
};

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/services/ai/index.js', () => ({
  generateCommitMessage: vi.fn(),
  isAICommitAvailable: vi.fn(),
  AIErrors: { missingApiKey: vi.fn(() => new Error('no key')) },
}));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    code: vi.fn(),
    error: vi.fn(),
    highlight: vi.fn(),
    info: vi.fn(),
    keyValue: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
    spinner: vi.fn(() => ({ ...spinnerMock })),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

// Loosely typed on purpose: these tests drive execa by argv rather than by
// call order, which execa's overloaded signature does not model.
const mockExeca = execa as unknown as Mock;

/** Stage one file, then let every other git call succeed. */
function gitSucceeds(): void {
  mockExeca.mockImplementation(async (_cmd: string, args: readonly string[]) => {
    if (args[0] === 'diff') return execaResult({ stdout: 'a.txt' });
    if (args[0] === 'rev-parse' && args[1] === '--short') {
      return execaResult({ stdout: 'abc1234' });
    }
    return execaResult({ stdout: '' });
  });
}

/** The argv of the single `git commit ...` invocation. */
function commitArgs(): string[] {
  const call = (mockExeca.mock.calls as unknown[][]).find(
    ([, args]) => Array.isArray(args) && args[0] === 'commit'
  );
  if (!call) throw new Error('git commit was never invoked');
  return call[1] as string[];
}

describe('git commit forwards --no-verify to git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRuntimeContext(buildRuntimeContext({ yes: true, nonInteractive: true }));
    gitSucceeds();
  });

  describe('quick path', () => {
    it('passes --no-verify when verify is false', async () => {
      const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

      await executeCommit({ type: 'feat', message: 'x', verify: false });

      expect(commitArgs()).toEqual(['commit', '-m', 'feat: x', '--no-verify']);
    });

    it('omits it when the flag is absent', async () => {
      const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

      await executeCommit({ type: 'feat', message: 'x' });

      expect(commitArgs()).toEqual(['commit', '-m', 'feat: x']);
    });

    it('omits it for verify: true, so the negated default never skips hooks', async () => {
      const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

      await executeCommit({ type: 'feat', message: 'x', verify: true });

      expect(commitArgs()).not.toContain('--no-verify');
    });
  });

  describe('--ai path', () => {
    beforeEach(() => {
      (isAICommitAvailable as unknown as Mock).mockResolvedValue(true);
      (generateCommitMessage as unknown as Mock).mockResolvedValue({
        success: true,
        data: { type: 'fix', message: 'drafted', breaking: false },
      });
    });

    it('passes --no-verify from the separate AI call site too', async () => {
      const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

      await executeCommit({ ai: true, verify: false });

      expect(commitArgs()).toEqual(['commit', '-m', 'fix: drafted', '--no-verify']);
    });

    it('omits it when the flag is absent', async () => {
      const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

      await executeCommit({ ai: true });

      expect(commitArgs()).not.toContain('--no-verify');
    });
  });
});
