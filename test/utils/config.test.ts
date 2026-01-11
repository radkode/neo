import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { rm, mkdtemp, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// We need to create the temp dir before importing ConfigManager
// because DEFAULT_CONFIG is evaluated at module load time
let tempHomeDir: string;

beforeAll(async () => {
  tempHomeDir = await mkdtemp(join(tmpdir(), 'neo-config-test-home-'));
});

// Mock homedir before importing the config module
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => tempHomeDir || actual.homedir(),
  };
});

// Import types statically (they're erased at runtime anyway)
import type { NeoConfig } from '../../src/utils/config.js';

// Import values after mocking
const { ConfigManager } = await import('../../src/utils/config.js');

describe('ConfigManager', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'neo-config-test-'));
    // Update the mock to use this temp directory
    tempHomeDir = tempDir;

    // Create a new instance
    configManager = new ConfigManager();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('getConfigDir', () => {
    it('should return the config directory path', () => {
      const configDir = configManager.getConfigDir();
      expect(configDir).toBe(join(tempDir, '.config', 'neo'));
    });
  });

  describe('getConfigFile', () => {
    it('should return the config file path', () => {
      const configFile = configManager.getConfigFile();
      expect(configFile).toBe(join(tempDir, '.config', 'neo', 'config.json'));
    });
  });

  describe('isInitialized', () => {
    it('should return false when config does not exist', async () => {
      const result = await configManager.isInitialized();
      expect(result).toBe(false);
    });

    it('should return true when config exists', async () => {
      // Create the config directory and file
      const configDir = join(tempDir, '.config', 'neo');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), '{}');

      const result = await configManager.isInitialized();
      expect(result).toBe(true);
    });
  });

  describe('read', () => {
    it('should return default config when not initialized', async () => {
      const config = await configManager.read();

      expect(config.preferences.banner).toBe('full');
      expect(config.preferences.theme).toBe('auto');
      expect(config.preferences.aliases.n).toBe(true);
      expect(config.shell.type).toBe('zsh');
    });

    it('should read existing config and merge with defaults', async () => {
      // Create a partial config
      const configDir = join(tempDir, '.config', 'neo');
      await mkdir(configDir, { recursive: true });

      const partialConfig = {
        preferences: {
          banner: 'compact',
          theme: 'dark',
        },
        user: {
          name: 'Test User',
        },
      };
      await writeFile(join(configDir, 'config.json'), JSON.stringify(partialConfig));

      const config = await configManager.read();

      // Custom values
      expect(config.preferences.banner).toBe('compact');
      expect(config.preferences.theme).toBe('dark');
      expect(config.user.name).toBe('Test User');

      // Default values should be preserved
      expect(config.preferences.aliases.n).toBe(true);
      expect(config.shell.type).toBe('zsh');
    });

    it('should return defaults if config file is invalid JSON', async () => {
      const configDir = join(tempDir, '.config', 'neo');
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), 'not valid json');

      const config = await configManager.read();

      // Should return defaults
      expect(config.preferences.banner).toBe('full');
    });
  });

  describe('write', () => {
    it('should create config directory if it does not exist', async () => {
      const config: NeoConfig = {
        installation: {
          installedAt: '2024-01-01T00:00:00.000Z',
          version: '1.0.0',
        },
        preferences: {
          aliases: { n: true },
          banner: 'full',
          theme: 'auto',
        },
        shell: {
          rcFile: '/home/test/.zshrc',
          type: 'zsh',
        },
        updates: {
          lastCheckedAt: null,
          latestVersion: null,
        },
        user: {},
      };

      await configManager.write(config);

      const configFile = join(tempDir, '.config', 'neo', 'config.json');
      const content = await readFile(configFile, 'utf-8');
      const savedConfig = JSON.parse(content);

      expect(savedConfig.installation.version).toBe('1.0.0');
      expect(savedConfig.preferences.banner).toBe('full');
    });

    it('should format config as pretty JSON', async () => {
      const config: NeoConfig = {
        installation: {
          installedAt: '2024-01-01T00:00:00.000Z',
          version: '1.0.0',
        },
        preferences: {
          aliases: { n: true },
          banner: 'full',
          theme: 'auto',
        },
        shell: {
          rcFile: '/home/test/.zshrc',
          type: 'zsh',
        },
        updates: {
          lastCheckedAt: null,
          latestVersion: null,
        },
        user: {},
      };

      await configManager.write(config);

      const configFile = join(tempDir, '.config', 'neo', 'config.json');
      const content = await readFile(configFile, 'utf-8');

      // Should be formatted with indentation
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });
  });

  describe('update', () => {
    it('should update specific values while preserving others', async () => {
      // First write an initial config
      const initialConfig: NeoConfig = {
        installation: {
          installedAt: '2024-01-01T00:00:00.000Z',
          version: '1.0.0',
        },
        preferences: {
          aliases: { n: true },
          banner: 'full',
          theme: 'auto',
        },
        shell: {
          rcFile: '/home/test/.zshrc',
          type: 'zsh',
        },
        updates: {
          lastCheckedAt: null,
          latestVersion: null,
        },
        user: {
          name: 'Original Name',
        },
      };

      await configManager.write(initialConfig);

      // Update just the banner
      await configManager.update({
        preferences: {
          banner: 'compact',
          aliases: { n: true },
          theme: 'auto',
        },
      });

      const config = await configManager.read();

      // Updated value
      expect(config.preferences.banner).toBe('compact');

      // Preserved values
      expect(config.user.name).toBe('Original Name');
      expect(config.installation.version).toBe('1.0.0');
    });
  });

  describe('backup', () => {
    it('should return null when config does not exist', async () => {
      const result = await configManager.backup();
      expect(result).toBeNull();
    });

    it('should create backup file with timestamp', async () => {
      // Create initial config
      const configDir = join(tempDir, '.config', 'neo');
      await mkdir(configDir, { recursive: true });
      const originalContent = JSON.stringify({ test: 'data' });
      await writeFile(join(configDir, 'config.json'), originalContent);

      const backupPath = await configManager.backup();

      expect(backupPath).not.toBeNull();
      expect(backupPath).toContain('config.backup.');
      expect(backupPath).toContain('.json');

      // Verify backup content matches original
      const backupContent = await readFile(backupPath!, 'utf-8');
      expect(backupContent).toBe(originalContent);
    });
  });
});
