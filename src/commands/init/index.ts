import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';
import { initOptionsSchema } from '@/types/schemas.js';
import type { InitOptions } from '@/types/schemas.js';
import { configManager, type NeoConfig } from '@/utils/config.js';
import { GlobalInstaller } from '@/utils/installer.js';
import { ZshIntegration } from '@/utils/shell.js';
import { CompletionGenerator } from '@/utils/completions.js';
import { installClaudeSkill } from '@/utils/skill-installer.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { join } from 'path';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Install and configure Neo CLI globally')
    .option('--force', 'force reconfiguration if already initialized')
    .option('--skip-install', 'skip global installation (configuration only)')
    .option('--no-skill', 'skip installing the bundled Claude Code skill')
    .action(runAction(async (options: unknown) => {
      const validatedOptions: InitOptions = validate(
        initOptionsSchema,
        options,
        'init options'
      );
      const spinner = ui.spinner('Checking current setup');
      spinner.start();

      try {
        const installer = new GlobalInstaller();
        const shell = new ZshIntegration();

        const isInitialized = await configManager.isInitialized();
        const installStatus = await installer.getStatus();

        spinner.stop();

        if (isInitialized && !validatedOptions.force) {
          const config = await configManager.read();
          ui.info(`Neo CLI is already initialized (v${config.installation.version})`);
          ui.info(`Config location: ${configManager.getConfigFile()}`);

          const rtCtx = getRuntimeContext();
          let action: 'update' | 'reset' | 'cancel';

          if (rtCtx.yes) {
            action = 'update';
          } else if (rtCtx.nonInteractive) {
            // Existing config + no guidance = ambiguous. Require explicit flag.
            throw new NonInteractiveError(
              'Neo is already initialized; pass --force to reset or run without --non-interactive',
              '--force'
            );
          } else {
            const answer = await inquirer.prompt([
              {
                choices: [
                  { name: 'Update configuration', short: 'Update configuration', value: 'update' },
                  { name: 'Reset everything', short: 'Reset everything', value: 'reset' },
                  { name: 'Cancel', short: 'Cancel', value: 'cancel' },
                ],
                message: 'What would you like to do?',
                name: 'action',
                type: 'list',
              },
            ]);
            action = answer.action as 'update' | 'reset' | 'cancel';
          }

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

        if (!validatedOptions.skipInstall) {
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
          ai: {
            enabled: true,
            model: 'claude-haiku-4-5-20251001',
          },
          installation: {
            completionsPath: join(configManager.getConfigDir(), 'completions'),
            ...(installStatus.globalPath ? { globalPath: installStatus.globalPath } : {}),
            installedAt: new Date().toISOString(),
            version: installStatus.packageVersion || '0.1.0',
          },
          preferences: {
            aliases: {
              n: true,
            },
            banner: 'full',
            theme: 'auto',
          },
          shell: {
            rcFile: shell.getRcFile(),
            type: 'zsh',
          },
          updates: {
            lastCheckedAt: null,
            latestVersion: null,
          },
          user: {},
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

        if (validatedOptions.skill !== false) {
          const skillSpinner = ui.spinner('Installing Claude Code skill');
          skillSpinner.start();
          try {
            const result = await installClaudeSkill(
              validatedOptions.force ? { force: true } : {}
            );
            if (result === null) {
              skillSpinner.stop();
              logger.debug('Claude Code not detected; skipped skill install');
            } else if (result.status === 'installed') {
              skillSpinner.succeed(`Claude Code skill installed at ${result.destination}`);
            } else if (result.status === 'updated') {
              skillSpinner.succeed(`Claude Code skill updated at ${result.destination}`);
            } else if (result.status === 'unchanged') {
              skillSpinner.succeed('Claude Code skill already up to date');
            } else {
              skillSpinner.warn(
                `Claude Code skill at ${result.destination} differs from bundled copy; pass --force to overwrite`
              );
            }
          } catch (err) {
            skillSpinner.fail('Failed to install Claude Code skill');
            ui.warn(`Skill install error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        ui.success('Neo CLI has been successfully initialized!');
        ui.newline();
        ui.info('What was configured:');
        ui.list([
          'Global installation: neo command available',
          `Configuration: ${configManager.getConfigFile()}`,
          'Shell alias: n → neo',
          'Shell completions: enabled',
        ]);

        ui.newline();
        ui.info('Next steps:');
        ui.list([
          'Restart your terminal or run: source ~/.zshrc',
          'Try: neo --help or n --help',
          'Configure settings: neo config',
        ]);
        emitJson({
          ok: true,
          command: 'init',
          version: installStatus.packageVersion ?? null,
          configFile: configManager.getConfigFile(),
        });
      } catch (error: unknown) {
        // A NonInteractiveError is a contract signal, not a failure — let it
        // propagate to runAction without painting "Initialization failed" red.
        if (error instanceof NonInteractiveError) throw error;
        spinner.fail('Initialization failed');
        ui.error(`Error: ${error}`);
        throw error;
      }
    }));

  command.addHelpText(
    'after',
    `
Examples:
  Fresh install:
    $ neo init

  Force reconfigure:
    $ neo init --force

  Configuration only (no global install):
    $ neo init --skip-install
`
  );

  return command;
}
