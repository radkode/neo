import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import packageJson from '../../../package.json' with { type: 'json' };
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';
import { updateOptionsSchema } from '@/types/schemas.js';
import type { UpdateOptions } from '@/types/schemas.js';
import type { PackageManager } from '@/types/index.js';
import { compareVersions, fetchLatestCliVersion } from '@/utils/update-check.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { emitJson } from '@/utils/output.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { runAction } from '@/utils/run-action.js';

/**
 * Get the current version from package.json
 */
function getCurrentVersion(): string {
  try {
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
    return await fetchLatestCliVersion();
  } catch (error: unknown) {
    ui.error('Failed to fetch latest version from npm registry');
    throw error;
  }
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

  // The child's stdout would otherwise pollute our JSON channel. Forward it
  // to our stderr so the human still sees install progress, but the data
  // channel stays clean. stdin is ignored — there's nothing to prompt for.
  await execa(packageManager, commands[packageManager], {
    stdio: ['ignore', process.stderr, process.stderr],
  });
}

export function createUpdateCommand(): Command {
  const command = new Command('update');

  command
    .description('Update Neo CLI to the latest version')
    .option('--check-only', 'only check for updates without installing')
    .option('--force', 'force update even if already on latest version')
    .action(runAction(async (options: unknown) => {
      const validatedOptions: UpdateOptions = validate(
        updateOptionsSchema,
        options,
        'update options'
      );

      const currentVersion = getCurrentVersion();
      logger.debug(`Current version: ${currentVersion}`);

      const spinner = ui.spinner('Checking for updates');
      spinner.start();

      let latestVersion: string;
      try {
        latestVersion = await getLatestVersion();
      } catch {
        spinner.fail('Failed to check for updates');
        throw new Error(
          'Could not connect to npm registry. Please check your internet connection.'
        );
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
          const rtCtx = getRuntimeContext();
          if (rtCtx.nonInteractive || rtCtx.yes) {
            // Downgrading is potentially destructive; require explicit --force.
            throw new NonInteractiveError(
              `Downgrade from ${currentVersion} to ${latestVersion} requires explicit --force`,
              '--force'
            );
          }
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

      if (validatedOptions.checkOnly) {
        emitJson({
          ok: true,
          command: 'update',
          currentVersion,
          latestVersion,
          updateAvailable: comparison > 0,
        });
        if (comparison > 0) {
          ui.muted('Run neo update to install the latest version');
        }
        return;
      }

      if (!validatedOptions.force && comparison !== 0) {
        const rtCtx = getRuntimeContext();
        let confirm: boolean;
        if (rtCtx.yes) {
          confirm = true;
        } else if (rtCtx.nonInteractive) {
          // Updating rewrites a global binary — require --yes/--force explicitly.
          throw new NonInteractiveError(
            `Update to ${latestVersion} requires confirmation`,
            '--yes'
          );
        } else {
          const answer = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Update to version ${latestVersion}?`,
              default: true,
            },
          ]);
          confirm = Boolean(answer.confirm);
        }

        if (!confirm) {
          ui.muted('Update cancelled');
          return;
        }
      }

      const updateSpinner = ui.spinner('Detecting package manager');
      updateSpinner.start();
      const packageManager = await detectPackageManager();
      updateSpinner.text = `Updating via ${packageManager}...`;

      logger.debug(`Using package manager: ${packageManager}`);

      try {
        await executeUpdate(packageManager, validatedOptions.force || false);
        updateSpinner.succeed(`Successfully updated to version ${latestVersion}!`);

        emitJson({
          ok: true,
          command: 'update',
          from: currentVersion,
          to: latestVersion,
          packageManager,
        });

        ui.muted('Run neo --version to verify the installation');
      } catch (error: unknown) {
        updateSpinner.fail('Update failed');

        const errorMessage = error instanceof Error ? error.message : String(error);
        const installCmd = `${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} -g @radkode/neo@latest`;

        if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
          throw new Error(`Permission denied. Try running with sudo: sudo ${installCmd}`);
        }
        throw new Error(
          `Update failed: ${errorMessage}. Try updating manually: ${installCmd}`
        );
      }
    }));

  return command;
}
