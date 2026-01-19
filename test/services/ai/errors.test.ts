import { describe, it, expect } from 'vitest';
import { AIError, AIErrors, AIErrorCode } from '@/services/ai/errors.js';

describe('AI errors', () => {
  describe('AIError', () => {
    it('should create an error with code and message', () => {
      const error = new AIError(AIErrorCode.MISSING_API_KEY, 'API key not set');

      expect(error.code).toBe('AI_MISSING_API_KEY');
      expect(error.message).toBe('API key not set');
    });

    it('should include suggestions', () => {
      const error = new AIError(AIErrorCode.RATE_LIMITED, 'Rate limited', {
        suggestions: ['Try again later'],
      });

      expect(error.suggestions).toContain('Try again later');
    });

    it('should include context', () => {
      const error = new AIError(AIErrorCode.TOKEN_LIMIT_EXCEEDED, 'Too large', {
        context: { size: 100000 },
      });

      expect(error.context).toEqual({ size: 100000 });
    });
  });

  describe('AIErrors factory', () => {
    it('should create missingApiKey error with helpful suggestions', () => {
      const error = AIErrors.missingApiKey();

      expect(error.code).toBe('AI_MISSING_API_KEY');
      expect(error.message).toContain('ANTHROPIC_API_KEY');
      expect(error.suggestions).toBeDefined();
      expect(error.suggestions!.length).toBeGreaterThan(0);
    });

    it('should create rateLimited error with retry info', () => {
      const error = AIErrors.rateLimited(30);

      expect(error.code).toBe('AI_RATE_LIMITED');
      expect(error.message).toContain('30 seconds');
      expect(error.context).toEqual({ retryAfter: 30 });
    });

    it('should create rateLimited error without retry info', () => {
      const error = AIErrors.rateLimited();

      expect(error.code).toBe('AI_RATE_LIMITED');
      expect(error.message).not.toContain('seconds');
    });

    it('should create tokenLimitExceeded error with size info', () => {
      const error = AIErrors.tokenLimitExceeded(100000);

      expect(error.code).toBe('AI_TOKEN_LIMIT_EXCEEDED');
      expect(error.message).toContain('100000');
      expect(error.context).toEqual({ diffSize: 100000 });
    });

    it('should create invalidResponse error with raw response', () => {
      const rawResponse = '{"invalid": true';
      const error = AIErrors.invalidResponse(rawResponse);

      expect(error.code).toBe('AI_INVALID_RESPONSE');
      expect(error.context?.['rawResponse']).toBe(rawResponse);
    });

    it('should truncate long raw responses in invalidResponse', () => {
      const longResponse = 'a'.repeat(1000);
      const error = AIErrors.invalidResponse(longResponse);

      expect((error.context?.['rawResponse'] as string).length).toBe(500);
    });

    it('should create networkError with original error', () => {
      const originalError = new Error('Connection refused');
      const error = AIErrors.networkError(originalError);

      expect(error.code).toBe('AI_NETWORK_ERROR');
      expect(error.message).toContain('Connection refused');
      expect(error.originalError).toBe(originalError);
    });

    it('should create unknown error from Error instance', () => {
      const originalError = new Error('Something went wrong');
      const error = AIErrors.unknown(originalError);

      expect(error.code).toBe('AI_UNKNOWN_ERROR');
      expect(error.message).toContain('Something went wrong');
      expect(error.originalError).toBe(originalError);
    });

    it('should create unknown error from string', () => {
      const error = AIErrors.unknown('string error');

      expect(error.code).toBe('AI_UNKNOWN_ERROR');
      expect(error.message).toContain('string error');
    });
  });
});
