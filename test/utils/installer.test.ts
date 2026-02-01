import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { GlobalInstaller, type InstallationResult } from '../../src/utils/installer.js';

// Mock dependencies
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('which', () => ({
  default: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import mocked modules
import { execa } from 'execa';
import which from 'which';

describe('GlobalInstaller', () => {
  let installer: GlobalInstaller;
  const execaMock = execa as unknown as Mock;
  const whichMock = which as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    installer = new GlobalInstaller('@radkode/neo');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should use default package name', () => {
      const defaultInstaller = new GlobalInstaller();
      // Package name is private, but we can verify behavior through other methods
      expect(defaultInstaller).toBeInstanceOf(GlobalInstaller);
    });

    it('should accept custom package name', () => {
      const customInstaller = new GlobalInstaller('my-package');
      expect(customInstaller).toBeInstanceOf(GlobalInstaller);
    });
  });

  describe('checkPnpm', () => {
    it('should return true when pnpm is available', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      const result = await installer.checkPnpm();

      expect(result).toBe(true);
      expect(whichMock).toHaveBeenCalledWith('pnpm');
    });

    it('should return false when pnpm is not available', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      const result = await installer.checkPnpm();

      expect(result).toBe(false);
    });
  });

  describe('getPnpmVersion', () => {
    it('should return pnpm version', async () => {
      execaMock.mockResolvedValue({ stdout: '9.0.0\n', stderr: '' });

      const result = await installer.getPnpmVersion();

      expect(result).toBe('9.0.0');
      expect(execaMock).toHaveBeenCalledWith('pnpm', ['--version']);
    });

    it('should return null on error', async () => {
      execaMock.mockRejectedValue(new Error('command failed'));

      const result = await installer.getPnpmVersion();

      expect(result).toBeNull();
    });
  });

  describe('isInstalledGlobally', () => {
    it('should return true when package is installed', async () => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify([{
          dependencies: {
            '@radkode/neo': { version: '1.0.0' },
          },
        }]),
        stderr: '',
      });

      const result = await installer.isInstalledGlobally();

      expect(result).toBe(true);
      expect(execaMock).toHaveBeenCalledWith('pnpm', ['list', '-g', '--depth=0', '--json']);
    });

    it('should return false when package is not installed', async () => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify([{ dependencies: {} }]),
        stderr: '',
      });

      const result = await installer.isInstalledGlobally();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      execaMock.mockRejectedValue(new Error('command failed'));

      const result = await installer.isInstalledGlobally();

      expect(result).toBe(false);
    });

    it('should handle missing dependencies object', async () => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify([{}]),
        stderr: '',
      });

      const result = await installer.isInstalledGlobally();

      expect(result).toBe(false);
    });
  });

  describe('getGlobalPath', () => {
    it('should return global path', async () => {
      execaMock.mockResolvedValue({
        stdout: '/usr/local/lib/node_modules\n',
        stderr: '',
      });

      const result = await installer.getGlobalPath();

      expect(result).toBe('/usr/local/lib/node_modules');
      expect(execaMock).toHaveBeenCalledWith('pnpm', ['root', '-g']);
    });

    it('should return null on error', async () => {
      execaMock.mockRejectedValue(new Error('command failed'));

      const result = await installer.getGlobalPath();

      expect(result).toBeNull();
    });
  });

  describe('getInstalledVersion', () => {
    it('should return installed version', async () => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify([{
          dependencies: {
            '@radkode/neo': { version: '1.2.3' },
          },
        }]),
        stderr: '',
      });

      const result = await installer.getInstalledVersion();

      expect(result).toBe('1.2.3');
    });

    it('should return null when package not found', async () => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify([{ dependencies: {} }]),
        stderr: '',
      });

      const result = await installer.getInstalledVersion();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      execaMock.mockRejectedValue(new Error('command failed'));

      const result = await installer.getInstalledVersion();

      expect(result).toBeNull();
    });
  });

  describe('install', () => {
    it('should return error when pnpm is not available', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('pnpm is not installed');
    });

    it('should install successfully', async () => {
      // pnpm check
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // Install command
      execaMock.mockResolvedValueOnce({ stdout: 'installed', stderr: '' });

      // isInstalledGlobally check
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '1.0.0' } },
        }]),
        stderr: '',
      });

      // getInstalledVersion
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '1.0.0' } },
        }]),
        stderr: '',
      });

      // getGlobalPath
      execaMock.mockResolvedValueOnce({
        stdout: '/usr/local/lib/node_modules',
        stderr: '',
      });

      const result = await installer.install();

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.globalPath).toBe('/usr/local/lib/node_modules');
    });

    it('should handle verification failure', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // Install command succeeds
      execaMock.mockResolvedValueOnce({ stdout: 'installed', stderr: '' });

      // But verification fails - package not in list
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{ dependencies: {} }]),
        stderr: '',
      });

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('verification failed');
    });

    it('should handle EACCES permission error', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      const permError = new Error('EACCES: permission denied');
      execaMock.mockRejectedValueOnce(permError);

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should handle ENOTFOUND network error', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      const networkError = new Error('ENOTFOUND registry.npmjs.org');
      execaMock.mockRejectedValueOnce(networkError);

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle generic error', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      execaMock.mockRejectedValueOnce(new Error('Something went wrong'));

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Installation failed');
    });

    it('should handle non-Error thrown values', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      execaMock.mockRejectedValueOnce('string error');

      const result = await installer.install();

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });

  describe('uninstall', () => {
    it('should return error when pnpm is not available', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      const result = await installer.uninstall();

      expect(result.success).toBe(false);
      expect(result.error).toBe('pnpm is not installed');
    });

    it('should uninstall successfully', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // Uninstall command
      execaMock.mockResolvedValueOnce({ stdout: 'removed', stderr: '' });

      // Verification - package no longer in list
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{ dependencies: {} }]),
        stderr: '',
      });

      const result = await installer.uninstall();

      expect(result.success).toBe(true);
      expect(execaMock).toHaveBeenCalledWith('pnpm', ['remove', '-g', '@radkode/neo']);
    });

    it('should handle uninstall verification failure', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // Uninstall command
      execaMock.mockResolvedValueOnce({ stdout: 'removed', stderr: '' });

      // But package still exists
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '1.0.0' } },
        }]),
        stderr: '',
      });

      const result = await installer.uninstall();

      expect(result.success).toBe(false);
      expect(result.error).toContain('still present');
    });

    it('should handle uninstall error', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      execaMock.mockRejectedValueOnce(new Error('uninstall failed'));

      const result = await installer.uninstall();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Uninstallation failed');
    });
  });

  describe('update', () => {
    it('should return error when pnpm is not available', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      const result = await installer.update();

      expect(result.success).toBe(false);
      expect(result.error).toBe('pnpm is not installed');
    });

    it('should update successfully', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // Update command
      execaMock.mockResolvedValueOnce({ stdout: 'updated', stderr: '' });

      // getInstalledVersion
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '2.0.0' } },
        }]),
        stderr: '',
      });

      // getGlobalPath
      execaMock.mockResolvedValueOnce({
        stdout: '/usr/local/lib/node_modules',
        stderr: '',
      });

      const result = await installer.update();

      expect(result.success).toBe(true);
      expect(result.version).toBe('2.0.0');
      expect(execaMock).toHaveBeenCalledWith('pnpm', ['update', '-g', '@radkode/neo']);
    });

    it('should handle update error', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      execaMock.mockRejectedValueOnce(new Error('update failed'));

      const result = await installer.update();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });
  });

  describe('verifyGlobalCommand', () => {
    it('should return true when command is accessible', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/neo');
      execaMock.mockResolvedValue({ stdout: 'neo 1.0.0', stderr: '' });

      const result = await installer.verifyGlobalCommand();

      expect(result).toBe(true);
      expect(whichMock).toHaveBeenCalledWith('neo');
      expect(execaMock).toHaveBeenCalledWith('neo', ['--version']);
    });

    it('should return false when command is not found', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      const result = await installer.verifyGlobalCommand();

      expect(result).toBe(false);
    });

    it('should return false when command fails to run', async () => {
      whichMock.mockResolvedValue('/usr/local/bin/neo');
      execaMock.mockRejectedValue(new Error('command failed'));

      const result = await installer.verifyGlobalCommand();

      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return comprehensive status when everything is installed', async () => {
      // checkPnpm
      whichMock.mockResolvedValue('/usr/local/bin/pnpm');

      // getPnpmVersion
      execaMock.mockResolvedValueOnce({ stdout: '9.0.0', stderr: '' });

      // isInstalledGlobally
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '1.0.0' } },
        }]),
        stderr: '',
      });

      // getInstalledVersion
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{
          dependencies: { '@radkode/neo': { version: '1.0.0' } },
        }]),
        stderr: '',
      });

      // getGlobalPath
      execaMock.mockResolvedValueOnce({
        stdout: '/usr/local/lib/node_modules',
        stderr: '',
      });

      // verifyGlobalCommand - which
      whichMock.mockResolvedValue('/usr/local/bin/neo');
      // verifyGlobalCommand - neo --version
      execaMock.mockResolvedValueOnce({ stdout: 'neo 1.0.0', stderr: '' });

      const result = await installer.getStatus();

      expect(result.pnpmInstalled).toBe(true);
      expect(result.pnpmVersion).toBe('9.0.0');
      expect(result.packageInstalled).toBe(true);
      expect(result.packageVersion).toBe('1.0.0');
      expect(result.globalPath).toBe('/usr/local/lib/node_modules');
      expect(result.commandAccessible).toBe(true);
    });

    it('should return status when pnpm is not installed', async () => {
      whichMock.mockRejectedValue(new Error('not found'));

      // getGlobalPath (still called)
      execaMock.mockRejectedValueOnce(new Error('command failed'));

      const result = await installer.getStatus();

      expect(result.pnpmInstalled).toBe(false);
      expect(result.pnpmVersion).toBeUndefined();
      expect(result.packageInstalled).toBe(false);
      expect(result.packageVersion).toBeUndefined();
      expect(result.commandAccessible).toBe(false);
    });

    it('should handle package not installed', async () => {
      // checkPnpm
      whichMock.mockResolvedValueOnce('/usr/local/bin/pnpm');

      // getPnpmVersion
      execaMock.mockResolvedValueOnce({ stdout: '9.0.0', stderr: '' });

      // isInstalledGlobally - returns false
      execaMock.mockResolvedValueOnce({
        stdout: JSON.stringify([{ dependencies: {} }]),
        stderr: '',
      });

      // getGlobalPath
      execaMock.mockResolvedValueOnce({
        stdout: '/usr/local/lib/node_modules',
        stderr: '',
      });

      // verifyGlobalCommand - not found
      whichMock.mockRejectedValueOnce(new Error('not found'));

      const result = await installer.getStatus();

      expect(result.pnpmInstalled).toBe(true);
      expect(result.packageInstalled).toBe(false);
      expect(result.packageVersion).toBeUndefined();
      expect(result.commandAccessible).toBe(false);
    });
  });
});
