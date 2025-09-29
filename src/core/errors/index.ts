/**
 * Core error handling system for Neo CLI
 * Provides comprehensive error management with proper type safety
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Error categories for better organization
 */
export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  CONFIGURATION = 'CONFIGURATION',
  FILESYSTEM = 'FILESYSTEM',
  NETWORK = 'NETWORK',
  COMMAND = 'COMMAND',
  PLUGIN = 'PLUGIN',
  AUTHENTICATION = 'AUTHENTICATION',
  PERMISSION = 'PERMISSION',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Base error interface
 */
export interface IError {
  readonly code: string;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly category: ErrorCategory;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown> | undefined;
  readonly suggestions?: string[] | undefined;
  readonly originalError?: Error | undefined;
}

/**
 * Abstract base class for all application errors
 */
export abstract class AppError extends Error implements IError {
  abstract readonly code: string;
  abstract readonly severity: ErrorSeverity;
  abstract readonly category: ErrorCategory;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown> | undefined;
  readonly suggestions?: string[] | undefined;
  readonly originalError?: Error | undefined;

  constructor(
    message: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = options?.context;
    this.suggestions = options?.suggestions;
    this.originalError = options?.originalError;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Returns a user-friendly error message
   */
  getUserMessage(): string {
    let message = this.message;

    if (this.suggestions && this.suggestions.length > 0) {
      message += '\n\nSuggestions:';
      this.suggestions.forEach((suggestion) => {
        message += `\n  • ${suggestion}`;
      });
    }

    return message;
  }

  /**
   * Returns a detailed error report for debugging
   */
  getDetailedReport(): string {
    const report = [
      `Error: ${this.name}`,
      `Code: ${this.code}`,
      `Message: ${this.message}`,
      `Severity: ${this.severity}`,
      `Category: ${this.category}`,
      `Timestamp: ${this.timestamp.toISOString()}`,
    ];

    if (this.context) {
      report.push(`Context: ${JSON.stringify(this.context, null, 2)}`);
    }

    if (this.suggestions && this.suggestions.length > 0) {
      report.push(`Suggestions: ${this.suggestions.join(', ')}`);
    }

    if (this.stack) {
      report.push(`Stack Trace:\n${this.stack}`);
    }

    return report.join('\n');
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      category: this.category,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      suggestions: this.suggestions,
      stack: this.stack,
    };
  }
}

/**
 * Command execution error
 */
export class CommandError extends AppError {
  readonly code = 'COMMAND_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.COMMAND;

  constructor(
    message: string,
    public readonly commandName: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message, options);
  }
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly severity = ErrorSeverity.LOW;
  readonly category = ErrorCategory.VALIDATION;

  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
    }
  ) {
    super(message, options);
  }
}

/**
 * Configuration error for config-related issues
 */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly category = ErrorCategory.CONFIGURATION;

  constructor(
    message: string,
    public readonly configKey?: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
    }
  ) {
    const defaultSuggestions = [
      'Check your configuration file for syntax errors',
      'Ensure all required configuration values are set',
      'Run "neo config validate" to check your configuration',
    ];

    super(message, {
      ...options,
      suggestions: options?.suggestions || defaultSuggestions,
    });
  }
}

/**
 * File system error for file operations
 */
export class FileSystemError extends AppError {
  readonly code = 'FILESYSTEM_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.FILESYSTEM;

  constructor(
    message: string,
    public readonly path: string,
    public readonly operation: 'read' | 'write' | 'delete' | 'create' | 'access',
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message, options);
  }
}

/**
 * Network error for API and network operations
 */
export class NetworkError extends AppError {
  readonly code = 'NETWORK_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.NETWORK;

  constructor(
    message: string,
    public readonly url?: string,
    public readonly statusCode?: number,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    const defaultSuggestions = [
      'Check your internet connection',
      'Verify the API endpoint is correct',
      'Check if you need to configure a proxy',
    ];

    super(message, {
      ...options,
      suggestions: options?.suggestions || defaultSuggestions,
    });
  }
}

/**
 * Plugin error for plugin-related issues
 */
export class PluginError extends AppError {
  readonly code = 'PLUGIN_ERROR';
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.PLUGIN;

  constructor(
    message: string,
    public readonly pluginName: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message, options);
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly category = ErrorCategory.AUTHENTICATION;

  constructor(
    message = 'Authentication failed',
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
    }
  ) {
    const defaultSuggestions = [
      'Check your credentials',
      'Run "neo auth login" to authenticate',
      'Verify your API token is still valid',
    ];

    super(message, {
      ...options,
      suggestions: options?.suggestions || defaultSuggestions,
    });
  }
}

/**
 * Permission error for insufficient permissions
 */
export class PermissionError extends AppError {
  readonly code = 'PERMISSION_ERROR';
  readonly severity = ErrorSeverity.HIGH;
  readonly category = ErrorCategory.PERMISSION;

  constructor(
    message: string,
    public readonly resource: string,
    public readonly requiredPermission?: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
    }
  ) {
    super(message, options);
  }
}

/**
 * Error result type for function returns
 */
export type Result<T, E extends AppError = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Helper function to create a success result
 */
export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

/**
 * Helper function to create an error result
 */
export function failure<E extends AppError>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Type guard to check if a result is successful
 */
export function isSuccess<T, E extends AppError>(
  result: Result<T, E>
): result is { success: true; data: T } {
  return result.success === true;
}

/**
 * Type guard to check if a result is a failure
 */
export function isFailure<T, E extends AppError>(
  result: Result<T, E>
): result is { success: false; error: E } {
  return result.success === false;
}

/**
 * Error recovery strategy interface
 */
export interface ErrorRecoveryStrategy<E extends AppError = AppError> {
  canRecover(error: E): boolean;
  recover(error: E): Promise<void>;
}

/**
 * Retry mechanism for transient failures
 */
export class RetryStrategy implements ErrorRecoveryStrategy {
  constructor(
    private maxRetries: number = 3,
    private delayMs: number = 1000,
    private backoff: boolean = true
  ) {}

  canRecover(error: AppError): boolean {
    // Network and filesystem errors are often transient
    return error.category === ErrorCategory.NETWORK || error.category === ErrorCategory.FILESYSTEM;
  }

  async recover(_error: AppError): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const delay = this.backoff ? this.delayMs * attempt : this.delayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));

      // In a real implementation, this would retry the original operation
      // This is a placeholder for demonstration
      console.log(`Retry attempt ${attempt} after ${delay}ms`);
    }
  }
}

/**
 * Global error handler for uncaught errors
 */
export class ErrorHandler {
  private strategies: ErrorRecoveryStrategy[] = [];

  /**
   * Register an error recovery strategy
   */
  registerStrategy(strategy: ErrorRecoveryStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Handle an error with recovery strategies
   */
  async handle(error: unknown): Promise<void> {
    const appError = this.normalizeError(error);

    // Try recovery strategies
    for (const strategy of this.strategies) {
      if (strategy.canRecover(appError)) {
        try {
          await strategy.recover(appError);
          return;
        } catch {
          // Recovery failed, continue to next strategy
          continue;
        }
      }
    }

    // No recovery possible, log and exit
    console.error(appError.getDetailedReport());
    process.exit(1);
  }

  /**
   * Normalize unknown errors to AppError
   */
  private normalizeError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new (class extends AppError {
        readonly code = 'UNKNOWN_ERROR';
        readonly severity = ErrorSeverity.HIGH;
        readonly category = ErrorCategory.UNKNOWN;
      })(error.message, { originalError: error });
    }

    return new (class extends AppError {
      readonly code = 'UNKNOWN_ERROR';
      readonly severity = ErrorSeverity.CRITICAL;
      readonly category = ErrorCategory.UNKNOWN;
    })(String(error));
  }
}

// Export a singleton error handler
export const errorHandler = new ErrorHandler();
