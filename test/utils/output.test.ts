import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    warn: vi.fn(),
    list: vi.fn(),
  },
}));

import { emitJson, emitError } from '@/utils/output.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@/core/errors/index.js';
import { ui } from '@/utils/ui.js';
import { GitErrors } from '@/utils/git-errors.js';

class TestAppError extends AppError {
  readonly code = 'TEST_ERR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.COMMAND;
}

describe('output', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  describe('emitJson', () => {
    it('writes a JSON line to stdout in json mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      emitJson({ ok: true, command: 'test' });
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      const payload = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      expect(payload).toBe('{"ok":true,"command":"test"}\n');
    });

    it('invokes text fallback in text mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      const textRenderer = vi.fn();
      emitJson({ ok: true }, { text: textRenderer });
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
      expect(textRenderer).toHaveBeenCalledTimes(1);
    });

    it('does nothing in text mode without a text renderer', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      emitJson({ ok: true });
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('emits arrays as well as objects', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      emitJson([{ id: 1 }, { id: 2 }]);
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      const payload = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      expect(JSON.parse(payload)).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('emitError', () => {
    it('writes a structured error to stdout in json mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      const err = new TestAppError('boom', {
        suggestions: ['try --force', 'check network'],
      });
      emitError(err);
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      const payload = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(payload);
      expect(parsed.error.code).toBe('TEST_ERR');
      expect(parsed.error.message).toBe('boom');
      expect(parsed.error.category).toBe('COMMAND');
      expect(parsed.error.severity).toBe('medium');
      expect(parsed.error.suggestions).toEqual(['try --force', 'check network']);
    });

    it('writes structured Git process details in json mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      const cause = Object.assign(new Error('Command failed'), {
        escapedCommand: 'git show missing',
        exitCode: 128,
        stderr: 'fatal: invalid reference: missing',
      });

      emitError(GitErrors.unknown('show', cause));

      const payload = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(payload);
      expect(parsed.error.context).toEqual({
        command: 'git show missing',
        exitCode: 128,
        stderr: 'fatal: invalid reference: missing',
        error: 'fatal: invalid reference: missing',
      });
    });

    it('assigns UNKNOWN code when error is a plain Error', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      emitError(new Error('raw'));
      const payload = stdoutWriteSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(payload);
      expect(parsed.error.code).toBe('UNKNOWN');
      expect(parsed.error.message).toBe('raw');
    });

    it('calls ui.error in text mode (no text renderer)', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      emitError(new Error('boom'));
      expect(ui.error).toHaveBeenCalledWith('boom');
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('renders suggestions via ui.warn + ui.list in text mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      const err = new TestAppError('boom', {
        suggestions: ['first', 'second'],
      });
      emitError(err);
      expect(ui.error).toHaveBeenCalledWith('boom');
      expect(ui.warn).toHaveBeenCalledWith('Suggestions:');
      expect(ui.list).toHaveBeenCalledWith(['first', 'second']);
    });

    it('renders details for an unclassified Git failure', () => {
      setRuntimeContext(buildRuntimeContext({ json: false, quiet: true }));
      const cause = Object.assign(new Error('Command failed'), {
        escapedCommand: 'git show missing',
        exitCode: 128,
        stderr: 'fatal: invalid reference: missing',
      });

      emitError(GitErrors.unknown('show', cause));

      expect(ui.error).toHaveBeenCalledWith(
        'Git command failed: show\nCommand: git show missing\nfatal: invalid reference: missing'
      );
    });

    it('renders classified Git details but not non-Git context', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      const cause = Object.assign(new Error('Command failed'), {
        escapedCommand: 'git fetch origin',
        stderr: 'fatal: connection closed',
      });
      const classified = GitErrors.networkError('fetch', cause);
      const nonGit = new TestAppError('Other error', {
        context: { stderr: 'internal app detail' },
      });

      emitError(classified);
      emitError(nonGit);

      expect(ui.error).toHaveBeenNthCalledWith(
        1,
        'Network error!\nCommand: git fetch origin\nfatal: connection closed'
      );
      expect(ui.error).toHaveBeenNthCalledWith(2, 'Other error');
    });

    it('text renderer overrides default ui rendering in text mode', () => {
      setRuntimeContext(buildRuntimeContext({ json: false }));
      const custom = vi.fn();
      emitError(new Error('boom'), { text: custom });
      expect(custom).toHaveBeenCalledTimes(1);
      expect(ui.error).not.toHaveBeenCalled();
    });
  });
});
