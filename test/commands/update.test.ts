import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit, createSpinnerMock, execaResult } from '../utils/test-helpers.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

// Mock all dependencies
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
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
    spinner: vi.fn(() => ({ ...createSpinnerMock(), warn: vi.fn() })),
    newline: vi.fn(),
    plain: vi.fn(),
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((_schema, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/update-check.js', () => ({
  fetchLatestCliVersion: vi.fn(),
  compareVersions: vi.fn(),
}));

import { execa } from 'execa';
import { confirm } from '@inquirer/prompts';
import { ui } from '@/utils/ui.js';
import { fetchLatestCliVersion, compareVersions } from '@/utils/update-check.js';

describe('createUpdateCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    setRuntimeContext(buildRuntimeContext());
  });

  afterEach(() => {
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
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

      await command.parseAsync([], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('Current version'));
    });

    it('should show update available when newer version exists', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(false);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(ui.keyValue).toHaveBeenCalled();
    });

    it('should not update when user cancels', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(false);

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

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

      await command.parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('npm registry'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('update execution', () => {
    it('should detect pnpm as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(execa)
        .mockResolvedValueOnce(execaResult({})) // ls pnpm-lock.yaml succeeds
        .mockResolvedValueOnce(execaResult({})); // pnpm add

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(execa).toHaveBeenCalledWith(
        'pnpm',
        expect.arrayContaining(['add', '-g']),
        expect.any(Object)
      );
    });

    it('should detect yarn as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found')) // ls pnpm-lock.yaml fails
        .mockResolvedValueOnce(execaResult({})) // ls yarn.lock succeeds
        .mockResolvedValueOnce(execaResult({})); // yarn global add

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(execa).toHaveBeenCalledWith(
        'yarn',
        expect.arrayContaining(['global', 'add']),
        expect.any(Object)
      );
    });

    it('should default to npm as package manager', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found')) // ls pnpm-lock.yaml fails
        .mockRejectedValueOnce(new Error('not found')) // ls yarn.lock fails
        .mockResolvedValueOnce(execaResult({})); // npm install

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(execa).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install', '-g']),
        expect.any(Object)
      );
    });

    it('should force reinstall with --force flag', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('1.0.0');
      vi.mocked(compareVersions).mockReturnValue(0);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(execaResult({}));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('--force'));
      expect(execa).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['--force']),
        expect.any(Object)
      );
    });

    it('should handle permission errors', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle generic update errors', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('Network timeout'));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

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
      expect(confirm).not.toHaveBeenCalled();
    });

    it('should exit 2 when a downgrade needs --force in non-interactive mode', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('0.9.0');
      vi.mocked(compareVersions).mockReturnValue(-1);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
      expect(exitMock).toHaveBeenNthCalledWith(1, 2);
      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining('requires explicit --force". Pass --force to bypass.')
      );
    });

    it('should exit 2 when a downgrade is requested with --yes but no --force', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('0.9.0');
      vi.mocked(compareVersions).mockReturnValue(-1);
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
      expect(exitMock).toHaveBeenNthCalledWith(1, 2);
    });

    it('should serialize the downgrade refusal with flag --force in json mode', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('0.9.0');
      vi.mocked(compareVersions).mockReturnValue(-1);
      setRuntimeContext(buildRuntimeContext({ json: true }));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const { createUpdateCommand } = await import('../../src/commands/update/index.js');
        const command = createUpdateCommand();

        await command.parseAsync([], { from: 'user' });

        expect(exitMock).toHaveBeenNthCalledWith(1, 2);
        expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
          error: {
            code: 'NEO_NON_INTERACTIVE',
            message: expect.stringContaining('Interactive prompt required in non-interactive mode'),
            flag: '--force',
            prompt: expect.stringContaining('to 0.9.0 requires explicit --force'),
          },
        });
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    });

    it('should downgrade without prompting when --force is passed in non-interactive mode', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('0.9.0');
      vi.mocked(compareVersions).mockReturnValue(-1);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(execaResult({}));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync(['--force'], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
      expect(execa).toHaveBeenCalledWith(
        'npm',
        ['install', '-g', '@radkode/neo@latest', '--force'],
        expect.any(Object)
      );
    });
  });

  describe('non-interactive update confirmation', () => {
    it('should exit 2 when an update needs --yes in non-interactive mode', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
      expect(exitMock).toHaveBeenNthCalledWith(1, 2);
      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining('Update to 2.0.0 requires confirmation". Pass --yes to bypass.')
      );
    });

    it('should serialize the confirmation refusal with flag --yes in json mode', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      setRuntimeContext(buildRuntimeContext({ json: true }));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const { createUpdateCommand } = await import('../../src/commands/update/index.js');
        const command = createUpdateCommand();

        await command.parseAsync([], { from: 'user' });

        expect(exitMock).toHaveBeenNthCalledWith(1, 2);
        expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
          error: {
            code: 'NEO_NON_INTERACTIVE',
            message: expect.stringContaining('Pass --yes to bypass.'),
            flag: '--yes',
            prompt: 'Update to 2.0.0 requires confirmation',
          },
        });
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    });

    it('should install without prompting when --yes wins over non-interactive', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true, yes: true }));
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(execaResult({}));

      const { createUpdateCommand } = await import('../../src/commands/update/index.js');
      const command = createUpdateCommand();

      await command.parseAsync([], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(exitMock).not.toHaveBeenCalled();
      expect(execa).toHaveBeenCalledWith(
        'npm',
        ['install', '-g', '@radkode/neo@latest'],
        expect.any(Object)
      );
    });
  });

  describe('structured error payloads', () => {
    it('should emit UPDATE_REGISTRY_UNREACHABLE when the registry lookup fails', async () => {
      vi.mocked(fetchLatestCliVersion).mockRejectedValue(new Error('Network error'));
      setRuntimeContext(buildRuntimeContext({ json: true }));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const { createUpdateCommand } = await import('../../src/commands/update/index.js');
        const command = createUpdateCommand();

        await command.parseAsync([], { from: 'user' });

        expect(exitMock).toHaveBeenCalledWith(1);
        expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
          error: {
            code: 'UPDATE_REGISTRY_UNREACHABLE',
            message: 'Could not connect to npm registry.',
            category: 'NETWORK',
            severity: 'medium',
            suggestions: ['Check your internet connection, then rerun `neo update`'],
          },
        });
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    });

    it('should emit UPDATE_PERMISSION_DENIED when the installer hits EACCES', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('EACCES: permission denied'));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const { createUpdateCommand } = await import('../../src/commands/update/index.js');
        const command = createUpdateCommand();

        await command.parseAsync([], { from: 'user' });

        expect(exitMock).toHaveBeenCalledWith(1);
        expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
          error: {
            code: 'UPDATE_PERMISSION_DENIED',
            message: 'Permission denied.',
            category: 'PERMISSION',
            severity: 'medium',
            suggestions: ['Try running with sudo: sudo npm install -g @radkode/neo@latest'],
            context: { packageManager: 'npm' },
          },
        });
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    });

    it('should emit UPDATE_INSTALL_FAILED when the installer fails for any other reason', async () => {
      vi.mocked(fetchLatestCliVersion).mockResolvedValue('2.0.0');
      vi.mocked(compareVersions).mockReturnValue(1);
      setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));
      vi.mocked(execa)
        .mockResolvedValueOnce(execaResult({})) // ls pnpm-lock.yaml succeeds
        .mockRejectedValueOnce(new Error('Network timeout'));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const { createUpdateCommand } = await import('../../src/commands/update/index.js');
        const command = createUpdateCommand();

        await command.parseAsync([], { from: 'user' });

        expect(exitMock).toHaveBeenCalledWith(1);
        expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
          error: {
            code: 'UPDATE_INSTALL_FAILED',
            message: 'Update failed: Network timeout',
            category: 'COMMAND',
            severity: 'medium',
            suggestions: ['Try updating manually: pnpm add -g @radkode/neo@latest'],
            context: { packageManager: 'pnpm' },
          },
        });
      } finally {
        stdoutWriteSpy.mockRestore();
      }
    });
  });
});
