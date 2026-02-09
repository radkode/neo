import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { createCompletionsCommand } from '../../../src/commands/completions/index.js';

// Mock dependencies
vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    spinner: vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    getConfigDir: vi.fn().mockReturnValue('/home/user/.config/neo'),
    read: vi.fn(),
  },
}));

vi.mock('@/utils/completions.js', () => ({
  CompletionGenerator: {
    generateCompletions: vi.fn().mockReturnValue('# mock completions'),
    createCompletionFiles: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/utils/shell.js', () => ({
  ZshIntegration: vi.fn().mockImplementation(() => ({
    addCompletions: vi.fn().mockResolvedValue(undefined),
  })),
  BashIntegration: vi.fn().mockImplementation(() => ({
    addCompletions: vi.fn().mockResolvedValue(undefined),
  })),
  FishIntegration: vi.fn().mockImplementation(() => ({
    addCompletions: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { CompletionGenerator } from '@/utils/completions.js';

describe('createCompletionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a command named completions', () => {
    const cmd = createCompletionsCommand();
    expect(cmd.name()).toBe('completions');
  });

  it('should have a description', () => {
    const cmd = createCompletionsCommand();
    expect(cmd.description()).toContain('completions');
  });

  it('should accept an optional shell argument', () => {
    const cmd = createCompletionsCommand();
    // The command accepts [shell] as an optional argument
    const args = (cmd as unknown as { registeredArguments: Array<{ _name: string; required: boolean }> }).registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!._name).toBe('shell');
    expect(args[0]!.required).toBe(false);
  });

  it('should have an install subcommand', () => {
    const cmd = createCompletionsCommand();
    const installCmd = cmd.commands.find((c) => c.name() === 'install');
    expect(installCmd).toBeDefined();
    expect(installCmd!.description()).toContain('Install');
  });

  it('should call generateCompletions when invoked with a shell argument', async () => {
    const program = new Command();
    program.name('neo').description('test');
    const cmd = createCompletionsCommand();
    program.addCommand(cmd);

    // Capture stdout
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'neo', 'completions', 'zsh']);

    expect(CompletionGenerator.generateCompletions).toHaveBeenCalledWith(
      expect.any(Object),
      'zsh'
    );
    expect(writeSpy).toHaveBeenCalledWith('# mock completions');

    writeSpy.mockRestore();
  });

  it('should call generateCompletions for bash', async () => {
    const program = new Command();
    program.name('neo').description('test');
    const cmd = createCompletionsCommand();
    program.addCommand(cmd);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'neo', 'completions', 'bash']);

    expect(CompletionGenerator.generateCompletions).toHaveBeenCalledWith(
      expect.any(Object),
      'bash'
    );

    writeSpy.mockRestore();
  });

  it('should call generateCompletions for fish', async () => {
    const program = new Command();
    program.name('neo').description('test');
    const cmd = createCompletionsCommand();
    program.addCommand(cmd);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'neo', 'completions', 'fish']);

    expect(CompletionGenerator.generateCompletions).toHaveBeenCalledWith(
      expect.any(Object),
      'fish'
    );

    writeSpy.mockRestore();
  });
});
