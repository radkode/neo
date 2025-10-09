import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { updateOptionsSchema } from '@/types/schemas.js';
import type { UpdateOptions } from '@/types/schemas.js';
import type { NpmPackageInfo, PackageManager } from '@/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the current version from package.json
 */
function getCurrentVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));
    return packageJson.version;
  } catch (error: unknown) {
    ui.error('Failed to read current version');
    throw error;
  }
}

/**
 * Fetch latest version from npm registry
 */
async function getLatestVersion(): Promise<string> {
  try {
    const response = await fetch('https://registry.npmjs.org/@radkode/neo');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = (await response.json()) as NpmPackageInfo;
    return data['dist-tags'].latest;
  } catch (error: unknown) {
    ui.error('Failed to fetch latest version from npm registry');
    throw error;
  }
}

/**
 * Compare version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

/**
 * Detect which package manager is being used
 */
async function detectPackageManager(): Promise<PackageManager> {
  // Check for lock files
  try {
    await execa('ls', ['pnpm-lock.yaml']);
    return 'pnpm';
  } catch {
    // pnpm-lock.yaml not found
  }

  try {
    await execa('ls', ['yarn.lock']);
    return 'yarn';
  } catch {
    // yarn.lock not found
  }

  // Default to npm
  return 'npm';
}

/**
 * Execute the update command for the detected package manager
 */
async function executeUpdate(packageManager: PackageManager, force: boolean): Promise<void> {
  const commands: Record<PackageManager, string[]> = {
    npm: ['install', '-g', '@radkode/neo@latest'],
    pnpm: ['add', '-g', '@radkode/neo@latest'],
    yarn: ['global', 'add', '@radkode/neo@latest'],
  };

  if (force) {
    // Add force flag for npm and pnpm
    if (packageManager === 'npm') {
      commands.npm.push('--force');
    } else if (packageManager === 'pnpm') {
      commands.pnpm.push('--force');
    }
  }

  await execa(packageManager, commands[packageManager], {
    stdio: 'inherit',
  });
}

export function createUpdateCommand(): Command {
  const command = new Command('update');

  command
    .description('Update Neo CLI to the latest version')
    .option('--check-only', 'only check for updates without installing')
    .option('--force', 'force update even if already on latest version')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: UpdateOptions;
      try {
        validatedOptions = validate(updateOptionsSchema, options, 'update options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }
      try {
        const currentVersion = getCurrentVersion();
        logger.debug(`Current version: ${currentVersion}`);

        // Show checking spinner
        const spinner = ui.spinner('Checking for updates');
        spinner.start();

        let latestVersion: string;
        try {
          latestVersion = await getLatestVersion();
        } catch {
          spinner.fail('Failed to check for updates');
          ui.error('Could not connect to npm registry. Please check your internet connection');
          process.exit(1);
        }

        logger.debug(`Latest version: ${latestVersion}`);

        const comparison = compareVersions(latestVersion, currentVersion);

        if (comparison === 0) {
          spinner.succeed('You are already on the latest version!');
          ui.info(`Current version: ${currentVersion}`);

          if (!validatedOptions.force) {
            return;
          }

          ui.warn('--force flag detected, proceeding with reinstall');
        } else if (comparison < 0) {
          spinner.warn(
            `You are on a newer version (${currentVersion}) than the latest stable (${latestVersion})`
          );

          if (!validatedOptions.force && !validatedOptions.checkOnly) {
            const { shouldDowngrade } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'shouldDowngrade',
                message: 'Do you want to downgrade to the latest stable version?',
                default: false,
              },
            ]);

            if (!shouldDowngrade) {
              ui.muted('Update cancelled');
              return;
            }
          } else if (!validatedOptions.force) {
            return;
          }
        } else {
          spinner.succeed('Update available!');
          ui.keyValue([
            ['Current version', currentVersion],
            ['Latest version', latestVersion],
          ]);
        }

        // If check-only mode, stop here
        if (validatedOptions.checkOnly) {
          if (comparison > 0) {
            ui.muted('Run neo update to install the latest version');
          }
          return;
        }

        // Ask for confirmation unless force flag is set
        if (!validatedOptions.force && comparison !== 0) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Update to version ${latestVersion}?`,
              default: true,
            },
          ]);

          if (!confirm) {
            ui.muted('Update cancelled');
            return;
          }
        }

        // Detect package manager
        const updateSpinner = ui.spinner('Detecting package manager');
        updateSpinner.start();
        const packageManager = await detectPackageManager();
        updateSpinner.text = `Updating via ${packageManager}...`;

        logger.debug(`Using package manager: ${packageManager}`);

        // Execute update
        try {
          await executeUpdate(packageManager, validatedOptions.force || false);
          updateSpinner.succeed(`Successfully updated to version ${latestVersion}!`);

          ui.muted('Run neo --version to verify the installation');
        } catch (error: unknown) {
          updateSpinner.fail('Update failed');

          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
            ui.error('Permission denied. Try running with sudo:');
            ui.muted(
              `  sudo ${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} -g @radkode/neo@latest`
            );
          } else {
            ui.error(`Update failed: ${errorMessage}`);
            ui.muted(
              `Try updating manually: ${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} -g @radkode/neo@latest`
            );
          }
          process.exit(1);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ui.error(`Unexpected error: ${errorMessage}`);
        process.exit(1);
      }
    });

  return command;
}
