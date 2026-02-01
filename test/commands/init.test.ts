import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit, createSpinnerMock } from '../utils/test-helpers.js';

// Create mock functions that will be set up per test
const mockGetStatus = vi.fn();
const mockInstall = vi.fn();
const mockUpdate = vi.fn();
const mockVerifyGlobalCommand = vi.fn();
const mockShellGetRcFile = vi.fn();
const mockShellBackup = vi.fn();
const mockShellApplyConfig = vi.fn();

// Mock all dependencies
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

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
    muted: vi.fn(),
    keyValue: vi.fn(),
    section: vi.fn(),
    list: vi.fn(),
    spinner: vi.fn(() => createSpinnerMock()),
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((schema, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    isInitialized: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    backup: vi.fn(),
    getConfigFile: vi.fn().mockReturnValue('/home/user/.config/neo/config.json'),
    getConfigDir: vi.fn().mockReturnValue('/home/user/.config/neo'),
  },
}));

vi.mock('@/utils/installer.js', () => ({
  GlobalInstaller: vi.fn().mockImplementation(function () {
    return {
      getStatus: mockGetStatus,
      install: mockInstall,
      update: mockUpdate,
      verifyGlobalCommand: mockVerifyGlobalCommand,
    };
  }),
}));

vi.mock('@/utils/shell.js', () => ({
  ZshIntegration: vi.fn().mockImplementation(function () {
    return {
      getRcFile: mockShellGetRcFile,
      backup: mockShellBackup,
      applyConfig: mockShellApplyConfig,
    };
  }),
}));

vi.mock('@/utils/completions.js', () => ({
  CompletionGenerator: {
    createCompletionFiles: vi.fn(),
  },
}));

import inquirer from 'inquirer';
import { configManager } from '@/utils/config.js';
import { CompletionGenerator } from '@/utils/completions.js';
import { ui } from '@/utils/ui.js';

describe('createInitCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Set up default mock return values
    mockGetStatus.mockResolvedValue({
      pnpmInstalled: true,
      pnpmVersion: '9.0.0',
      packageInstalled: false,
      globalPath: '/usr/local/lib/node_modules',
    });
    mockInstall.mockResolvedValue({ success: true, version: '1.0.0' });
    mockUpdate.mockResolvedValue({ success: true, version: '1.0.1' });
    mockVerifyGlobalCommand.mockResolvedValue(true);
    mockShellGetRcFile.mockReturnValue('/home/user/.zshrc');
    mockShellBackup.mockResolvedValue('/home/user/.zshrc.backup');
    mockShellApplyConfig.mockResolvedValue(undefined);

    vi.mocked(configManager.isInitialized).mockResolvedValue(false);
    vi.mocked(configManager.write).mockResolvedValue(undefined);
    vi.mocked(CompletionGenerator.createCompletionFiles).mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitMock.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('command structure', () => {
    it('should create init command with correct name', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      expect(command.name()).toBe('init');
    });

    it('should have description', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      expect(command.description()).toBe('Install and configure Neo CLI globally');
    });

    it('should have --force option', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();
      const helpText = command.helpInformation();

      expect(helpText).toContain('--force');
    });

    it('should have --skip-install option', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();
      const helpText = command.helpInformation();

      expect(helpText).toContain('--skip-install');
    });
  });

  describe('fresh initialization', () => {
    it('should install and configure when not initialized', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(configManager.isInitialized).toHaveBeenCalled();
      expect(mockInstall).toHaveBeenCalled();
      expect(configManager.write).toHaveBeenCalled();
      expect(mockShellApplyConfig).toHaveBeenCalled();
      expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('successfully initialized'));
    });

    it('should fail when pnpm is not installed', async () => {
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: false,
        pnpmVersion: null,
        packageInstalled: false,
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('pnpm'));
    });

    it('should handle install failure', async () => {
      mockInstall.mockResolvedValue({
        success: false,
        error: 'Installation failed',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Installation failed');
    });

    it('should skip install with --skip-install flag', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--skip-install'], { from: 'user' });

      expect(mockInstall).not.toHaveBeenCalled();
      expect(configManager.write).toHaveBeenCalled();
    });

    it('should warn when global command is not accessible', async () => {
      mockVerifyGlobalCommand.mockResolvedValue(false);

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('may not be accessible'));
    });
  });

  describe('already initialized', () => {
    beforeEach(() => {
      vi.mocked(configManager.isInitialized).mockResolvedValue(true);
      vi.mocked(configManager.read).mockResolvedValue({
        installation: { version: '0.9.0' },
      } as never);
    });

    it('should prompt when already initialized', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'cancel' });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(inquirer.prompt).toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith('Initialization cancelled');
    });

    it('should update configuration when selected', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'update' });
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: true,
        packageVersion: '0.9.0',
        globalPath: '/usr/local/lib/node_modules',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should handle update failure', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'update' });
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: true,
        packageVersion: '0.9.0',
      });
      mockUpdate.mockResolvedValue({
        success: false,
        error: 'Update failed',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Update failed');
    });

    it('should reset everything when selected', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: 'reset' });
      vi.mocked(configManager.backup).mockResolvedValue('/backup/config.json');

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(configManager.backup).toHaveBeenCalled();
      expect(mockShellBackup).toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('backed up'));
    });

    it('should skip prompt with --force flag', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });

  describe('configuration setup', () => {
    it('should create proper config structure', async () => {
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: false,
        packageVersion: '1.0.0',
        globalPath: '/usr/local/lib/node_modules',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      const writeCall = vi.mocked(configManager.write).mock.calls[0][0];
      expect(writeCall).toMatchObject({
        ai: { enabled: true },
        preferences: { banner: 'full', theme: 'auto' },
        shell: { type: 'zsh' },
      });
    });

    it('should create completion files', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(CompletionGenerator.createCompletionFiles).toHaveBeenCalled();
    });

    it('should apply shell configuration', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(mockShellApplyConfig).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle errors during initialization', async () => {
      mockInstall.mockRejectedValue(new Error('Unexpected error'));

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await expect(command.parseAsync([''], { from: 'user' })).rejects.toThrow('Unexpected error');
      expect(ui.error).toHaveBeenCalled();
    });
  });
});
