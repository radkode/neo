import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
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
      const spinner = ui.spinner('Checking current setup');
      spinner.start();

      try {
        const installer = new GlobalInstaller();
        const shell = new ZshIntegration();

        const isInitialized = await configManager.isInitialized();
        const installStatus = await installer.getStatus();

        spinner.stop();

        if (isInitialized && !options.force) {
          const config = await configManager.read();
          ui.info(`Neo CLI is already initialized (v${config.installation.version})`);
          ui.info(`Config location: ${configManager.getConfigFile()}`);

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
            ui.info('Initialization cancelled');
            return;
          }

          if (action === 'reset') {
            const backup = await configManager.backup();
            if (backup) {
              ui.info(`Configuration backed up to: ${backup}`);
            }
            const shellBackup = await shell.backup();
            if (shellBackup) {
              ui.info(`Shell configuration backed up to: ${shellBackup}`);
            }
          }
        }

        if (!options.skipInstall) {
          const installSpinner = ui.spinner('Installing Neo CLI globally');
          installSpinner.start();

          if (!installStatus.pnpmInstalled) {
            installSpinner.fail('pnpm is not installed');
            ui.error('Please install pnpm first: https://pnpm.io/installation');
            ui.info('Then run this command again');
            return;
          }

          logger.debug(`pnpm version: ${installStatus.pnpmVersion}`);

          if (installStatus.packageInstalled) {
            installSpinner.text = 'Updating Neo CLI to latest version...';
            const updateResult = await installer.update();

            if (!updateResult.success) {
              installSpinner.fail('Failed to update Neo CLI');
              ui.error(updateResult.error || 'Unknown error occurred');
              return;
            }

            installSpinner.succeed(`Neo CLI updated to v${updateResult.version}`);
          } else {
            const installResult = await installer.install();

            if (!installResult.success) {
              installSpinner.fail('Failed to install Neo CLI globally');
              ui.error(installResult.error || 'Unknown error occurred');
              return;
            }

            installSpinner.succeed(`Neo CLI v${installResult.version} installed globally`);
          }

          const commandWorking = await installer.verifyGlobalCommand();
          if (!commandWorking) {
            ui.warn('Neo command may not be accessible. You might need to restart your terminal');
          }
        }

        const configSpinner = ui.spinner('Setting up configuration');
        configSpinner.start();

        const newConfig: NeoConfig = {
          user: {},
          preferences: {
            aliases: {
              n: true,
            },
            banner: 'full',
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

        const completionSpinner = ui.spinner('Creating completion files');
        completionSpinner.start();

        await CompletionGenerator.createCompletionFiles(newConfig.installation.completionsPath!);

        completionSpinner.succeed('Completion files created');

        const shellSpinner = ui.spinner('Setting up shell integration');
        shellSpinner.start();

        await shell.applyConfig(newConfig);

        shellSpinner.succeed('Shell integration configured');

        ui.success('Neo CLI has been successfully initialized!');
        console.log('');
        ui.info('What was configured:');
        ui.list([
          'Global installation: neo command available',
          `Configuration: ${configManager.getConfigFile()}`,
          'Shell alias: n → neo',
          'Shell completions: enabled',
        ]);

        console.log('');
        ui.info('Next steps:');
        ui.list([
          'Restart your terminal or run: source ~/.zshrc',
          'Try: neo --help or n --help',
          'Configure settings: neo config',
        ]);
      } catch (error: unknown) {
        spinner.fail('Initialization failed');
        ui.error(`Error: ${error}`);
        throw error;
      }
    });

  return command;
}
