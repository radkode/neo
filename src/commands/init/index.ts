import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { InitOptions } from '@/types/index.js';
import { configManager, type NeoConfig } from '@/utils/config.js';
import { GlobalInstaller } from '@/utils/installer.js';
import { ZshIntegration } from '@/utils/shell.js';
import { CompletionGenerator } from '@/utils/completions.js';
import { join } from 'path';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Install and configure Neo CLI globally')
    .option('--force', 'force reconfiguration if already initialized')
    .option('--skip-install', 'skip global installation (configuration only)')
    .action(async (options: InitOptions) => {
      const spinner = ora('Checking current setup...').start();

      try {
        const installer = new GlobalInstaller();
        const shell = new ZshIntegration();

        const isInitialized = await configManager.isInitialized();
        const installStatus = await installer.getStatus();

        spinner.stop();

        if (isInitialized && !options.force) {
          const config = await configManager.read();
          logger.info(`Neo CLI is already initialized (v${config.installation.version})`);
          logger.info(`Config location: ${chalk.cyan(configManager.getConfigFile())}`);

          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'What would you like to do?',
              choices: [
                { name: 'Update configuration', value: 'update' },
                { name: 'Reset everything', value: 'reset' },
                { name: 'Cancel', value: 'cancel' },
              ],
            },
          ]);

          if (action === 'cancel') {
            logger.info('Initialization cancelled.');
            return;
          }

          if (action === 'reset') {
            const backup = await configManager.backup();
            if (backup) {
              logger.info(`Configuration backed up to: ${chalk.gray(backup)}`);
            }
            const shellBackup = await shell.backup();
            if (shellBackup) {
              logger.info(`Shell configuration backed up to: ${chalk.gray(shellBackup)}`);
            }
          }
        }

        if (!options.skipInstall) {
          const installSpinner = ora('Installing Neo CLI globally...').start();

          if (!installStatus.pnpmInstalled) {
            installSpinner.fail('pnpm is not installed');
            logger.error('Please install pnpm first: https://pnpm.io/installation');
            logger.info('Then run this command again.');
            return;
          }

          logger.debug(`pnpm version: ${installStatus.pnpmVersion}`);

          if (installStatus.packageInstalled) {
            installSpinner.text = 'Updating Neo CLI to latest version...';
            const updateResult = await installer.update();

            if (!updateResult.success) {
              installSpinner.fail('Failed to update Neo CLI');
              logger.error(updateResult.error || 'Unknown error occurred');
              return;
            }

            installSpinner.succeed(`Neo CLI updated to v${updateResult.version}`);
          } else {
            const installResult = await installer.install();

            if (!installResult.success) {
              installSpinner.fail('Failed to install Neo CLI globally');
              logger.error(installResult.error || 'Unknown error occurred');
              return;
            }

            installSpinner.succeed(`Neo CLI v${installResult.version} installed globally`);
          }

          const commandWorking = await installer.verifyGlobalCommand();
          if (!commandWorking) {
            logger.warn(
              'Neo command may not be accessible. You might need to restart your terminal.'
            );
          }
        }

        const configSpinner = ora('Setting up configuration...').start();

        const newConfig: NeoConfig = {
          user: {},
          preferences: {
            aliases: {
              n: true,
            },
            theme: 'auto',
          },
          shell: {
            type: 'zsh',
            rcFile: shell.getRcFile(),
          },
          installation: {
            installedAt: new Date().toISOString(),
            version: installStatus.packageVersion || '0.1.0',
            ...(installStatus.globalPath && { globalPath: installStatus.globalPath }),
            completionsPath: join(configManager.getConfigDir(), 'completions'),
          },
        };

        await configManager.write(newConfig);
        configSpinner.succeed('Configuration saved');

        const completionSpinner = ora('Creating completion files...').start();

        await CompletionGenerator.createCompletionFiles(newConfig.installation.completionsPath!);

        completionSpinner.succeed('Completion files created');

        const shellSpinner = ora('Setting up shell integration...').start();

        await shell.applyConfig(newConfig);

        shellSpinner.succeed('Shell integration configured');

        logger.success('\n🎉 Neo CLI has been successfully initialized!');
        logger.info('\nWhat was configured:');
        logger.log(`  ✓ Global installation: ${chalk.cyan('neo')} command available`);
        logger.log(`  ✓ Configuration: ${chalk.cyan(configManager.getConfigFile())}`);
        logger.log(`  ✓ Shell alias: ${chalk.cyan('n')} → ${chalk.cyan('neo')}`);
        logger.log(`  ✓ Shell completions: enabled`);

        logger.info('\nNext steps:');
        logger.log(
          `  ${chalk.gray('1.')} Restart your terminal or run: ${chalk.cyan('source ~/.zshrc')}`
        );
        logger.log(
          `  ${chalk.gray('2.')} Try: ${chalk.cyan('neo --help')} or ${chalk.cyan('n --help')}`
        );
        logger.log(`  ${chalk.gray('3.')} Configure settings: ${chalk.cyan('neo config')}`);
      } catch (error: unknown) {
        spinner.fail('Initialization failed');
        logger.error(`Error: ${error}`);
        throw error;
      }
    });

  return command;
}
