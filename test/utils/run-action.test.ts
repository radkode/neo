import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/output.js', () => ({
  emitError: vi.fn(),
}));

import { runAction } from '@/utils/run-action.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { emitError } from '@/utils/output.js';

const emitErrorMock = vi.mocked(emitError);

describe('runAction', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  it('runs the wrapped handler and does not touch process.exit on success', async () => {
    const handler = vi.fn(async (n: number) => {
      expect(n).toBe(42);
    });

    const wrapped = runAction(handler);
    await wrapped(42);

    expect(handler).toHaveBeenCalledWith(42);
    expect(exitMock).not.toHaveBeenCalled();
    expect(emitErrorMock).not.toHaveBeenCalled();
  });

  it('exits with code 2 when the handler throws NonInteractiveError', async () => {
    const err = new NonInteractiveError('confirm', '--yes');
    const wrapped = runAction(async () => {
      throw err;
    });

    await wrapped();

    expect(emitErrorMock).toHaveBeenCalledWith(err);
    expect(exitMock).toHaveBeenCalledWith(2);
  });

  it('exits with code 1 for generic errors', async () => {
    const err = new Error('boom');
    const wrapped = runAction(async () => {
      throw err;
    });

    await wrapped();

    expect(emitErrorMock).toHaveBeenCalledWith(err);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('wraps non-Error throws into an Error before emitting', async () => {
    const wrapped = runAction(async () => {
      throw 'string-thrown-value';
    });

    await wrapped();

    const [emitted] = emitErrorMock.mock.calls[0] ?? [];
    expect(emitted).toBeInstanceOf(Error);
    expect((emitted as Error).message).toBe('string-thrown-value');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('forwards all positional arguments to the wrapped handler', async () => {
    const handler = vi.fn(async (a: string, b: number, c: { x: number }) => {
      expect(a).toBe('foo');
      expect(b).toBe(7);
      expect(c).toEqual({ x: 1 });
    });

    const wrapped = runAction(handler);
    await wrapped('foo', 7, { x: 1 });

    expect(handler).toHaveBeenCalledWith('foo', 7, { x: 1 });
  });

  it('NonInteractiveError path takes precedence over generic catch', async () => {
    // Subclasses of NonInteractiveError should also resolve to exit 2.
    class CustomNonInt extends NonInteractiveError {}
    const err = new CustomNonInt('confirm');
    const wrapped = runAction(async () => {
      throw err;
    });

    await wrapped();

    expect(exitMock).toHaveBeenCalledWith(2);
  });
});
