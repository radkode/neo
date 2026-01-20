import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { rm, mkdtemp, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to create the temp dir before importing SecretsManager
// because the homedir mock needs to return it
let tempHomeDir: string;

beforeAll(async () => {
  tempHomeDir = await mkdtemp(join(tmpdir(), 'neo-secrets-test-home-'));
});

// Mock homedir before importing the secrets module
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => tempHomeDir,
  };
});

// Import types statically (they're erased at runtime anyway)
import type { NeoSecrets } from '../../src/utils/secrets.js';

// Import values after mocking - FORCE fresh import each test
let SecretsManager: typeof import('../../src/utils/secrets.js').SecretsManager;

describe('SecretsManager', () => {
  let tempDir: string;
  let secretsManager: InstanceType<typeof SecretsManager>;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'neo-secrets-test-'));
    // Update the mock to use this temp directory
    tempHomeDir = tempDir;

    // Re-import the module to get a fresh SecretsManager
    vi.resetModules();
    const module = await import('../../src/utils/secrets.js');
    SecretsManager = module.SecretsManager;

    // Create a new instance
    secretsManager = new SecretsManager();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('getSecretsFile', () => {
    it('should return the secrets file path', () => {
      const secretsFile = secretsManager.getSecretsFile();
      expect(secretsFile).toBe(join(tempDir, '.config', 'neo', 'secrets.json'));
    });
  });

  describe('exists', () => {
    it('should return false when secrets file does not exist', async () => {
      const result = await secretsManager.exists();
      expect(result).toBe(false);
    });

    it('should return true when secrets file exists', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(join(secretsDir, 'secrets.json'), '{}');

      const result = await secretsManager.exists();
      expect(result).toBe(true);
    });
  });

  describe('read', () => {
    it('should return empty object when not initialized', async () => {
      const secrets = await secretsManager.read();
      expect(secrets).toEqual({});
    });

    it('should read existing secrets', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });

      const secretsData = {
        ai: {
          apiKey: 'sk-ant-test-key',
        },
      };
      await writeFile(join(secretsDir, 'secrets.json'), JSON.stringify(secretsData));

      const secrets = await secretsManager.read();
      expect(secrets.ai?.apiKey).toBe('sk-ant-test-key');
    });

    it('should return empty object if secrets file is invalid JSON', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(join(secretsDir, 'secrets.json'), 'not valid json');

      const secrets = await secretsManager.read();
      expect(secrets).toEqual({});
    });
  });

  describe('write', () => {
    it('should create secrets directory if it does not exist', async () => {
      await secretsManager.write({ ai: { apiKey: 'sk-ant-test-key' } });

      const secretsFile = join(tempDir, '.config', 'neo', 'secrets.json');
      const content = await readFile(secretsFile, 'utf-8');
      const savedSecrets = JSON.parse(content);

      expect(savedSecrets.ai.apiKey).toBe('sk-ant-test-key');
    });

    it('should set restrictive file permissions (0600)', async () => {
      await secretsManager.write({ ai: { apiKey: 'sk-ant-test-key' } });

      const secretsFile = join(tempDir, '.config', 'neo', 'secrets.json');
      const stats = await stat(secretsFile);

      // Check that only owner has read/write permissions (0600 = 384 in decimal)
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe('getSecret', () => {
    it('should return undefined for non-existent secret', async () => {
      const value = await secretsManager.getSecret('ai.apiKey');
      expect(value).toBeUndefined();
    });

    it('should return secret value by path', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(
        join(secretsDir, 'secrets.json'),
        JSON.stringify({ ai: { apiKey: 'sk-ant-test-key' } })
      );

      const value = await secretsManager.getSecret('ai.apiKey');
      expect(value).toBe('sk-ant-test-key');
    });

    it('should return undefined for invalid path', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(
        join(secretsDir, 'secrets.json'),
        JSON.stringify({ ai: { apiKey: 'sk-ant-test-key' } })
      );

      const value = await secretsManager.getSecret('invalid.path');
      expect(value).toBeUndefined();
    });
  });

  describe('setSecret', () => {
    it('should set a secret value', async () => {
      await secretsManager.setSecret('ai.apiKey', 'sk-ant-new-key');

      const secretsFile = join(tempDir, '.config', 'neo', 'secrets.json');
      const content = await readFile(secretsFile, 'utf-8');
      const savedSecrets = JSON.parse(content);

      expect(savedSecrets.ai.apiKey).toBe('sk-ant-new-key');
    });

    it('should update existing secret', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(
        join(secretsDir, 'secrets.json'),
        JSON.stringify({ ai: { apiKey: 'sk-ant-old-key' } })
      );

      await secretsManager.setSecret('ai.apiKey', 'sk-ant-new-key');

      const value = await secretsManager.getSecret('ai.apiKey');
      expect(value).toBe('sk-ant-new-key');
    });
  });

  describe('deleteSecret', () => {
    it('should delete a secret', async () => {
      const secretsDir = join(tempDir, '.config', 'neo');
      await mkdir(secretsDir, { recursive: true });
      await writeFile(
        join(secretsDir, 'secrets.json'),
        JSON.stringify({ ai: { apiKey: 'sk-ant-test-key' } })
      );

      await secretsManager.deleteSecret('ai.apiKey');

      const value = await secretsManager.getSecret('ai.apiKey');
      expect(value).toBeUndefined();
    });

    it('should not fail when deleting non-existent secret', async () => {
      await expect(secretsManager.deleteSecret('nonexistent.key')).resolves.not.toThrow();
    });
  });

  describe('isConfigured', () => {
    it('should return false when secret is not set', async () => {
      const exists = await secretsManager.exists();
      expect(exists).toBe(false);

      const result = await secretsManager.isConfigured('ai.apiKey');
      expect(result).toBe(false);
    });

    it('should return true when secret is set', async () => {
      await secretsManager.setSecret('ai.apiKey', 'sk-ant-test-key');

      const result = await secretsManager.isConfigured('ai.apiKey');
      expect(result).toBe(true);
    });

    it('should return false for empty string', async () => {
      await secretsManager.setSecret('ai.apiKey', '');

      const result = await secretsManager.isConfigured('ai.apiKey');
      expect(result).toBe(false);
    });
  });

  describe('maskSecret', () => {
    it('should mask all but last 4 characters', () => {
      const masked = SecretsManager.maskSecret('sk-ant-api03-abcdef123456');
      expect(masked).toBe('****3456');
    });

    it('should show only asterisks for short secrets', () => {
      const masked = SecretsManager.maskSecret('abc');
      expect(masked).toBe('****');
    });

    it('should handle exactly 4 character secrets', () => {
      const masked = SecretsManager.maskSecret('abcd');
      expect(masked).toBe('****');
    });
  });
});
