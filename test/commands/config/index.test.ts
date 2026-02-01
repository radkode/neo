import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConfigCommand } from '../../../src/commands/config/index.js';
import { mockProcessExit } from '../../utils/test-helpers.js';

// Mock all dependencies
vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    muted: vi.fn(),
    keyValue: vi.fn(),
    section: vi.fn(),
    divider: vi.fn(),
  },
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    read: vi.fn(),
    write: vi.fn(),
    getConfigFile: vi.fn().mockReturnValue('/home/user/.config/neo/config.json'),
  },
}));

vi.mock('@/utils/secrets.js', () => ({
  secretsManager: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    isConfigured: vi.fn(),
    getSecretsFile: vi.fn().mockReturnValue('/home/user/.config/neo/secrets.json'),
  },
  SecretsManager: {
    maskSecret: (s: string) => s.slice(0, 4) + '...',
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validateArgument: vi.fn((schema, value) => value),
  validateConfigValue: vi.fn((key, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/prompt.js', () => ({
  promptPassword: vi.fn(),
}));

vi.mock('@/commands/config/profile/index.js', async () => {
  const { Command } = await import('@commander-js/extra-typings');
  return {
    createProfileCommand: vi.fn().mockImplementation(() => {
      const cmd = new Command('profile');
      cmd.description('Manage profiles');
      return cmd;
    }),
  };
});

import { ui } from '@/utils/ui.js';
import { configManager } from '@/utils/config.js';
import { secretsManager } from '@/utils/secrets.js';
import { validateArgument } from '@/utils/validation.js';
import { promptPassword } from '@/utils/prompt.js';

describe('createConfigCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  describe('command structure', () => {
    it('should create config command with correct name', () => {
      const command = createConfigCommand();

      expect(command.name()).toBe('config');
    });

    it('should have description', () => {
      const command = createConfigCommand();

      expect(command.description()).toBe('Manage configuration');
    });

    it('should have get subcommand', () => {
      const command = createConfigCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('get');
    });

    it('should have set subcommand', () => {
      const command = createConfigCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('set');
    });

    it('should have list subcommand', () => {
      const command = createConfigCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('list');
    });

    it('should have profile subcommand', () => {
      const command = createConfigCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('profile');
    });
  });

  describe('config get', () => {
    it('should get regular config value', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);

      const command = createConfigCommand();
      await command.parseAsync(['get', 'preferences.banner'], { from: 'user' });

      expect(configManager.read).toHaveBeenCalled();
      expect(ui.keyValue).toHaveBeenCalledWith([['preferences.banner', 'full']]);
    });

    it('should get nested object value', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const command = createConfigCommand();
      await command.parseAsync(['get', 'preferences'], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith('preferences:');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should get secret key with masking', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue('sk-test-key-12345');

      const command = createConfigCommand();
      await command.parseAsync(['get', 'ai.apiKey'], { from: 'user' });

      expect(secretsManager.getSecret).toHaveBeenCalledWith('ai.apiKey');
      expect(ui.keyValue).toHaveBeenCalledWith([['ai.apiKey', 'sk-t... (configured)']]);
    });

    it('should show not configured for missing secret', async () => {
      vi.mocked(secretsManager.getSecret).mockResolvedValue(null);

      const command = createConfigCommand();
      await command.parseAsync(['get', 'ai.apiKey'], { from: 'user' });

      expect(ui.keyValue).toHaveBeenCalledWith([['ai.apiKey', 'not configured']]);
    });

    it('should error for non-existent key', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
        },
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);

      const command = createConfigCommand();
      await command.parseAsync(['get', 'nonexistent.key'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Configuration key not found: nonexistent.key');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle read error', async () => {
      vi.mocked(configManager.read).mockRejectedValue(new Error('Read failed'));

      const command = createConfigCommand();
      await command.parseAsync(['get', 'preferences.banner'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Failed to read configuration'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('config set', () => {
    it('should set regular config value', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      vi.mocked(configManager.write).mockResolvedValue(undefined);

      const command = createConfigCommand();
      await command.parseAsync(['set', 'preferences.banner', 'compact'], { from: 'user' });

      expect(configManager.write).toHaveBeenCalled();
      expect(ui.success).toHaveBeenCalledWith('Configuration updated: preferences.banner = compact');
    });

    it('should set secret key', async () => {
      vi.mocked(secretsManager.setSecret).mockResolvedValue(undefined);

      const command = createConfigCommand();
      await command.parseAsync(['set', 'ai.apiKey', 'sk-test-new-key'], { from: 'user' });

      expect(secretsManager.setSecret).toHaveBeenCalledWith('ai.apiKey', 'sk-test-new-key');
      expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('Secret updated'));
    });

    it('should prompt for secret when value not provided', async () => {
      vi.mocked(promptPassword).mockResolvedValue('sk-prompted-key');
      vi.mocked(secretsManager.setSecret).mockResolvedValue(undefined);

      const command = createConfigCommand();
      await command.parseAsync(['set', 'ai.apiKey'], { from: 'user' });

      expect(promptPassword).toHaveBeenCalledWith({ message: 'Enter API key' });
      expect(secretsManager.setSecret).toHaveBeenCalledWith('ai.apiKey', 'sk-prompted-key');
    });

    it('should error when secret is empty', async () => {
      vi.mocked(promptPassword).mockResolvedValue('');

      const command = createConfigCommand();
      await command.parseAsync(['set', 'ai.apiKey'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('API key cannot be empty');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should error when non-secret key has no value', async () => {
      const command = createConfigCommand();
      await command.parseAsync(['set', 'preferences.banner'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Value is required for non-secret configuration keys');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle write error', async () => {
      const mockConfig = { preferences: { banner: 'full', aliases: { n: true }, theme: 'auto' } };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      vi.mocked(configManager.write).mockRejectedValue(new Error('Write failed'));

      const command = createConfigCommand();
      await command.parseAsync(['set', 'preferences.banner', 'compact'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Failed to set configuration'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('config list', () => {
    it('should list all configuration', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
        shell: {
          type: 'zsh',
          rcFile: '/home/user/.zshrc',
        },
        installation: {
          version: '1.0.0',
          installedAt: '2024-01-01',
        },
        user: {},
        ai: {
          enabled: true,
        },
        updates: {},
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      vi.mocked(secretsManager.isConfigured).mockResolvedValue(true);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const command = createConfigCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(configManager.read).toHaveBeenCalled();
      expect(secretsManager.isConfigured).toHaveBeenCalledWith('ai.apiKey');
      expect(ui.info).toHaveBeenCalledWith('Current Neo CLI Configuration');
      expect(ui.section).toHaveBeenCalledWith('AI');
      expect(ui.section).toHaveBeenCalledWith('Preferences');
      expect(ui.section).toHaveBeenCalledWith('Shell');
      expect(ui.section).toHaveBeenCalledWith('Installation');

      consoleSpy.mockRestore();
    });

    it('should show active profile if set', async () => {
      const mockConfig = {
        activeProfile: 'work',
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
        shell: {
          type: 'zsh',
          rcFile: '/home/user/.zshrc',
        },
        installation: {
          version: '1.0.0',
          installedAt: '2024-01-01',
        },
        user: {},
        ai: {
          enabled: true,
        },
        updates: {},
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      vi.mocked(secretsManager.isConfigured).mockResolvedValue(false);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const command = createConfigCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ui.muted).toHaveBeenCalledWith('Active profile: work');

      consoleSpy.mockRestore();
    });

    it('should show user section if user info is set', async () => {
      const mockConfig = {
        preferences: {
          banner: 'full',
          theme: 'auto',
          aliases: { n: true },
        },
        shell: {
          type: 'zsh',
          rcFile: '/home/user/.zshrc',
        },
        installation: {
          version: '1.0.0',
          installedAt: '2024-01-01',
        },
        user: {
          name: 'Test User',
          email: 'test@example.com',
        },
        ai: {
          enabled: false,
        },
        updates: {},
      };
      vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
      vi.mocked(secretsManager.isConfigured).mockResolvedValue(false);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const command = createConfigCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ui.section).toHaveBeenCalledWith('User');

      consoleSpy.mockRestore();
    });

    it('should handle list error', async () => {
      vi.mocked(configManager.read).mockRejectedValue(new Error('Read failed'));

      const command = createConfigCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Failed to read configuration'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});

describe('getNestedValue helper', () => {
  // Test indirectly through config get command
  it('should handle deeply nested paths', async () => {
    const mockConfig = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    };
    vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);

    const command = createConfigCommand();
    await command.parseAsync(['get', 'level1.level2.level3.value'], { from: 'user' });

    expect(ui.keyValue).toHaveBeenCalledWith([['level1.level2.level3.value', 'deep']]);
  });

  it('should return undefined for invalid path', async () => {
    const mockConfig = {
      preferences: {
        banner: 'full',
      },
    };
    vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);

    const command = createConfigCommand();
    const exitMock = mockProcessExit();

    await command.parseAsync(['get', 'preferences.invalid.path'], { from: 'user' });

    expect(ui.error).toHaveBeenCalledWith('Configuration key not found: preferences.invalid.path');

    exitMock.mockRestore();
  });
});

describe('setNestedValue helper', () => {
  // Test indirectly through config set command
  it('should create intermediate objects', async () => {
    const mockConfig = {
      preferences: {
        banner: 'full',
        theme: 'auto',
        aliases: { n: true },
      },
    };
    vi.mocked(configManager.read).mockResolvedValue(mockConfig as never);
    vi.mocked(configManager.write).mockResolvedValue(undefined);

    const command = createConfigCommand();
    await command.parseAsync(['set', 'new.nested.key', 'value'], { from: 'user' });

    expect(configManager.write).toHaveBeenCalled();
    const writtenConfig = vi.mocked(configManager.write).mock.calls[0][0];
    expect((writtenConfig as { new: { nested: { key: string } } }).new.nested.key).toBe('value');
  });
});
