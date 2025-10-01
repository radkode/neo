import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '@/utils/logger.js';
import type { UpdateOptions, NpmPackageInfo, PackageManager } from '@/types/index.js';

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
    logger.error('Failed to read current version');
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
    logger.error('Failed to fetch latest version from npm registry');
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
    .action(async (options: UpdateOptions) => {
      try {
        const currentVersion = getCurrentVersion();
        logger.debug(`Current version: ${currentVersion}`);

        // Show checking spinner
        const spinner = ora('Checking for updates...').start();

        let latestVersion: string;
        try {
          latestVersion = await getLatestVersion();
        } catch {
          spinner.fail(chalk.red('Failed to check for updates'));
          logger.error('Could not connect to npm registry. Please check your internet connection.');
          process.exit(1);
        }

        logger.debug(`Latest version: ${latestVersion}`);

        const comparison = compareVersions(latestVersion, currentVersion);

        if (comparison === 0) {
          spinner.succeed(chalk.green('You are already on the latest version!'));
          logger.log(`\n${chalk.cyan('Current version:')} ${chalk.bold(currentVersion)}`);

          if (!options.force) {
            return;
          }

          logger.log(chalk.yellow('\n--force flag detected, proceeding with reinstall...'));
        } else if (comparison < 0) {
          spinner.warn(
            chalk.yellow(
              `You are on a newer version (${currentVersion}) than the latest stable (${latestVersion})`
            )
          );

          if (!options.force && !options.checkOnly) {
            const { shouldDowngrade } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'shouldDowngrade',
                message: 'Do you want to downgrade to the latest stable version?',
                default: false,
              },
            ]);

            if (!shouldDowngrade) {
              logger.log(chalk.gray('\nUpdate cancelled'));
              return;
            }
          } else if (!options.force) {
            return;
          }
        } else {
          spinner.succeed(chalk.green('Update available!'));
          logger.log(`\n${chalk.cyan('Current version:')} ${chalk.bold(currentVersion)}`);
          logger.log(`${chalk.cyan('Latest version:')}  ${chalk.bold.green(latestVersion)}`);
        }

        // If check-only mode, stop here
        if (options.checkOnly) {
          if (comparison > 0) {
            logger.log(
              chalk.gray(`\nRun ${chalk.cyan('neo update')} to install the latest version.`)
            );
          }
          return;
        }

        // Ask for confirmation unless force flag is set
        if (!options.force && comparison !== 0) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Update to version ${latestVersion}?`,
              default: true,
            },
          ]);

          if (!confirm) {
            logger.log(chalk.gray('\nUpdate cancelled'));
            return;
          }
        }

        // Detect package manager
        const updateSpinner = ora('Detecting package manager...').start();
        const packageManager = await detectPackageManager();
        updateSpinner.text = `Updating via ${chalk.cyan(packageManager)}...`;

        logger.debug(`Using package manager: ${packageManager}`);

        // Execute update
        try {
          await executeUpdate(packageManager, options.force || false);
          updateSpinner.succeed(chalk.green(`Successfully updated to version ${latestVersion}!`));

          logger.log(
            chalk.gray(`\n✨ Run ${chalk.cyan('neo --version')} to verify the installation.`)
          );
        } catch (error: unknown) {
          updateSpinner.fail(chalk.red('Update failed'));

          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
            logger.error('Permission denied. Try running with sudo:');
            logger.log(
              chalk.cyan(
                `  sudo ${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} -g @radkode/neo@latest`
              )
            );
          } else {
            logger.error(`Update failed: ${errorMessage}`);
            logger.log(
              chalk.gray(
                `\nTry updating manually: ${chalk.cyan(`${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} -g @radkode/neo@latest`)}`
              )
            );
          }
          process.exit(1);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Unexpected error: ${errorMessage}`);
        process.exit(1);
      }
    });

  return command;
}
