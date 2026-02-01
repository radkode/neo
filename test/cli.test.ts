import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';

// Mock dependencies before importing
vi.mock('@/utils/banner.js', () => ({
  displayBanner: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setVerbose: vi.fn(),
  },
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    read: vi.fn().mockResolvedValue({
      preferences: { banner: 'full' },
      plugins: { enabled: false, disabled: [] },
    }),
  },
}));

vi.mock('@/utils/update-check.js', () => ({
  notifyIfCliUpdateAvailable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/plugins/index.js', () => ({
  pluginRegistry: {
    loadPlugins: vi.fn(),
    executeBeforeCommand: vi.fn(),
    executeAfterCommand: vi.fn(),
    executeOnExit: vi.fn(),
    disposeAll: vi.fn(),
    size: 0,
  },
  commandRegistry: {
    getAll: vi.fn().mockReturnValue([]),
  },
}));

import { createCLI } from '../src/cli.js';
import { displayBanner } from '@/utils/banner.js';
import { logger } from '@/utils/logger.js';
import { configManager } from '@/utils/config.js';
import { notifyIfCliUpdateAvailable } from '@/utils/update-check.js';
import { pluginRegistry, commandRegistry } from '@/core/plugins/index.js';

describe('CLI', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock implementations
    vi.mocked(configManager.read).mockResolvedValue({
      preferences: { banner: 'full', theme: 'auto' },
      plugins: { enabled: false, disabled: [] },
    } as never);
    vi.mocked(commandRegistry.getAll).mockReturnValue([]);
    program = await createCLI();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('program configuration', () => {
    it('should have the correct name', () => {
      expect(program.name()).toBe('neo');
    });

    it('should have a version', () => {
      expect(program.version()).toBeDefined();
    });

    it('should have description from package.json', () => {
      expect(program.description()).toBeDefined();
    });
  });

  describe('global options', () => {
    it('should have verbose option', () => {
      const options = program.options;
      const verboseOption = options.find((opt) => opt.long === '--verbose');
      expect(verboseOption).toBeDefined();
    });

    it('should have config option', () => {
      const options = program.options;
      const configOption = options.find((opt) => opt.long === '--config');
      expect(configOption).toBeDefined();
    });

    it('should have no-color option', () => {
      const options = program.options;
      const noColorOption = options.find((opt) => opt.long === '--no-color');
      expect(noColorOption).toBeDefined();
    });

    it('should have no-banner option', () => {
      const options = program.options;
      const noBannerOption = options.find((opt) => opt.long === '--no-banner');
      expect(noBannerOption).toBeDefined();
    });
  });

  describe('registered commands', () => {
    it('should have init command', () => {
      const commands = program.commands;
      const initCommand = commands.find((cmd) => cmd.name() === 'init');
      expect(initCommand).toBeDefined();
    });

    it('should have config command', () => {
      const commands = program.commands;
      const configCommand = commands.find((cmd) => cmd.name() === 'config');
      expect(configCommand).toBeDefined();
    });

    it('should have git command', () => {
      const commands = program.commands;
      const gitCommand = commands.find((cmd) => cmd.name() === 'git');
      expect(gitCommand).toBeDefined();
    });

    it('should have update command', () => {
      const commands = program.commands;
      const updateCommand = commands.find((cmd) => cmd.name() === 'update');
      expect(updateCommand).toBeDefined();
    });

    it('should have agent command', () => {
      const commands = program.commands;
      const agentCommand = commands.find((cmd) => cmd.name() === 'agent');
      expect(agentCommand).toBeDefined();
    });
  });

  describe('plugin loading', () => {
    it('should not load plugins when disabled in config', async () => {
      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: false, disabled: [] },
      } as never);

      await createCLI();

      expect(pluginRegistry.loadPlugins).not.toHaveBeenCalled();
    });

    it('should load plugins when enabled in config', async () => {
      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: true, disabled: ['disabled-plugin'] },
      } as never);

      await createCLI();

      expect(pluginRegistry.loadPlugins).toHaveBeenCalledWith(['disabled-plugin']);
    });

    it('should handle plugin loading errors gracefully', async () => {
      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: true, disabled: [] },
      } as never);
      vi.mocked(pluginRegistry.loadPlugins).mockRejectedValueOnce(new Error('Plugin error'));

      // Should not throw
      const cli = await createCLI();
      expect(cli).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Plugin loading failed'));
    });

    it('should register plugin commands', async () => {
      const mockCommand = {
        name: 'test-cmd',
        description: 'Test command',
        options: [{ flags: '-t, --test', description: 'Test option', required: false }],
        arguments: [{ name: 'arg1', description: 'Test arg', required: true }],
        execute: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: true, disabled: [] },
      } as never);
      vi.mocked(commandRegistry.getAll).mockReturnValue([mockCommand]);

      const cli = await createCLI();
      const registeredCmd = cli.commands.find((cmd) => cmd.name() === 'test-cmd');
      expect(registeredCmd).toBeDefined();
      expect(registeredCmd?.description()).toBe('Test command');
    });

    it('should register plugin commands with required options', async () => {
      const mockCommand = {
        name: 'required-opt-cmd',
        description: 'Command with required option',
        options: [{ flags: '-r, --required <value>', description: 'Required option', required: true }],
        execute: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: true, disabled: [] },
      } as never);
      vi.mocked(commandRegistry.getAll).mockReturnValue([mockCommand]);

      const cli = await createCLI();
      const registeredCmd = cli.commands.find((cmd) => cmd.name() === 'required-opt-cmd');
      expect(registeredCmd).toBeDefined();
    });

    it('should register plugin commands with optional arguments', async () => {
      const mockCommand = {
        name: 'opt-arg-cmd',
        description: 'Command with optional argument',
        arguments: [{ name: 'optArg', description: 'Optional arg', required: false }],
        execute: vi.fn().mockResolvedValue({ success: true }),
      };

      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
        plugins: { enabled: true, disabled: [] },
      } as never);
      vi.mocked(commandRegistry.getAll).mockReturnValue([mockCommand]);

      const cli = await createCLI();
      const registeredCmd = cli.commands.find((cmd) => cmd.name() === 'opt-arg-cmd');
      expect(registeredCmd).toBeDefined();
    });
  });

  describe('config reading', () => {
    it('should read config for banner preference', async () => {
      await createCLI();
      expect(configManager.read).toHaveBeenCalled();
    });

    it('should handle missing plugins config', async () => {
      vi.mocked(configManager.read).mockResolvedValue({
        preferences: { banner: 'full', theme: 'auto' },
      } as never);

      const cli = await createCLI();
      expect(cli).toBeDefined();
    });
  });
});
