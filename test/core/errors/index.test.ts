import { describe, it, expect } from 'vitest';
import {
  ErrorSeverity,
  ErrorCategory,
  AppError,
  CommandError,
  success,
  failure,
  isFailure,
  type Result,
} from '../../../src/core/errors/index.js';

class TestError extends AppError {
  readonly code = 'TEST_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.UNKNOWN;
}

describe('AppError', () => {
  it('captures name, message, timestamp', () => {
    const err = new TestError('boom');
    expect(err.name).toBe('TestError');
    expect(err.message).toBe('boom');
    expect(err.timestamp).toBeInstanceOf(Date);
  });

  it('preserves optional context, suggestions, originalError', () => {
    const original = new Error('cause');
    const err = new TestError('boom', {
      context: { foo: 1 },
      suggestions: ['try X'],
      originalError: original,
    });
    expect(err.context).toEqual({ foo: 1 });
    expect(err.suggestions).toEqual(['try X']);
    expect(err.originalError).toBe(original);
  });

  it('has a stack trace pointing at the throw site', () => {
    const err = new TestError('boom');
    expect(err.stack).toContain('TestError');
  });
});

describe('CommandError', () => {
  it('exposes code, severity, category, commandName', () => {
    const err = new CommandError('failed', 'do-thing');
    expect(err.code).toBe('COMMAND_ERROR');
    expect(err.severity).toBe(ErrorSeverity.MEDIUM);
    expect(err.category).toBe(ErrorCategory.COMMAND);
    expect(err.commandName).toBe('do-thing');
  });
});

describe('Result helpers', () => {
  it('success() wraps data', () => {
    const result = success(42);
    expect(result).toEqual({ success: true, data: 42 });
  });

  it('failure() wraps an AppError', () => {
    const err = new TestError('nope');
    const result = failure(err);
    expect(result).toEqual({ success: false, error: err });
  });

  it('isFailure() narrows correctly', () => {
    const ok: Result<number> = success(1);
    const bad: Result<number> = failure(new TestError('x'));
    expect(isFailure(ok)).toBe(false);
    expect(isFailure(bad)).toBe(true);
    if (isFailure(bad)) {
      expect(bad.error).toBeInstanceOf(AppError);
    }
  });
});
