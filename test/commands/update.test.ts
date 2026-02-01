import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit, createSpinnerMock } from '../utils/test-helpers.js';

// Mock all dependencies
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

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

vi.mock('@/utils/update-check.js', () => ({
  fetchLatestCliVersion: vi.fn(),
  compareVersions: vi.fn(),
}));

import { execa, type ExecaReturnValue } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { fetchLatestCliVersion, compareVersions } from '@/utils/update-check.js';

describe('createUpdateCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  describe('command structure', () => {
    it('should create update command with correct name', async () => {
      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      expect(command.name()).toBe('update');
    });

    it('should have description', async () => {
      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      expect(command.description()).toBe('Update Neo CLI to the latest version');
    });

    it('should have --check-only option', async () => {
      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();
      const helpText = command.helpInformation();

      expect(helpText).toContain('--check-only');
    });

    it('should have --force option', async () => {
      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();
      const helpText = command.helpInformation();

      expect(helpText).toContain('--force');
    });
  });

  describe('update check', () => {
    it('should show message when already on latest version', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('1.0.0');
      vi.mocked(compareVersions).mockReturnValue(0);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('Current version'));
    });

    it('should show update available when newer version exists', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.keyValue).toHaveBeenCalled();
    });

    it('should not update when user cancels', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.muted).toHaveBeenCalledWith('Update cancelled');
    });

    it('should only check without updating with --check-only', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync(['--check-only'], { from: 'user' });

      expect(ui.muted).toHaveBeenCalledWith(expect.stringContaining('Run neo update'));
      expect(execa).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['add']));
    });

    it('should handle network error gracefully', async () => {
      vi.mocked(fetchLatestCliVersion).mockRejectedValue(new Error('Network error'));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('npm registry'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('update execution', () => {
    it('should detect pnpm as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(execa)
        .mockResolvedValueOnce({} as ExecaReturnValue<string>) // ls pnpm-lock.yaml succeeds
        .mockResolvedValueOnce({} as ExecaReturnValue<string>); // pnpm add

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(execa).toHaveBeenCalledWith('pnpm', expect.arrayContaining(['add', '-g']), expect.any(Object));
    });

    it('should detect yarn as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found')) // ls pnpm-lock.yaml fails
        .mockResolvedValueOnce({} as ExecaReturnValue<string>) // ls yarn.lock succeeds
        .mockResolvedValueOnce({} as ExecaReturnValue<string>); // yarn global add

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(execa).toHaveBeenCalledWith('yarn', expect.arrayContaining(['global', 'add']), expect.any(Object));
    });

    it('should default to npm as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found')) // ls pnpm-lock.yaml fails
        .mockRejectedValueOnce(new Error('not found')) // ls yarn.lock fails
        .mockResolvedValueOnce({} as ExecaReturnValue<string>); // npm install

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(execa).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '-g']), expect.any(Object));
    });

    it('should force reinstall with --force flag', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('1.0.0');
      vi.mocked(compareVersions).mockReturnValue(0);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce({} as ExecaReturnValue<string>);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('--force'));
      expect(execa).toHaveBeenCalledWith('npm', expect.arrayContaining(['--force']), expect.any(Object));
    });

    it('should handle permission errors', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle generic update errors', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('Network timeout'));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([''], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Update failed'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('downgrade handling', () => {
    it('should handle being on newer version with check-only', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('0.9.0');
      vi.mocked(compareVersions).mockReturnValue(-1);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync(['--check-only'], { from: 'user' });

      // With check-only, no prompts should happen when on newer version
      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });
});
