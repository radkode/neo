/**
 * Core error handling for Neo CLI.
 *
 * Surface kept intentionally small — see git history for the prior, larger
 * speculative variant. Exports only what the codebase actually consumes:
 *   - AppError + CommandError (concrete subclasses live in feature modules)
 *   - ErrorSeverity / ErrorCategory enums for those subclasses
 *   - Result<T> with success / failure / isFailure helpers
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  CONFIGURATION = 'CONFIGURATION',
  FILESYSTEM = 'FILESYSTEM',
  NETWORK = 'NETWORK',
  COMMAND = 'COMMAND',
  AUTHENTICATION = 'AUTHENTICATION',
  PERMISSION = 'PERMISSION',
  UNKNOWN = 'UNKNOWN',
}

export interface AppErrorOptions {
  context?: Record<string, unknown>;
  suggestions?: string[];
  originalError?: Error;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly severity: ErrorSeverity;
  abstract readonly category: ErrorCategory;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown> | undefined;
  readonly suggestions?: string[] | undefined;
  readonly originalError?: Error | undefined;

  constructor(message: string, options?: AppErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = options?.context;
    this.suggestions = options?.suggestions;
    this.originalError = options?.originalError;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CommandError extends AppError {
  readonly code = 'COMMAND_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.COMMAND;

  constructor(
    message: string,
    public readonly commandName: string,
    options?: AppErrorOptions
  ) {
    super(message, options);
  }
}

export type Result<T, E extends AppError = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure<E extends AppError>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isFailure<T, E extends AppError>(
  result: Result<T, E>
): result is { success: false; error: E } {
  return result.success === false;
}
