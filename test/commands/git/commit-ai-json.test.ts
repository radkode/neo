import { execa } from 'execa';
import { execaResult } from '../../utils/test-helpers.js';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { generateCommitMessage, isAICommitAvailable } from '@/services/ai/index.js';

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

const mockExeca = execa as unknown as Mock;

function gitSucceeds(): void {
  mockExeca.mockImplementation(async (_cmd: string, args: readonly string[]) => {
    if (args[0] === 'diff') return execaResult({ stdout: 'a.txt\nb.txt' });
    if (args[0] === 'rev-parse' && args[1] === '--short') {
      return execaResult({ stdout: 'abc1234' });
    }
    return execaResult({ stdout: '' });
  });
}

describe('git commit --ai emits the same JSON envelope as the interactive path', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gitSucceeds();
    (isAICommitAvailable as unknown as Mock).mockResolvedValue(true);
    (generateCommitMessage as unknown as Mock).mockResolvedValue({
      success: true,
      data: { type: 'fix', scope: 'auth', message: 'drafted', breaking: false },
    });
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  function emitted(): Record<string, unknown> {
    const writes = writeSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(writes).toHaveLength(1);
    return JSON.parse(writes.join('')) as Record<string, unknown>;
  }

  it('writes the result payload to stdout under --json', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));
    const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

    await executeCommit({ ai: true });

    expect(emitted()).toEqual({
      ok: true,
      command: 'git.commit',
      commit: 'abc1234',
      type: 'fix',
      scope: 'auth',
      message: 'drafted',
      breaking: false,
      files: ['a.txt', 'b.txt'],
    });
  });

  it('reports a null scope rather than omitting the key', async () => {
    (generateCommitMessage as unknown as Mock).mockResolvedValue({
      success: true,
      data: { type: 'fix', message: 'drafted', breaking: false },
    });
    setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));
    const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

    await executeCommit({ ai: true });

    expect(emitted()['scope']).toBeNull();
  });

  it('prints the human line and no JSON in text mode', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true, nonInteractive: true }));
    const { ui } = await import('@/utils/ui.js');
    const { executeCommit } = await import('../../../src/commands/git/commit/index.js');

    await executeCommit({ ai: true });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith('Commit: abc1234');
  });
});
