/**
 * AI service for commit message generation
 */

import { type Result, success, failure } from '@/core/errors/index.js';
import { secretsManager } from '@/utils/secrets.js';
import { configManager } from '@/utils/config.js';
import { AIErrors } from './errors.js';
import {
  buildCommitPrompt,
  parseCommitResponse,
  isDiffTooLarge,
  getDiffSize,
  type AICommitRequest,
  type AICommitResponse,
} from './prompts.js';

// Re-export types for convenience
export type { AICommitRequest, AICommitResponse } from './prompts.js';
export { AIError, AIErrors } from './errors.js';

/**
 * Anthropic API configuration
 */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 500;

/**
 * Get the API key from secrets file, falling back to environment variable
 */
async function getApiKey(): Promise<string | undefined> {
  // First check secrets file
  const secretKey = await secretsManager.getSecret('ai.apiKey');
  if (secretKey) {
    return secretKey;
  }

  // Fall back to environment variable
  return process.env['ANTHROPIC_API_KEY'];
}

/**
 * Get the configured AI model
 */
async function getModel(): Promise<string> {
  const config = await configManager.read();
  return config.ai.model || 'claude-3-haiku-20240307';
}

/**
 * Anthropic API response structure
 */
interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic API error response structure
 */
interface AnthropicErrorResponse {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

/**
 * Call the Anthropic API with retry logic
 */
async function callAnthropicAPI(prompt: string, retries = 3): Promise<Result<string>> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return failure(AIErrors.missingApiKey());
  }

  const model = await getModel();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (attempt < retries) {
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * attempt;
          await sleep(waitTime);
          continue;
        }
        return failure(AIErrors.rateLimited(retryAfter ? parseInt(retryAfter, 10) : undefined));
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as AnthropicErrorResponse;
        const errorMessage = errorBody?.error?.message || `HTTP ${response.status}`;

        // Authentication error
        if (response.status === 401) {
          return failure(AIErrors.invalidApiKey());
        }

        throw new Error(errorMessage);
      }

      const data = (await response.json()) as AnthropicResponse;

      // Extract text from response
      const textContent = data.content.find((c) => c.type === 'text');
      if (!textContent) {
        throw new Error('No text content in response');
      }

      return success(textContent.text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Retry on network errors
      if (attempt < retries && isNetworkError(error)) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }

  return failure(AIErrors.networkError(lastError || new Error('Unknown error')));
}

/**
 * Check if an error is a network-related error
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('timeout')
    );
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a commit message using AI
 */
export async function generateCommitMessage(request: AICommitRequest): Promise<Result<AICommitResponse>> {
  // Check if diff is too large
  if (isDiffTooLarge(request.diff)) {
    return failure(AIErrors.tokenLimitExceeded(getDiffSize(request.diff)));
  }

  // Build the prompt
  const prompt = buildCommitPrompt(request);

  // Call the API
  const apiResult = await callAnthropicAPI(prompt);
  if (!apiResult.success) {
    return apiResult;
  }

  // Parse the response
  try {
    const commitResponse = parseCommitResponse(apiResult.data);
    return success(commitResponse);
  } catch {
    return failure(AIErrors.invalidResponse(apiResult.data));
  }
}

/**
 * Check if AI commit is available (API key is set)
 */
export async function isAICommitAvailable(): Promise<boolean> {
  const apiKey = await getApiKey();
  return Boolean(apiKey);
}
