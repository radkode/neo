import { describe, it, expect } from 'vitest';
import {
  baseOptionsSchema,
  initOptionsSchema,
  gitPushOptionsSchema,
  gitPullOptionsSchema,
  gitCommitOptionsSchema,
  commitTypeSchema,
  commitScopeSchema,
  commitMessageSchema,
  updateOptionsSchema,
  configKeySchema,
  bannerValueSchema,
  themeValueSchema,
  shellTypeSchema,
  aliasSetupOptionsSchema,
} from '../../src/types/schemas.js';

describe('schemas', () => {
  describe('baseOptionsSchema', () => {
    it('should validate valid base options', () => {
      const valid = {
        verbose: true,
        config: '/path/to/config',
        color: false,
        banner: true,
      };
      expect(baseOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should accept empty options', () => {
      const valid = {};
      expect(baseOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should accept partial options', () => {
      const valid = { verbose: true };
      expect(baseOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid types', () => {
      const invalid = { verbose: 'yes' };
      expect(baseOptionsSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('initOptionsSchema', () => {
    it('should validate valid init options', () => {
      const valid = {
        force: true,
        skipInstall: false,
      };
      expect(initOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should inherit base options', () => {
      const valid = {
        force: true,
        verbose: true,
        config: '/path/to/config',
      };
      expect(initOptionsSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('gitPushOptionsSchema', () => {
    it('should validate valid git push options', () => {
      const valid = {
        dryRun: true,
        force: false,
        setUpstream: true,
        tags: true,
        remote: 'origin',
        branch: 'feature/test',
      };
      expect(gitPushOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should accept setUpstream as boolean', () => {
      expect(gitPushOptionsSchema.safeParse({ setUpstream: true }).success).toBe(true);
      expect(gitPushOptionsSchema.safeParse({ setUpstream: false }).success).toBe(true);
    });

    it('should accept remote and branch strings', () => {
      const valid = { remote: 'upstream', branch: 'main' };
      expect(gitPushOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should accept empty options', () => {
      const result = gitPushOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('gitPullOptionsSchema', () => {
    it('should validate valid git pull options', () => {
      const valid = {
        rebase: true,
        noRebase: false,
      };
      expect(gitPullOptionsSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('updateOptionsSchema', () => {
    it('should validate valid update options', () => {
      const valid = {
        checkOnly: true,
        force: false,
      };
      expect(updateOptionsSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('configKeySchema', () => {
    it('should validate valid config keys', () => {
      const validKeys = [
        'user.name',
        'user.email',
        'preferences.banner',
        'preferences.theme',
        'shell.type',
        'installation.version',
      ];

      for (const key of validKeys) {
        const result = configKeySchema.safeParse(key);
        expect(result.success).toBe(true);
      }
    });

    it('should reject empty config keys', () => {
      const result = configKeySchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should reject invalid characters', () => {
      const invalidKeys = ['user@name', 'config key', 'test!', 'key#value'];

      for (const key of invalidKeys) {
        const result = configKeySchema.safeParse(key);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('bannerValueSchema', () => {
    it('should validate valid banner values', () => {
      const validValues = ['full', 'compact', 'none'];

      for (const value of validValues) {
        const result = bannerValueSchema.safeParse(value);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid banner values', () => {
      const invalidValues = ['mini', 'large', '', 'FULL', 'Full'];

      for (const value of invalidValues) {
        const result = bannerValueSchema.safeParse(value);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('themeValueSchema', () => {
    it('should validate valid theme values', () => {
      const validValues = ['dark', 'light', 'auto'];

      for (const value of validValues) {
        const result = themeValueSchema.safeParse(value);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid theme values', () => {
      const invalidValues = ['system', '', 'DARK', 'Light'];

      for (const value of invalidValues) {
        const result = themeValueSchema.safeParse(value);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('shellTypeSchema', () => {
    it('should validate valid shell types', () => {
      const validValues = ['zsh', 'bash', 'fish'];

      for (const value of validValues) {
        const result = shellTypeSchema.safeParse(value);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid shell types', () => {
      const invalidValues = ['sh', 'powershell', '', 'ZSH', 'Bash'];

      for (const value of invalidValues) {
        const result = shellTypeSchema.safeParse(value);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('aliasSetupOptionsSchema', () => {
    it('should validate valid alias setup options', () => {
      const valid = {
        force: true,
        enable: false,
        disable: true,
      };
      expect(aliasSetupOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should inherit base options', () => {
      const valid = {
        force: true,
        verbose: true,
      };
      expect(aliasSetupOptionsSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('commitTypeSchema', () => {
    it('should validate all conventional commit types', () => {
      const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

      for (const type of validTypes) {
        const result = commitTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
        expect(result.data).toBe(type);
      }
    });

    it('should reject invalid commit types', () => {
      const invalidTypes = ['feature', 'bugfix', 'update', 'build', 'ci', 'perf', 'random'];

      for (const type of invalidTypes) {
        const result = commitTypeSchema.safeParse(type);
        expect(result.success).toBe(false);
      }
    });

    it('should provide helpful error message', () => {
      const result = commitTypeSchema.safeParse('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('feat, fix, docs');
      }
    });
  });

  describe('commitScopeSchema', () => {
    it('should validate valid scopes', () => {
      const validScopes = ['auth', 'api', 'ui', 'db', 'user-service', 'payment-flow', 'test123'];

      for (const scope of validScopes) {
        const result = commitScopeSchema.safeParse(scope);
        expect(result.success).toBe(true);
      }
    });

    it('should reject uppercase scopes', () => {
      const invalidScopes = ['Auth', 'API', 'UserService', 'PAYMENT'];

      for (const scope of invalidScopes) {
        const result = commitScopeSchema.safeParse(scope);
        expect(result.success).toBe(false);
      }
    });

    it('should reject scopes with special characters', () => {
      const invalidScopes = ['user_service', 'test@123', 'scope!', 'test#tag', 'test scope'];

      for (const scope of invalidScopes) {
        const result = commitScopeSchema.safeParse(scope);
        expect(result.success).toBe(false);
      }
    });

    it('should reject scopes starting with numbers', () => {
      const result = commitScopeSchema.safeParse('123test');
      expect(result.success).toBe(false);
    });

    it('should reject empty scopes', () => {
      const result = commitScopeSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should accept undefined (optional)', () => {
      const result = commitScopeSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should provide helpful error message', () => {
      const result = commitScopeSchema.safeParse('Invalid_Scope');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('lowercase');
      }
    });
  });

  describe('commitMessageSchema', () => {
    it('should validate valid messages', () => {
      const validMessages = [
        'Add new feature',
        'Fix critical bug',
        'Update documentation',
        'a'.repeat(100), // Max length
      ];

      for (const message of validMessages) {
        const result = commitMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
      }
    });

    it('should reject empty messages', () => {
      const result = commitMessageSchema.safeParse('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('cannot be empty');
      }
    });

    it('should reject messages over 100 characters', () => {
      const tooLong = 'a'.repeat(101);
      const result = commitMessageSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('too long');
      }
    });

    it('should accept exactly 100 characters', () => {
      const maxLength = 'a'.repeat(100);
      const result = commitMessageSchema.safeParse(maxLength);
      expect(result.success).toBe(true);
    });
  });

  describe('gitCommitOptionsSchema', () => {
    it('should validate complete commit options', () => {
      const valid = {
        type: 'feat',
        scope: 'auth',
        message: 'Add login functionality',
        body: 'This adds OAuth2 support',
        breaking: true,
        all: false,
      };
      const result = gitCommitOptionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(valid);
    });

    it('should validate minimal commit options (all optional)', () => {
      const result = gitCommitOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate with only type', () => {
      const valid = { type: 'fix' };
      const result = gitCommitOptionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with type and message', () => {
      const valid = { type: 'feat', message: 'Add feature' };
      const result = gitCommitOptionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const invalid = { type: 'invalid' };
      const result = gitCommitOptionsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid scope format', () => {
      const invalid = { scope: 'Invalid_Scope' };
      const result = gitCommitOptionsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject message over length limit', () => {
      const invalid = { message: 'a'.repeat(101) };
      const result = gitCommitOptionsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid boolean values', () => {
      expect(gitCommitOptionsSchema.safeParse({ breaking: 'yes' }).success).toBe(false);
      expect(gitCommitOptionsSchema.safeParse({ all: 1 }).success).toBe(false);
    });

    it('should inherit base options', () => {
      const valid = {
        type: 'fix',
        message: 'Fix bug',
        verbose: true,
        config: '/path/to/config',
      };
      const result = gitCommitOptionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
