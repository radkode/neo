/**
 * AI-specific error types for the commit message generation feature
 */

import { AppError, ErrorSeverity, ErrorCategory } from '@/core/errors/index.js';

/**
 * AI error codes for specific error types
 */
export enum AIErrorCode {
  MISSING_API_KEY = 'AI_MISSING_API_KEY',
  INVALID_API_KEY = 'AI_INVALID_API_KEY',
  RATE_LIMITED = 'AI_RATE_LIMITED',
  TOKEN_LIMIT_EXCEEDED = 'AI_TOKEN_LIMIT_EXCEEDED',
  INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  NETWORK_ERROR = 'AI_NETWORK_ERROR',
  UNKNOWN = 'AI_UNKNOWN_ERROR',
}

/**
 * AI-specific error class
 */
export class AIError extends AppError {
  readonly code: string;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.NETWORK;

  constructor(
    code: AIErrorCode,
    message: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message, options);
    this.code = code;
  }
}

/**
 * Factory for creating common AI errors with helpful suggestions
 */
export const AIErrors = {
  /**
   * API key is not configured
   */
  missingApiKey(): AIError {
    return new AIError(AIErrorCode.MISSING_API_KEY, 'ANTHROPIC_API_KEY environment variable is not set', {
      suggestions: [
        'Set the ANTHROPIC_API_KEY environment variable',
        'Get an API key at https://console.anthropic.com',
        'Add to your shell profile: export ANTHROPIC_API_KEY="your-key"',
      ],
    });
  },

  /**
   * API key is invalid
   */
  invalidApiKey(): AIError {
    return new AIError(AIErrorCode.INVALID_API_KEY, 'Invalid API key', {
      suggestions: [
        'Check that your ANTHROPIC_API_KEY is correct',
        'Get a new API key at https://console.anthropic.com',
      ],
    });
  },

  /**
   * API rate limit exceeded
   */
  rateLimited(retryAfter?: number): AIError {
    const message = retryAfter
      ? `API rate limit exceeded. Retry after ${retryAfter} seconds.`
      : 'API rate limit exceeded.';

    return new AIError(AIErrorCode.RATE_LIMITED, message, {
      context: { retryAfter },
      suggestions: ['Wait a moment and try again', 'Check your API usage at https://console.anthropic.com'],
    });
  },

  /**
   * Token limit exceeded for the diff
   */
  tokenLimitExceeded(diffSize: number): AIError {
    return new AIError(
      AIErrorCode.TOKEN_LIMIT_EXCEEDED,
      `Staged changes are too large for AI analysis (${diffSize} characters)`,
      {
        context: { diffSize },
        suggestions: [
          'Stage fewer files at once',
          'Split your changes into smaller commits',
          'Use the interactive wizard instead: neo git commit',
        ],
      }
    );
  },

  /**
   * Failed to parse AI response
   */
  invalidResponse(rawResponse: string): AIError {
    return new AIError(AIErrorCode.INVALID_RESPONSE, 'Failed to parse AI response', {
      context: { rawResponse: rawResponse.slice(0, 500) },
      suggestions: ['Try again - AI responses can vary', 'Use the interactive wizard instead: neo git commit'],
    });
  },

  /**
   * Network error during API call
   */
  networkError(error: Error): AIError {
    return new AIError(AIErrorCode.NETWORK_ERROR, `Failed to connect to AI service: ${error.message}`, {
      originalError: error,
      suggestions: [
        'Check your internet connection',
        'Verify the Anthropic API is available',
        'Try again in a moment',
      ],
    });
  },

  /**
   * Unknown AI error
   */
  unknown(error: unknown): AIError {
    const message = error instanceof Error ? error.message : String(error);
    const options: {
      originalError?: Error;
      suggestions: string[];
    } = {
      suggestions: ['Try again', 'Use the interactive wizard instead: neo git commit'],
    };
    if (error instanceof Error) {
      options.originalError = error;
    }
    return new AIError(AIErrorCode.UNKNOWN, `AI service error: ${message}`, options);
  },
};
