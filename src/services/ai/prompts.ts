/**
 * Prompt templates for AI-powered commit message generation
 */

import type { CommitType } from '@/types/schemas.js';

/**
 * Request structure for commit message generation
 */
export interface AICommitRequest {
  diff: string;
  recentCommits: string[];
  branchName: string;
  stagedFiles: string[];
}

/**
 * Response structure from AI commit generation
 */
export interface AICommitResponse {
  type: CommitType;
  scope?: string;
  message: string;
  body?: string;
  breaking: boolean;
}

/**
 * Maximum diff size to send to the API (in characters)
 * Claude has a large context window, but we limit for cost/speed
 */
const MAX_DIFF_SIZE = 50000;

/**
 * Truncate diff if too large, keeping the most important parts
 */
function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_SIZE) {
    return diff;
  }

  // Keep file headers and first part of each file's changes
  const lines = diff.split('\n');
  const result: string[] = [];
  let currentSize = 0;
  let inFileHeader = false;

  for (const line of lines) {
    // Always include file headers (diff --git, +++, ---)
    if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---')) {
      inFileHeader = true;
    } else if (line.startsWith('@@')) {
      inFileHeader = false;
    }

    if (inFileHeader || currentSize < MAX_DIFF_SIZE * 0.8) {
      result.push(line);
      currentSize += line.length + 1;
    }
  }

  if (result.length < lines.length) {
    result.push('', '... (diff truncated for length)');
  }

  return result.join('\n');
}

/**
 * Build the prompt for commit message generation
 */
export function buildCommitPrompt(request: AICommitRequest): string {
  const truncatedDiff = truncateDiff(request.diff);

  const systemPrompt = `You are a commit message generator. Generate a conventional commit message based on the staged changes.

Conventional commit format:
- type(scope): message
- Types: feat, fix, docs, style, refactor, test, chore
- Scope is optional but helpful (e.g., the component or area affected)
- Message should be lowercase, imperative, and under 72 characters
- Body is optional - only add if the change needs explanation

Rules:
1. Analyze the diff to understand what changed
2. Choose the most appropriate type based on the changes
3. Infer scope from file paths or the nature of changes
4. Write a clear, concise message describing the change
5. Only add a body if the change is complex or non-obvious
6. Set breaking to true only if this is a breaking change (API changes, removed features, etc.)

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"type":"feat","scope":"optional-scope","message":"lowercase imperative description","body":"optional longer explanation","breaking":false}`;

  const contextParts: string[] = [];

  // Add branch name for scope hints
  if (request.branchName && request.branchName !== 'main' && request.branchName !== 'master') {
    contextParts.push(`Current branch: ${request.branchName}`);
  }

  // Add recent commits for style reference
  if (request.recentCommits.length > 0) {
    contextParts.push(`Recent commits (for style reference):\n${request.recentCommits.slice(0, 5).join('\n')}`);
  }

  // Add staged files summary
  if (request.stagedFiles.length > 0) {
    contextParts.push(`Staged files (${request.stagedFiles.length}):\n${request.stagedFiles.slice(0, 20).join('\n')}`);
  }

  const context = contextParts.length > 0 ? contextParts.join('\n\n') + '\n\n' : '';

  return `${systemPrompt}\n\n${context}Staged diff:\n\`\`\`\n${truncatedDiff}\n\`\`\``;
}

/**
 * Parse the AI response into a structured commit response
 */
export function parseCommitResponse(response: string): AICommitResponse {
  // Try to extract JSON from the response
  // The AI might wrap it in markdown code blocks or add extra text
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  const parsed = JSON.parse(jsonStr);

  // Validate required fields
  if (!parsed.type || !parsed.message) {
    throw new Error('Missing required fields in AI response');
  }

  // Validate commit type
  const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];
  if (!validTypes.includes(parsed.type)) {
    throw new Error(`Invalid commit type: ${parsed.type}`);
  }

  return {
    type: parsed.type as CommitType,
    scope: parsed.scope || undefined,
    message: String(parsed.message).slice(0, 100), // Enforce max length
    body: parsed.body || undefined,
    breaking: Boolean(parsed.breaking),
  };
}

/**
 * Check if the diff is too large to process
 */
export function isDiffTooLarge(diff: string): boolean {
  // We can handle up to MAX_DIFF_SIZE with truncation
  // But if it's extremely large, warn the user
  return diff.length > MAX_DIFF_SIZE * 2;
}

/**
 * Get the diff size for error messages
 */
export function getDiffSize(diff: string): number {
  return diff.length;
}
