import { describe, it, expect } from 'vitest';
import { buildCommitPrompt, parseCommitResponse, isDiffTooLarge, getDiffSize } from '@/services/ai/prompts.js';

describe('AI commit prompts', () => {
  describe('buildCommitPrompt', () => {
    it('should build a prompt with diff content', () => {
      const request = {
        diff: 'diff --git a/file.ts b/file.ts\n+console.log("hello");',
        recentCommits: [],
        branchName: 'main',
        stagedFiles: ['file.ts'],
      };

      const prompt = buildCommitPrompt(request);

      expect(prompt).toContain('diff --git');
      expect(prompt).toContain('console.log');
      expect(prompt).toContain('conventional commit');
    });

    it('should include recent commits for context', () => {
      const request = {
        diff: 'diff content',
        recentCommits: ['abc123 feat: add feature', 'def456 fix: fix bug'],
        branchName: 'feature/test',
        stagedFiles: ['file.ts'],
      };

      const prompt = buildCommitPrompt(request);

      expect(prompt).toContain('abc123 feat: add feature');
      expect(prompt).toContain('def456 fix: fix bug');
    });

    it('should include branch name for scope hints', () => {
      const request = {
        diff: 'diff content',
        recentCommits: [],
        branchName: 'feature/auth-login',
        stagedFiles: ['file.ts'],
      };

      const prompt = buildCommitPrompt(request);

      expect(prompt).toContain('feature/auth-login');
    });

    it('should not include main/master branch in prompt', () => {
      const request = {
        diff: 'diff content',
        recentCommits: [],
        branchName: 'main',
        stagedFiles: ['file.ts'],
      };

      const prompt = buildCommitPrompt(request);

      expect(prompt).not.toContain('Current branch: main');
    });

    it('should include staged files summary', () => {
      const request = {
        diff: 'diff content',
        recentCommits: [],
        branchName: 'main',
        stagedFiles: ['src/auth.ts', 'src/login.ts', 'test/auth.test.ts'],
      };

      const prompt = buildCommitPrompt(request);

      expect(prompt).toContain('src/auth.ts');
      expect(prompt).toContain('src/login.ts');
      expect(prompt).toContain('test/auth.test.ts');
    });
  });

  describe('parseCommitResponse', () => {
    it('should parse valid JSON response', () => {
      const response = JSON.stringify({
        type: 'feat',
        scope: 'auth',
        message: 'add login functionality',
        body: 'This adds the login flow',
        breaking: false,
      });

      const result = parseCommitResponse(response);

      expect(result.type).toBe('feat');
      expect(result.scope).toBe('auth');
      expect(result.message).toBe('add login functionality');
      expect(result.body).toBe('This adds the login flow');
      expect(result.breaking).toBe(false);
    });

    it('should parse JSON wrapped in markdown code blocks', () => {
      const response = '```json\n{"type":"fix","message":"fix bug","breaking":false}\n```';

      const result = parseCommitResponse(response);

      expect(result.type).toBe('fix');
      expect(result.message).toBe('fix bug');
    });

    it('should parse JSON with extra text around it', () => {
      const response = 'Here is the commit message:\n{"type":"docs","message":"update readme","breaking":false}\nLet me know if you need changes.';

      const result = parseCommitResponse(response);

      expect(result.type).toBe('docs');
      expect(result.message).toBe('update readme');
    });

    it('should handle missing optional fields', () => {
      const response = JSON.stringify({
        type: 'chore',
        message: 'update dependencies',
        breaking: false,
      });

      const result = parseCommitResponse(response);

      expect(result.type).toBe('chore');
      expect(result.scope).toBeUndefined();
      expect(result.body).toBeUndefined();
    });

    it('should throw on missing required fields', () => {
      const response = JSON.stringify({
        scope: 'auth',
        body: 'Some body',
      });

      expect(() => parseCommitResponse(response)).toThrow();
    });

    it('should throw on invalid commit type', () => {
      const response = JSON.stringify({
        type: 'invalid',
        message: 'some message',
        breaking: false,
      });

      expect(() => parseCommitResponse(response)).toThrow();
    });

    it('should truncate message to 100 characters', () => {
      const longMessage = 'a'.repeat(150);
      const response = JSON.stringify({
        type: 'feat',
        message: longMessage,
        breaking: false,
      });

      const result = parseCommitResponse(response);

      expect(result.message.length).toBe(100);
    });
  });

  describe('isDiffTooLarge', () => {
    it('should return false for small diffs', () => {
      const smallDiff = 'diff --git a/file.ts b/file.ts\n+console.log("hello");';

      expect(isDiffTooLarge(smallDiff)).toBe(false);
    });

    it('should return true for very large diffs', () => {
      const largeDiff = 'a'.repeat(150000); // 150KB

      expect(isDiffTooLarge(largeDiff)).toBe(true);
    });
  });

  describe('getDiffSize', () => {
    it('should return the length of the diff', () => {
      const diff = 'test diff content';

      expect(getDiffSize(diff)).toBe(diff.length);
    });
  });
});
