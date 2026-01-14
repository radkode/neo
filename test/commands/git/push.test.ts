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

describe('git push command', () => {
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    spinnerMock.start.mockClear();
    spinnerMock.stop.mockClear();
    spinnerMock.succeed.mockClear();
    spinnerMock.text = '';
  });

  afterEach(() => {
    exitMock.mockRestore();
    vi.resetAllMocks();
  });

  it('rebases then retries push when remote is ahead and user selects rebase', async () => {
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');

    execaMock.mockResolvedValueOnce({ stdout: 'feature/diverge' }); // branch
    const rejectionError = new Error('non-fast-forward');
    (rejectionError as { shortMessage?: string }).shortMessage = 'fetch first';
    execaMock.mockRejectedValueOnce(rejectionError); // push rejected
    execaMock.mockResolvedValueOnce({ stdout: 'rebased' }); // pull --rebase
    execaMock.mockResolvedValueOnce({ stdout: 'pushed' }); // push retry

    promptSelectMock.mockResolvedValueOnce('pull-rebase');

    const command = createPushCommand();
    await command.parseAsync([], { from: 'user' });

    expect(promptSelectMock).toHaveBeenCalled();

    const pullRebaseCall = execaMock.mock.calls.find(
      ([_cmd, args]) =>
        Array.isArray(args) &&
        args[0] === 'pull' &&
        args[1] === '--rebase' &&
        args[2] === 'origin' &&
        args[3] === 'feature/diverge'
    );
    expect(pullRebaseCall).toBeTruthy();

    const pushCalls = execaMock.mock.calls.filter(
      ([_cmd, args]) =>
        Array.isArray(args) &&
        args[0] === 'push' &&
        args[1] === 'origin' &&
        args[2] === 'feature/diverge'
    );
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    // With Result pattern, successful commands don't call process.exit()
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });

  it('force pushes when remote is ahead and user selects force', async () => {
    const { createPushCommand } = await import('../../../src/commands/git/push/index.js');

    execaMock.mockResolvedValueOnce({ stdout: 'feature/diverge' }); // branch
    const rejectionError = new Error('rejected');
    (rejectionError as { shortMessage?: string }).shortMessage = 'non-fast-forward';
    execaMock.mockRejectedValueOnce(rejectionError); // push rejected
    execaMock.mockResolvedValueOnce({ stdout: 'forced' }); // force push

    promptSelectMock.mockResolvedValueOnce('force');

    const command = createPushCommand();
    await command.parseAsync([], { from: 'user' });

    expect(promptSelectMock).toHaveBeenCalled();
    expect(
      execaMock.mock.calls.find(
        ([_cmd, args]) =>
          Array.isArray(args) && args.join(' ') === 'push --force origin feature/diverge'
      )
    ).toBeTruthy();
    // With Result pattern, successful commands don't call process.exit()
    expect(exitMock).not.toHaveBeenCalledWith(1);
  });
});
