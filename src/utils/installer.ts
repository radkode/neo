import { execa } from 'execa';
import which from 'which';
import { logger } from '@/utils/logger.js';

/**
 * Type guard to check if an error has a message property
 */
function isErrorWithMessage(error: unknown): error is Error {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>)['message'] === 'string'
  );
}

/**
 * Safely extracts error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

export interface InstallationResult {
  success: boolean;
  version?: string | undefined;
  globalPath?: string | undefined;
  error?: string;
}

export class GlobalInstaller {
  private packageName: string;

  constructor(packageName: string = '@radkode/neo') {
    this.packageName = packageName;
  }

  /**
   * Checks if pnpm is available
   */
  async checkPnpm(): Promise<boolean> {
    try {
      await which('pnpm');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets pnpm version
   */
  async getPnpmVersion(): Promise<string | null> {
    try {
      const { stdout } = await execa('pnpm', ['--version']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Checks if the package is already installed globally
   */
  async isInstalledGlobally(): Promise<boolean> {
    try {
      const { stdout } = await execa('pnpm', ['list', '-g', '--depth=0', '--json']);
      const globalPackages = JSON.parse(stdout);

      // Check if our package is in the global list
      const dependencies = globalPackages[0]?.dependencies || {};
      return this.packageName in dependencies;
    } catch {
      return false;
    }
  }

  /**
   * Gets the global installation path
   */
  async getGlobalPath(): Promise<string | null> {
    try {
      const { stdout } = await execa('pnpm', ['root', '-g']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Gets the installed package version
   */
  async getInstalledVersion(): Promise<string | null> {
    try {
      const { stdout } = await execa('pnpm', ['list', '-g', '--depth=0', '--json']);
      const globalPackages = JSON.parse(stdout);
      const dependencies = globalPackages[0]?.dependencies || {};
      return dependencies[this.packageName]?.version || null;
    } catch {
      return null;
    }
  }

  /**
   * Installs the package globally using pnpm
   */
  async install(): Promise<InstallationResult> {
    // Check if pnpm is available
    const hasPnpm = await this.checkPnpm();
    if (!hasPnpm) {
      return {
        success: false,
        error: 'pnpm is not installed. Please install pnpm first: https://pnpm.io/installation',
      };
    }

    try {
      logger.debug(`Installing ${this.packageName} globally...`);

      // Install globally
      const { stdout, stderr } = await execa('pnpm', ['add', '-g', this.packageName], {
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      logger.debug(`pnpm stdout: ${stdout}`);
      if (stderr) {
        logger.debug(`pnpm stderr: ${stderr}`);
      }

      // Verify installation
      const isInstalled = await this.isInstalledGlobally();
      if (!isInstalled) {
        return {
          success: false,
          error: 'Installation completed but package verification failed',
        };
      }

      const version = await this.getInstalledVersion();
      const globalPath = await this.getGlobalPath();

      return {
        success: true,
        version: version ?? undefined,
        globalPath: globalPath ?? undefined,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Installation failed: ${errorMessage}`);

      // Handle common errors
      if (errorMessage.includes('EACCES')) {
        return {
          success: false,
          error:
            'Permission denied. Try running with sudo or configure pnpm to install in user directory.',
        };
      }

      if (errorMessage.includes('ENOTFOUND')) {
        return {
          success: false,
          error: 'Network error. Please check your internet connection and try again.',
        };
      }

      return {
        success: false,
        error: `Installation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Uninstalls the package globally
   */
  async uninstall(): Promise<InstallationResult> {
    const hasPnpm = await this.checkPnpm();
    if (!hasPnpm) {
      return {
        success: false,
        error: 'pnpm is not installed',
      };
    }

    try {
      logger.debug(`Uninstalling ${this.packageName} globally...`);

      const { stdout, stderr } = await execa('pnpm', ['remove', '-g', this.packageName]);

      logger.debug(`pnpm stdout: ${stdout}`);
      if (stderr) {
        logger.debug(`pnpm stderr: ${stderr}`);
      }

      // Verify removal
      const isStillInstalled = await this.isInstalledGlobally();
      if (isStillInstalled) {
        return {
          success: false,
          error: 'Uninstallation completed but package is still present',
        };
      }

      return {
        success: true,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Uninstallation failed: ${errorMessage}`);
      return {
        success: false,
        error: `Uninstallation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Updates the package to the latest version
   */
  async update(): Promise<InstallationResult> {
    const hasPnpm = await this.checkPnpm();
    if (!hasPnpm) {
      return {
        success: false,
        error: 'pnpm is not installed',
      };
    }

    try {
      logger.debug(`Updating ${this.packageName} globally...`);

      const { stdout, stderr } = await execa('pnpm', ['update', '-g', this.packageName]);

      logger.debug(`pnpm stdout: ${stdout}`);
      if (stderr) {
        logger.debug(`pnpm stderr: ${stderr}`);
      }

      const version = await this.getInstalledVersion();
      const globalPath = await this.getGlobalPath();

      return {
        success: true,
        version: version ?? undefined,
        globalPath: globalPath ?? undefined,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Update failed: ${errorMessage}`);
      return {
        success: false,
        error: `Update failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Verifies that the neo command is accessible globally
   */
  async verifyGlobalCommand(): Promise<boolean> {
    try {
      // Check if 'neo' command exists
      await which('neo');

      // Try to run neo --version to make sure it works
      const { stdout } = await execa('neo', ['--version']);
      logger.debug(`neo --version output: ${stdout}`);

      return true;
    } catch (error) {
      logger.debug(`Global command verification failed: ${error}`);
      return false;
    }
  }

  /**
   * Gets comprehensive installation status
   */
  async getStatus(): Promise<{
    pnpmInstalled: boolean;
    pnpmVersion?: string | undefined;
    packageInstalled: boolean;
    packageVersion?: string | undefined;
    globalPath?: string | undefined;
    commandAccessible: boolean;
  }> {
    const pnpmInstalled = await this.checkPnpm();
    const pnpmVersion = pnpmInstalled ? await this.getPnpmVersion() : undefined;
    const packageInstalled = await this.isInstalledGlobally();
    const packageVersion = packageInstalled ? await this.getInstalledVersion() : undefined;
    const globalPath = await this.getGlobalPath();
    const commandAccessible = await this.verifyGlobalCommand();

    return {
      pnpmInstalled,
      pnpmVersion: pnpmVersion ?? undefined,
      packageInstalled,
      packageVersion: packageVersion ?? undefined,
      globalPath: globalPath ?? undefined,
      commandAccessible,
    };
  }
}
