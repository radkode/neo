import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorSeverity,
  ErrorCategory,
  AppError,
  CommandError,
  ValidationError,
  ConfigurationError,
  FileSystemError,
  NetworkError,
  PluginError,
  AuthenticationError,
  PermissionError,
  success,
  failure,
  isSuccess,
  isFailure,
  RetryStrategy,
  ErrorHandler,
  handleCommandResultSync,
  type Result,
} from '../../../src/core/errors/index.js';
import { mockProcessExit, captureConsole, type ConsoleMocks } from '../../utils/test-helpers.js';

describe('Error Enums', () => {
  describe('ErrorSeverity', () => {
    it('should have correct values', () => {
      expect(ErrorSeverity.LOW).toBe('low');
      expect(ErrorSeverity.MEDIUM).toBe('medium');
      expect(ErrorSeverity.HIGH).toBe('high');
      expect(ErrorSeverity.CRITICAL).toBe('critical');
    });
  });

  describe('ErrorCategory', () => {
    it('should have correct values', () => {
      expect(ErrorCategory.VALIDATION).toBe('VALIDATION');
      expect(ErrorCategory.CONFIGURATION).toBe('CONFIGURATION');
      expect(ErrorCategory.FILESYSTEM).toBe('FILESYSTEM');
      expect(ErrorCategory.NETWORK).toBe('NETWORK');
      expect(ErrorCategory.COMMAND).toBe('COMMAND');
      expect(ErrorCategory.PLUGIN).toBe('PLUGIN');
      expect(ErrorCategory.AUTHENTICATION).toBe('AUTHENTICATION');
      expect(ErrorCategory.PERMISSION).toBe('PERMISSION');
      expect(ErrorCategory.UNKNOWN).toBe('UNKNOWN');
    });
  });
});

describe('Error Classes', () => {
  describe('CommandError', () => {
    it('should create error with correct properties', () => {
      const error = new CommandError('Command failed', 'test-command');

      expect(error.message).toBe('Command failed');
      expect(error.commandName).toBe('test-command');
      expect(error.code).toBe('COMMAND_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.category).toBe(ErrorCategory.COMMAND);
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.name).toBe('CommandError');
    });

    it('should accept options', () => {
      const originalError = new Error('Original');
      const error = new CommandError('Command failed', 'test-command', {
        context: { exitCode: 1 },
        suggestions: ['Try again'],
        originalError,
      });

      expect(error.context).toEqual({ exitCode: 1 });
      expect(error.suggestions).toEqual(['Try again']);
      expect(error.originalError).toBe(originalError);
    });

    it('should generate user message with suggestions', () => {
      const error = new CommandError('Command failed', 'test-command', {
        suggestions: ['Check your input', 'Try --help'],
      });

      const userMessage = error.getUserMessage();
      expect(userMessage).toContain('Command failed');
      expect(userMessage).toContain('Suggestions:');
      expect(userMessage).toContain('Check your input');
      expect(userMessage).toContain('Try --help');
    });

    it('should generate user message without suggestions', () => {
      const error = new CommandError('Command failed', 'test-command');
      const userMessage = error.getUserMessage();

      expect(userMessage).toBe('Command failed');
      expect(userMessage).not.toContain('Suggestions:');
    });

    it('should generate detailed report', () => {
      const error = new CommandError('Command failed', 'test-command', {
        context: { exitCode: 1 },
        suggestions: ['Try again'],
      });

      const report = error.getDetailedReport();
      expect(report).toContain('Error: CommandError');
      expect(report).toContain('Code: COMMAND_ERROR');
      expect(report).toContain('Message: Command failed');
      expect(report).toContain('Severity: medium');
      expect(report).toContain('Category: COMMAND');
      expect(report).toContain('Timestamp:');
      expect(report).toContain('Context:');
      expect(report).toContain('exitCode');
      expect(report).toContain('Suggestions: Try again');
      expect(report).toContain('Stack Trace:');
    });

    it('should convert to JSON', () => {
      const error = new CommandError('Command failed', 'test-command', {
        context: { exitCode: 1 },
        suggestions: ['Try again'],
      });

      const json = error.toJSON();
      expect(json.name).toBe('CommandError');
      expect(json.code).toBe('COMMAND_ERROR');
      expect(json.message).toBe('Command failed');
      expect(json.severity).toBe('medium');
      expect(json.category).toBe('COMMAND');
      expect(json.timestamp).toBeDefined();
      expect(json.context).toEqual({ exitCode: 1 });
      expect(json.suggestions).toEqual(['Try again']);
      expect(json.stack).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should create error with correct properties', () => {
      const error = new ValidationError('Invalid input', 'username', 'ab');

      expect(error.message).toBe('Invalid input');
      expect(error.field).toBe('username');
      expect(error.value).toBe('ab');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.category).toBe(ErrorCategory.VALIDATION);
    });

    it('should work without field and value', () => {
      const error = new ValidationError('Invalid input');

      expect(error.field).toBeUndefined();
      expect(error.value).toBeUndefined();
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with default suggestions', () => {
      const error = new ConfigurationError('Config invalid', 'api.key');

      expect(error.message).toBe('Config invalid');
      expect(error.configKey).toBe('api.key');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions!.length).toBeGreaterThan(0);
      expect(error.suggestions).toContain('Run "neo config validate" to check your configuration');
    });

    it('should allow custom suggestions', () => {
      const error = new ConfigurationError('Config invalid', 'api.key', {
        suggestions: ['Custom suggestion'],
      });

      expect(error.suggestions).toEqual(['Custom suggestion']);
    });
  });

  describe('FileSystemError', () => {
    it('should create error with correct properties', () => {
      const error = new FileSystemError('Cannot read file', '/path/to/file', 'read');

      expect(error.message).toBe('Cannot read file');
      expect(error.path).toBe('/path/to/file');
      expect(error.operation).toBe('read');
      expect(error.code).toBe('FILESYSTEM_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.category).toBe(ErrorCategory.FILESYSTEM);
    });

    it('should accept all operation types', () => {
      const operations = ['read', 'write', 'delete', 'create', 'access'] as const;
      for (const op of operations) {
        const error = new FileSystemError('Error', '/path', op);
        expect(error.operation).toBe(op);
      }
    });
  });

  describe('NetworkError', () => {
    it('should create error with default suggestions', () => {
      const error = new NetworkError('Connection failed', 'https://api.example.com', 500);

      expect(error.message).toBe('Connection failed');
      expect(error.url).toBe('https://api.example.com');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.suggestions).toContain('Check your internet connection');
    });

    it('should work without url and statusCode', () => {
      const error = new NetworkError('Network error');

      expect(error.url).toBeUndefined();
      expect(error.statusCode).toBeUndefined();
    });
  });

  describe('PluginError', () => {
    it('should create error with correct properties', () => {
      const error = new PluginError('Plugin crashed', 'my-plugin');

      expect(error.message).toBe('Plugin crashed');
      expect(error.pluginName).toBe('my-plugin');
      expect(error.code).toBe('PLUGIN_ERROR');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.category).toBe(ErrorCategory.PLUGIN);
    });
  });

  describe('AuthenticationError', () => {
    it('should create error with default message and suggestions', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(error.suggestions).toContain('Run "neo auth login" to authenticate');
    });

    it('should allow custom message', () => {
      const error = new AuthenticationError('Token expired');

      expect(error.message).toBe('Token expired');
    });
  });

  describe('PermissionError', () => {
    it('should create error with correct properties', () => {
      const error = new PermissionError('Access denied', '/etc/passwd', 'read');

      expect(error.message).toBe('Access denied');
      expect(error.resource).toBe('/etc/passwd');
      expect(error.requiredPermission).toBe('read');
      expect(error.code).toBe('PERMISSION_ERROR');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.category).toBe(ErrorCategory.PERMISSION);
    });

    it('should work without requiredPermission', () => {
      const error = new PermissionError('Access denied', '/etc/passwd');

      expect(error.requiredPermission).toBeUndefined();
    });
  });
});

describe('Result Utilities', () => {
  describe('success', () => {
    it('should create a success result with data', () => {
      const result = success({ id: 1, name: 'test' });

      expect(result.success).toBe(true);
      expect((result as { data: unknown }).data).toEqual({ id: 1, name: 'test' });
    });

    it('should work with primitive values', () => {
      expect(success(42)).toEqual({ success: true, data: 42 });
      expect(success('hello')).toEqual({ success: true, data: 'hello' });
      expect(success(null)).toEqual({ success: true, data: null });
    });
  });

  describe('failure', () => {
    it('should create a failure result with error', () => {
      const error = new CommandError('Failed', 'cmd');
      const result = failure(error);

      expect(result.success).toBe(false);
      expect((result as { error: unknown }).error).toBe(error);
    });
  });

  describe('isSuccess', () => {
    it('should return true for success results', () => {
      const result = success('data');
      expect(isSuccess(result)).toBe(true);
    });

    it('should return false for failure results', () => {
      const result = failure(new CommandError('Failed', 'cmd'));
      expect(isSuccess(result)).toBe(false);
    });

    it('should narrow types correctly', () => {
      const result: Result<string> = success('hello');

      if (isSuccess(result)) {
        // TypeScript should know result.data is string here
        expect(result.data.toUpperCase()).toBe('HELLO');
      }
    });
  });

  describe('isFailure', () => {
    it('should return true for failure results', () => {
      const result = failure(new CommandError('Failed', 'cmd'));
      expect(isFailure(result)).toBe(true);
    });

    it('should return false for success results', () => {
      const result = success('data');
      expect(isFailure(result)).toBe(false);
    });

    it('should narrow types correctly', () => {
      const result: Result<string> = failure(new CommandError('Failed', 'cmd'));

      if (isFailure(result)) {
        // TypeScript should know result.error exists here
        expect(result.error.message).toBe('Failed');
      }
    });
  });
});

describe('RetryStrategy', () => {
  let consoleMocks: ConsoleMocks;

  beforeEach(() => {
    consoleMocks = captureConsole();
    vi.useFakeTimers();
  });

  afterEach(() => {
    consoleMocks.restore();
    vi.useRealTimers();
  });

  describe('canRecover', () => {
    it('should return true for network errors', () => {
      const strategy = new RetryStrategy();
      const error = new NetworkError('Connection failed');

      expect(strategy.canRecover(error)).toBe(true);
    });

    it('should return true for filesystem errors', () => {
      const strategy = new RetryStrategy();
      const error = new FileSystemError('Cannot read', '/path', 'read');

      expect(strategy.canRecover(error)).toBe(true);
    });

    it('should return false for other error types', () => {
      const strategy = new RetryStrategy();

      expect(strategy.canRecover(new CommandError('Failed', 'cmd'))).toBe(false);
      expect(strategy.canRecover(new ValidationError('Invalid'))).toBe(false);
      expect(strategy.canRecover(new ConfigurationError('Config error'))).toBe(false);
      expect(strategy.canRecover(new AuthenticationError())).toBe(false);
      expect(strategy.canRecover(new PermissionError('Denied', '/path'))).toBe(false);
      expect(strategy.canRecover(new PluginError('Plugin error', 'plugin'))).toBe(false);
    });
  });

  describe('recover', () => {
    it('should retry with default settings', async () => {
      const strategy = new RetryStrategy();
      const error = new NetworkError('Connection failed');

      const recoverPromise = strategy.recover(error);

      // Fast-forward through all retries (3 retries with backoff: 1000, 2000, 3000)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(3000);

      await recoverPromise;

      // Should have logged 3 retry attempts
      expect(consoleMocks.log).toHaveBeenCalledTimes(3);
      expect(consoleMocks.log).toHaveBeenCalledWith('Retry attempt 1 after 1000ms');
      expect(consoleMocks.log).toHaveBeenCalledWith('Retry attempt 2 after 2000ms');
      expect(consoleMocks.log).toHaveBeenCalledWith('Retry attempt 3 after 3000ms');
    });

    it('should use custom retry settings', async () => {
      const strategy = new RetryStrategy(2, 500, false); // 2 retries, 500ms, no backoff
      const error = new NetworkError('Connection failed');

      const recoverPromise = strategy.recover(error);

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);

      await recoverPromise;

      expect(consoleMocks.log).toHaveBeenCalledTimes(2);
      expect(consoleMocks.log).toHaveBeenCalledWith('Retry attempt 1 after 500ms');
      expect(consoleMocks.log).toHaveBeenCalledWith('Retry attempt 2 after 500ms');
    });
  });
});

describe('ErrorHandler', () => {
  let consoleMocks: ConsoleMocks;
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    consoleMocks = captureConsole();
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    consoleMocks.restore();
    exitMock.mockRestore();
  });

  describe('registerStrategy', () => {
    it('should register a strategy', () => {
      const handler = new ErrorHandler();
      const strategy = new RetryStrategy();

      handler.registerStrategy(strategy);

      // No assertion needed - just verify it doesn't throw
    });
  });

  describe('handle', () => {
    it('should handle AppError directly', async () => {
      const handler = new ErrorHandler();
      const error = new CommandError('Command failed', 'test-cmd');

      await handler.handle(error);

      expect(consoleMocks.error).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should normalize regular Error to AppError', async () => {
      const handler = new ErrorHandler();
      const error = new Error('Something went wrong');

      await handler.handle(error);

      expect(consoleMocks.error).toHaveBeenCalled();
      const errorOutput = consoleMocks.error.mock.calls[0][0];
      expect(errorOutput).toContain('Something went wrong');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should normalize string to AppError', async () => {
      const handler = new ErrorHandler();

      await handler.handle('String error');

      expect(consoleMocks.error).toHaveBeenCalled();
      const errorOutput = consoleMocks.error.mock.calls[0][0];
      expect(errorOutput).toContain('String error');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should try recovery strategies', async () => {
      vi.useFakeTimers();

      const handler = new ErrorHandler();
      const strategy = {
        canRecover: vi.fn().mockReturnValue(true),
        recover: vi.fn().mockResolvedValue(undefined),
      };
      handler.registerStrategy(strategy);

      const error = new NetworkError('Connection failed');
      await handler.handle(error);

      expect(strategy.canRecover).toHaveBeenCalledWith(error);
      expect(strategy.recover).toHaveBeenCalledWith(error);
      // Should not exit if recovery succeeds
      expect(exitMock).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should continue to next strategy if recovery fails', async () => {
      const handler = new ErrorHandler();

      const failingStrategy = {
        canRecover: vi.fn().mockReturnValue(true),
        recover: vi.fn().mockRejectedValue(new Error('Recovery failed')),
      };
      const successfulStrategy = {
        canRecover: vi.fn().mockReturnValue(true),
        recover: vi.fn().mockResolvedValue(undefined),
      };

      handler.registerStrategy(failingStrategy);
      handler.registerStrategy(successfulStrategy);

      const error = new NetworkError('Connection failed');
      await handler.handle(error);

      expect(failingStrategy.recover).toHaveBeenCalled();
      expect(successfulStrategy.recover).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('should exit if no strategy can recover', async () => {
      const handler = new ErrorHandler();
      const strategy = {
        canRecover: vi.fn().mockReturnValue(false),
        recover: vi.fn(),
      };
      handler.registerStrategy(strategy);

      const error = new CommandError('Failed', 'cmd');
      await handler.handle(error);

      expect(strategy.canRecover).toHaveBeenCalled();
      expect(strategy.recover).not.toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});

describe('handleCommandResultSync', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let uiMock: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    exitMock = mockProcessExit();
    uiMock = {
      error: vi.fn(),
      warn: vi.fn(),
      list: vi.fn(),
    };
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  it('should do nothing for success results', () => {
    const result = success(undefined);

    handleCommandResultSync(result, uiMock);

    expect(uiMock.error).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('should display error and exit for failure results', () => {
    const result = failure(new CommandError('Command failed', 'test-cmd'));

    handleCommandResultSync(result, uiMock);

    expect(uiMock.error).toHaveBeenCalledWith('Command failed');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should display suggestions if present', () => {
    const result = failure(
      new CommandError('Command failed', 'test-cmd', {
        suggestions: ['Try again', 'Check input'],
      })
    );

    handleCommandResultSync(result, uiMock);

    expect(uiMock.error).toHaveBeenCalledWith('Command failed');
    expect(uiMock.warn).toHaveBeenCalledWith('Suggestions:');
    expect(uiMock.list).toHaveBeenCalledWith(['Try again', 'Check input']);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should not display suggestions section if empty', () => {
    const result = failure(new CommandError('Command failed', 'test-cmd'));

    handleCommandResultSync(result, uiMock);

    expect(uiMock.warn).not.toHaveBeenCalled();
    expect(uiMock.list).not.toHaveBeenCalled();
  });
});
