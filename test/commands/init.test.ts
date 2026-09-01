import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit, createSpinnerMock, type SpinnerMock } from '../utils/test-helpers.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

// The init spinners call warn(), which the shared spinner mock does not provide.
type InitSpinner = SpinnerMock & { warn: ReturnType<typeof vi.fn> };

function createInitSpinner(): InitSpinner {
  return { ...createSpinnerMock(), warn: vi.fn() };
}

// Create mock functions that will be set up per test
const mockGetStatus = vi.fn();
const mockInstall = vi.fn();
const mockUpdate = vi.fn();
const mockVerifyGlobalCommand = vi.fn();
const mockShellGetRcFile = vi.fn();
const mockShellBackup = vi.fn();
const mockShellApplyConfig = vi.fn();

// Mock all dependencies
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
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
    spinner: vi.fn(() => createInitSpinner()),
    newline: vi.fn(),
    plain: vi.fn(),
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((_schema, value) => value),
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

vi.mock('@/utils/skill-installer.js', () => ({
  installClaudeSkill: vi.fn().mockResolvedValue(null),
}));

import { select } from '@inquirer/prompts';
import { configManager } from '@/utils/config.js';
import { CompletionGenerator } from '@/utils/completions.js';
import { installClaudeSkill } from '@/utils/skill-installer.js';
import { ui } from '@/utils/ui.js';

const SKILL_SPINNER = 'Installing Claude Code skill';
const SKILL_PATHS = {
  source: '/pkg/templates/skills/neo/SKILL.md',
  destination: '/home/user/.claude/skills/neo/SKILL.md',
};

function spinnerFor(label: string): InitSpinner {
  const spinner = vi.mocked(ui.spinner);
  const index = spinner.mock.calls.findIndex((call) => call[0] === label);
  expect(index, `no spinner was created with label "${label}"`).toBeGreaterThan(-1);
  return spinner.mock.results[index].value as unknown as InitSpinner;
}

function spinnerLabels(): string[] {
  return vi.mocked(ui.spinner).mock.calls.map((call) => call[0]);
}

describe('createInitCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setRuntimeContext(buildRuntimeContext());

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
    vi.mocked(installClaudeSkill).mockResolvedValue(null);
  });

  afterEach(() => {
    exitMock.mockRestore();
    consoleLogSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
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

    it('should have --no-skill option', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();
      const helpText = command.helpInformation();

      expect(helpText).toContain('--no-skill');
      expect(helpText).toContain('skip installing the bundled Claude Code skill');
    });
  });

  describe('fresh initialization', () => {
    it('should install and configure when not initialized', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

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

      await command.parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('pnpm'));
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(configManager.write).not.toHaveBeenCalled();
    });

    it('should handle install failure', async () => {
      mockInstall.mockResolvedValue({
        success: false,
        error: 'Installation failed',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Installation failed');
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(configManager.write).not.toHaveBeenCalled();
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

      await command.parseAsync([], { from: 'user' });

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
      vi.mocked(select).mockResolvedValueOnce('cancel');

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(select).toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith('Initialization cancelled');
    });

    it('should update configuration when selected', async () => {
      vi.mocked(select).mockResolvedValueOnce('update');
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: true,
        packageVersion: '0.9.0',
        globalPath: '/usr/local/lib/node_modules',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should handle update failure', async () => {
      vi.mocked(select).mockResolvedValueOnce('update');
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

      await command.parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Update failed');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should reset everything when selected', async () => {
      vi.mocked(select).mockResolvedValueOnce('reset');
      vi.mocked(configManager.backup).mockResolvedValue('/backup/config.json');

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(configManager.backup).toHaveBeenCalled();
      expect(mockShellBackup).toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('backed up'));
    });

    it('should skip prompt with --force flag', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(select).not.toHaveBeenCalled();
    });

    it('should exit 2 without prompting in non-interactive mode', async () => {
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(select).not.toHaveBeenCalled();
      expect(exitMock.mock.calls[0][0]).toBe(2);
      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining('Neo is already initialized; pass --force to reset')
      );
      expect(mockInstall).not.toHaveBeenCalled();
      expect(configManager.write).not.toHaveBeenCalled();
    });

    it('should update without prompting when --yes is active', async () => {
      setRuntimeContext(buildRuntimeContext({ yes: true }));
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: true,
        packageVersion: '0.9.0',
        globalPath: '/usr/local/lib/node_modules',
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(select).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect(configManager.write).toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('should accept --force in non-interactive mode instead of exiting 2', async () => {
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(select).not.toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
      expect(configManager.write).toHaveBeenCalled();
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

      await command.parseAsync([], { from: 'user' });

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

      await command.parseAsync([], { from: 'user' });

      expect(CompletionGenerator.createCompletionFiles).toHaveBeenCalled();
    });

    it('should apply shell configuration', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(mockShellApplyConfig).toHaveBeenCalled();
    });
  });

  describe('claude skill install', () => {
    it('should skip the skill install with --no-skill', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--no-skill'], { from: 'user' });

      expect(installClaudeSkill).not.toHaveBeenCalled();
      expect(spinnerLabels()).not.toContain(SKILL_SPINNER);
      expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('successfully initialized'));
    });

    it('should stop the spinner silently when Claude Code is not detected', async () => {
      vi.mocked(installClaudeSkill).mockResolvedValueOnce(null);

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(installClaudeSkill).toHaveBeenCalledWith({});
      const spinner = spinnerFor(SKILL_SPINNER);
      expect(spinner.stop).toHaveBeenCalled();
      expect(spinner.succeed).not.toHaveBeenCalled();
      expect(spinner.warn).not.toHaveBeenCalled();
      expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('should report the destination when the skill is installed', async () => {
      vi.mocked(installClaudeSkill).mockResolvedValueOnce({ status: 'installed', ...SKILL_PATHS });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(spinnerFor(SKILL_SPINNER).succeed).toHaveBeenCalledWith(
        `Claude Code skill installed at ${SKILL_PATHS.destination}`
      );
    });

    it('should report the destination when the skill is updated', async () => {
      vi.mocked(installClaudeSkill).mockResolvedValueOnce({ status: 'updated', ...SKILL_PATHS });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(spinnerFor(SKILL_SPINNER).succeed).toHaveBeenCalledWith(
        `Claude Code skill updated at ${SKILL_PATHS.destination}`
      );
    });

    it('should report an unchanged skill as already up to date', async () => {
      vi.mocked(installClaudeSkill).mockResolvedValueOnce({ status: 'unchanged', ...SKILL_PATHS });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(spinnerFor(SKILL_SPINNER).succeed).toHaveBeenCalledWith(
        'Claude Code skill already up to date'
      );
    });

    it('should warn rather than overwrite a divergent skill', async () => {
      vi.mocked(installClaudeSkill).mockResolvedValueOnce({
        status: 'skipped-divergent',
        ...SKILL_PATHS,
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      const spinner = spinnerFor(SKILL_SPINNER);
      expect(spinner.warn).toHaveBeenCalledWith(
        `Claude Code skill at ${SKILL_PATHS.destination} differs from bundled copy; pass --force to overwrite`
      );
      expect(spinner.succeed).not.toHaveBeenCalled();
    });

    it('should forward --force to the skill installer', async () => {
      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(installClaudeSkill).toHaveBeenCalledWith({ force: true });
    });

    it('should finish initialization when the skill install throws', async () => {
      vi.mocked(installClaudeSkill).mockRejectedValueOnce(new Error('disk full'));

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(spinnerFor(SKILL_SPINNER).fail).toHaveBeenCalledWith(
        'Failed to install Claude Code skill'
      );
      expect(ui.warn).toHaveBeenCalledWith('Skill install error: disk full');
      expect(ui.success).toHaveBeenCalledWith('Neo CLI has been successfully initialized!');
      expect(exitMock).not.toHaveBeenCalled();
    });
  });

  describe('installer failures', () => {
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

    const errorPayload = () => JSON.parse(String(stdoutWriteSpy.mock.calls[0][0]));

    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutWriteSpy.mockRestore();
    });

    it('should emit INIT_PNPM_MISSING and exit 1 when pnpm is absent', async () => {
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: false,
        pnpmVersion: null,
        packageInstalled: false,
      });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(errorPayload()).toMatchObject({
        error: {
          code: 'INIT_PNPM_MISSING',
          category: 'CONFIGURATION',
          message: 'pnpm is not installed',
          suggestions: expect.arrayContaining([
            'Or configure without installing: neo init --skip-install',
          ]),
        },
      });
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should emit INIT_INSTALL_FAILED and exit 1 when the global install fails', async () => {
      mockInstall.mockResolvedValue({ success: false, error: 'Installation failed' });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(errorPayload()).toMatchObject({
        error: {
          code: 'INIT_INSTALL_FAILED',
          category: 'COMMAND',
          message: 'Installation failed',
        },
      });
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(configManager.write).not.toHaveBeenCalled();
    });

    it('should emit INIT_UPDATE_FAILED and exit 1 when the global update fails', async () => {
      mockGetStatus.mockResolvedValue({
        pnpmInstalled: true,
        pnpmVersion: '9.0.0',
        packageInstalled: true,
        packageVersion: '0.9.0',
      });
      mockUpdate.mockResolvedValue({ success: false, error: 'Update failed' });

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      await command.parseAsync([], { from: 'user' });

      expect(errorPayload()).toMatchObject({
        error: {
          code: 'INIT_UPDATE_FAILED',
          category: 'COMMAND',
          message: 'Update failed',
        },
      });
      expect(exitMock).toHaveBeenCalledWith(1);
      expect(mockInstall).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle errors during initialization', async () => {
      mockInstall.mockRejectedValue(new Error('Unexpected error'));

      const { createInitCommand } = await import('../../src/commands/init/index.js');
      const command = createInitCommand();

      // runAction wraps the handler: it catches errors, emits them, and calls
      // process.exit(1) rather than rethrowing. Verify those contract guarantees
      // instead of a rejection.
      await command.parseAsync([], { from: 'user' });
      expect(ui.error).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});
