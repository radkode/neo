import { describe, it, expect } from 'vitest';
import {
  baseOptionsSchema,
  initOptionsSchema,
  gitPushOptionsSchema,
  gitPullOptionsSchema,
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
        setUpstream: 'feature/test',
        tags: true,
      };
      expect(gitPushOptionsSchema.safeParse(valid).success).toBe(true);
    });

    it('should validate valid branch names', () => {
      const validBranches = ['main', 'feature/test', 'feature-123', 'fix_bug', 'release/v1.0.0'];

      for (const branch of validBranches) {
        const result = gitPushOptionsSchema.safeParse({ setUpstream: branch });
        expect(result.success).toBe(true);
      }
    });

    it('should reject empty branch names', () => {
      const invalid = { setUpstream: '' };
      const result = gitPushOptionsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid branch name characters', () => {
      const invalidBranches = ['feature@test', 'main branch', 'test!', 'feat#123'];

      for (const branch of invalidBranches) {
        const result = gitPushOptionsSchema.safeParse({ setUpstream: branch });
        expect(result.success).toBe(false);
      }
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
});
