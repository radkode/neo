import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('@/utils/secrets.js', () => ({
  secretsManager: {
    getSecret: vi.fn(),
  },
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    read: vi.fn().mockResolvedValue({
      ai: { model: 'claude-3-haiku-20240307' },
    }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { generateCommitMessage, isAICommitAvailable } from '../../../src/services/ai/index.js';
import { secretsManager } from '@/utils/secrets.js';
import { configManager } from '@/utils/config.js';

describe('AI Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;

    // Default mock implementations
    vi.mocked(secretsManager.getSecret).mockResolvedValue(undefined);
    vi.mocked(configManager.read).mockResolvedValue({
      ai: { model: 'claude-3-haiku-20240307', enabled: true },
    } as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isAICommitAvailable', () => {
    it('should return true when API key is in secrets', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');

      const result = await isAICommitAvailable();

      expect(result).toBe(true);
      expect(secretsManager.getSecret).toHaveBeenCalledWith('ai.apiKey');
    });

    it('should return true when API key is in environment', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue(undefined);
      process.env.ANTHROPIC_API_KEY = 'sk-env-key';

      const result = await isAICommitAvailable();

      expect(result).toBe(true);
    });

    it('should return false when no API key is available', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue(undefined);
      delete process.env.ANTHROPIC_API_KEY;

      const result = await isAICommitAvailable();

      expect(result).toBe(false);
    });
  });

  describe('generateCommitMessage', () => {
    const validRequest = {
      diff: 'diff --git a/file.ts\n+added line',
      stagedFiles: ['file.ts'],
      recentCommits: ['feat: previous commit'],
      branchName: 'feature/test',
    };

    it('should return error when API key is missing', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue(undefined);
      delete process.env.ANTHROPIC_API_KEY;

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('ANTHROPIC_API_KEY');
      }
    });

    it('should return error when diff is too large', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');

      // Create a very large diff (>100KB)
      const largeDiff = 'a'.repeat(150000);

      const result = await generateCommitMessage({
        diff: largeDiff,
        stagedFiles: ['file.ts'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('too large');
      }
    });

    it('should return success on valid API response', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'feat',
                scope: 'test',
                message: 'add new feature',
                body: 'Detailed explanation',
                breaking: false,
              }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('feat');
        expect(result.data.message).toBe('add new feature');
      }
    });

    it('should handle invalid API key (401 error)', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-invalid-key');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'Invalid API key',
          },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Invalid');
      }
    });

    it('should handle rate limiting (429 error) with no retries left', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');

      // Mock headers.get to return retry-after value
      const mockHeaders = {
        get: vi.fn().mockReturnValue(null),
      };

      // Only test the final 429 response (skip retry behavior which has sleeps)
      // The function tries 3 times but we can test the final failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: mockHeaders,
        json: async () => ({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Rate limited',
          },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message.toLowerCase()).toContain('rate');
      }
    }, 30000);

    it('should handle other HTTP errors', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          type: 'error',
          error: {
            type: 'server_error',
            message: 'Internal server error',
          },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
    }, 10000);

    it('should handle network errors with retry', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');

      // First call fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'msg-123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  type: 'fix',
                  message: 'fix bug',
                  breaking: false,
                }),
              },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
        });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should handle response without text content', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'image', url: 'http://example.com/image.png' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
    }, 10000);

    it('should handle invalid JSON in response', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Not valid JSON commit response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('parse');
      }
    });

    it('should use configured model', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      vi.mocked(configManager.read).mockResolvedValue({
        ai: { model: 'claude-3-sonnet-20240229', enabled: true },
      } as never);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'feat', message: 'test', breaking: false }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      await generateCommitMessage(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('claude-3-sonnet-20240229'),
        })
      );
    });

    it('should use default model when not configured', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      vi.mocked(configManager.read).mockResolvedValue({
        ai: { enabled: true },
      } as never);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'feat', message: 'test', breaking: false }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      await generateCommitMessage(validRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('claude-3-haiku-20240307'),
        })
      );
    });

    it('should prefer secrets API key over environment variable', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-secret-key');
      process.env.ANTHROPIC_API_KEY = 'sk-env-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'feat', message: 'test', breaking: false }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      await generateCommitMessage(validRequest);

      // Should use the secrets key
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-secret-key',
          }),
        })
      );
    });

    it('should handle JSON parse error in HTTP error response', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await generateCommitMessage(validRequest);

      expect(result.success).toBe(false);
    }, 10000);

    it('should include branch name in prompt', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ type: 'feat', message: 'test', breaking: false }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      await generateCommitMessage({
        ...validRequest,
        branchName: 'feature/authentication',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('authentication'),
        })
      );
    });
  });
});
