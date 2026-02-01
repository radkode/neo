import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompletionGenerator } from '../../src/utils/completions.js';

// Mock dependencies
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { writeFile, mkdir } from 'fs/promises';
import { logger } from '@/utils/logger.js';

describe('CompletionGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateZshCompletions', () => {
    it('should generate a zsh completion script', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain('#compdef neo n');
      expect(result).toContain('_neo_commands()');
      expect(result).toContain('_neo()');
    });

    it('should include all main commands', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain("'init:Install and configure Neo CLI globally'");
      expect(result).toContain("'config:Manage configuration'");
      expect(result).toContain("'git:Git operations and utilities'");
      expect(result).toContain("'help:Display help for command'");
    });

    it('should include config subcommands', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain("'get:Get a configuration value'");
      expect(result).toContain("'set:Set a configuration value'");
      expect(result).toContain("'list:List all configuration values'");
    });

    it('should include git subcommands', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain("'push:Push commits to remote repository'");
    });

    it('should include global options', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain('--verbose[Enable verbose logging]');
      expect(result).toContain('--config=[Path to config file]');
      expect(result).toContain('--no-color[Disable colored output]');
      expect(result).toContain('--no-banner[Hide banner]');
      expect(result).toContain('--help[Show help]');
      expect(result).toContain('--version[Show version]');
    });

    it('should include init command options', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain('--force[Force reconfiguration if already initialized]');
      expect(result).toContain('--skip-install[Skip global installation]');
    });

    it('should include alias completion', () => {
      const result = CompletionGenerator.generateZshCompletions();

      expect(result).toContain('compdef _neo n');
    });
  });

  describe('createCompletionFiles', () => {
    it('should create completions directory', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(mkdir).toHaveBeenCalledWith('/test/completions', { recursive: true });
    });

    it('should write main completion file', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/_neo',
        expect.stringContaining('#compdef neo n'),
        'utf-8'
      );
    });

    it('should write alias completion file', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/_n',
        expect.stringContaining('compdef neo n'),
        'utf-8'
      );
    });

    it('should log debug messages on success', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Created completion file')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Created alias completion file')
      );
    });

    it('should throw on mkdir error', async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error('Permission denied'));

      await expect(
        CompletionGenerator.createCompletionFiles('/test/completions')
      ).rejects.toThrow('Permission denied');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create completion files')
      );
    });

    it('should throw on writeFile error', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await expect(
        CompletionGenerator.createCompletionFiles('/test/completions')
      ).rejects.toThrow('Write failed');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create completion files')
      );
    });
  });

  describe('updateCompletions', () => {
    it('should call createCompletionFiles', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.updateCompletions('/test/completions');

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });
  });
});
