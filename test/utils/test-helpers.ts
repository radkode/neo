/**
 * Shared test utilities and mock factories
 *
 * These utilities reduce boilerplate across test files and ensure
 * consistent mocking patterns throughout the test suite.
 */

import { vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Temp Directory Helpers
// ============================================================================

export interface TempDir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a temporary directory for isolated test file operations.
 *
 * @example
 * let tempDir: TempDir;
 * beforeEach(async () => {
 *   tempDir = await createTempDir('my-test-');
 * });
 * afterEach(async () => {
 *   await tempDir.cleanup();
 * });
 */
export async function createTempDir(prefix = 'neo-test-'): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// ============================================================================
// Process Mocks
// ============================================================================

/**
 * Mocks process.exit to prevent tests from exiting.
 * Returns a spy that can be used to verify exit calls.
 *
 * @example
 * const exitSpy = mockProcessExit();
 * // ... run code that calls process.exit(1)
 * expect(exitSpy).toHaveBeenCalledWith(1);
 */
export function mockProcessExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

// ============================================================================
// Console Capture
// ============================================================================

export interface ConsoleMocks {
  log: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  restore: () => void;
}

/**
 * Captures and silences console output during tests.
 *
 * @example
 * let consoleMocks: ConsoleMocks;
 * beforeEach(() => {
 *   consoleMocks = captureConsole();
 * });
 * afterEach(() => {
 *   consoleMocks.restore();
 * });
 */
export function captureConsole(): ConsoleMocks {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  return {
    log,
    error,
    warn,
    info,
    restore: () => {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      info.mockRestore();
    },
  };
}

// ============================================================================
// Spinner Mock Factory
// ============================================================================

export interface SpinnerMock {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  succeed: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  text: string;
  clear: () => void;
}

/**
 * Creates a mock spinner object matching the ora interface.
 *
 * @example
 * const spinner = createSpinnerMock();
 * vi.mock('@/utils/ui.js', () => ({
 *   ui: { spinner: vi.fn(() => spinner) }
 * }));
 */
export function createSpinnerMock(): SpinnerMock {
  const mock: SpinnerMock = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
    clear: () => {
      mock.start.mockClear();
      mock.stop.mockClear();
      mock.succeed.mockClear();
      mock.fail.mockClear();
      mock.text = '';
    },
  };
  return mock;
}

// ============================================================================
// UI Mock Factory
// ============================================================================

export interface UiMock {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  muted: ReturnType<typeof vi.fn>;
  step: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  table: ReturnType<typeof vi.fn>;
  banner: ReturnType<typeof vi.fn>;
  spinner: ReturnType<typeof vi.fn>;
  _spinner: SpinnerMock;
}

/**
 * Creates a complete mock of the UI module.
 *
 * @example
 * const uiMock = createUiMock();
 * vi.mock('@/utils/ui.js', () => ({ ui: uiMock }));
 */
export function createUiMock(): UiMock {
  const spinnerMock = createSpinnerMock();
  return {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    muted: vi.fn(),
    step: vi.fn(),
    list: vi.fn(),
    table: vi.fn(),
    banner: vi.fn(),
    spinner: vi.fn(() => spinnerMock),
    _spinner: spinnerMock,
  };
}

// ============================================================================
// Logger Mock Factory
// ============================================================================

export interface LoggerMock {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock logger matching the logger module interface.
 *
 * @example
 * const loggerMock = createLoggerMock();
 * vi.mock('@/utils/logger.js', () => ({ logger: loggerMock }));
 */
export function createLoggerMock(): LoggerMock {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ============================================================================
// Execa Mock Factory
// ============================================================================

export interface ExecaResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ExecaMockConfig {
  responses?: Record<string, ExecaResponse | Error>;
  defaultResponse?: ExecaResponse;
}

/**
 * Creates a configurable execa mock that can respond differently based on command.
 *
 * @example
 * const execaMock = createExecaMock({
 *   responses: {
 *     'git status': { stdout: 'On branch main' },
 *     'git push': new Error('rejected'),
 *   }
 * });
 * vi.mock('execa', () => ({ execa: execaMock }));
 */
export function createExecaMock(config: ExecaMockConfig = {}) {
  const { responses = {}, defaultResponse = { stdout: '', stderr: '', exitCode: 0 } } = config;

  return vi.fn().mockImplementation(async (cmd: string, args?: string[]) => {
    const fullCommand = args ? `${cmd} ${args.join(' ')}` : cmd;

    // Check for exact match first
    if (responses[fullCommand]) {
      const response = responses[fullCommand];
      if (response instanceof Error) {
        throw response;
      }
      return { stdout: response.stdout ?? '', stderr: response.stderr ?? '', exitCode: response.exitCode ?? 0 };
    }

    // Check for command prefix match (e.g., 'git status' matches 'git status --porcelain')
    for (const [pattern, response] of Object.entries(responses)) {
      if (fullCommand.startsWith(pattern)) {
        if (response instanceof Error) {
          throw response;
        }
        return { stdout: response.stdout ?? '', stderr: response.stderr ?? '', exitCode: response.exitCode ?? 0 };
      }
    }

    return { stdout: defaultResponse.stdout ?? '', stderr: defaultResponse.stderr ?? '', exitCode: defaultResponse.exitCode ?? 0 };
  });
}

/**
 * Creates a simple sequential execa mock that returns responses in order.
 *
 * @example
 * const execaMock = createSequentialExecaMock([
 *   { stdout: 'main' },
 *   { stdout: 'pushed' },
 *   new Error('failed'),
 * ]);
 */
export function createSequentialExecaMock(responses: (ExecaResponse | Error)[]) {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const response = responses[index++] ?? { stdout: '', stderr: '' };
    if (response instanceof Error) {
      throw response;
    }
    return { stdout: response.stdout ?? '', stderr: response.stderr ?? '', exitCode: response.exitCode ?? 0 };
  });
}

// ============================================================================
// Inquirer Mock Factory
// ============================================================================

/**
 * Creates a mock for inquirer prompts.
 *
 * @example
 * const inquirerMock = createInquirerMock({ confirm: true, choice: 'option1' });
 * vi.mock('inquirer', () => ({ default: { prompt: inquirerMock.prompt } }));
 */
export function createInquirerMock(answers: Record<string, unknown> = {}) {
  return {
    prompt: vi.fn().mockImplementation(async (questions: Array<{ name: string }>) => {
      const result: Record<string, unknown> = {};
      for (const q of questions) {
        result[q.name] = answers[q.name] ?? null;
      }
      return result;
    }),
  };
}

/**
 * Creates a sequential inquirer mock for multi-prompt flows.
 *
 * @example
 * const inquirerMock = createSequentialInquirerMock([
 *   { confirm: true },
 *   { choice: 'delete' },
 * ]);
 */
export function createSequentialInquirerMock(answersList: Array<Record<string, unknown>>) {
  let index = 0;
  return {
    prompt: vi.fn().mockImplementation(async () => {
      return answersList[index++] ?? {};
    }),
  };
}

// ============================================================================
// Result Helpers
// ============================================================================

/**
 * Helper to create a success Result for testing.
 */
export function successResult<T>(data: T) {
  return { success: true as const, data };
}

/**
 * Helper to create a failure Result for testing.
 */
export function failureResult<E>(error: E) {
  return { success: false as const, error };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Asserts that a mock function was called with arguments matching a pattern.
 *
 * @example
 * expectCalledWithPattern(execaMock, ['git', ['push', 'origin', expect.any(String)]]);
 */
export function expectCalledWithPattern(
  mock: ReturnType<typeof vi.fn>,
  pattern: unknown[]
) {
  const calls = mock.mock.calls;
  const match = calls.some((call) => {
    if (call.length !== pattern.length) return false;
    return pattern.every((expected, i) => {
      if (typeof expected === 'object' && expected !== null && 'asymmetricMatch' in expected) {
        return (expected as { asymmetricMatch: (v: unknown) => boolean }).asymmetricMatch(call[i]);
      }
      return JSON.stringify(call[i]) === JSON.stringify(expected);
    });
  });

  if (!match) {
    throw new Error(
      `Expected mock to be called with pattern ${JSON.stringify(pattern)}\n` +
        `Actual calls: ${JSON.stringify(calls)}`
    );
  }
}
