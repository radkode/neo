import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';

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
    }),
  },
}));

vi.mock('@/utils/update-check.js', () => ({
  notifyIfCliUpdateAvailable: vi.fn().mockResolvedValue(undefined),
}));

import { createCLI } from '../src/cli.js';
import { configManager } from '@/utils/config.js';

describe('CLI', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(configManager.read).mockResolvedValue({
      preferences: { banner: 'full', theme: 'auto' },
    } as never);
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

});
