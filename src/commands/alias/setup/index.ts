import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZshIntegration } from '@/utils/shell.js';
import { logger } from '@/utils/logger.js';

interface SetupOptions {
  force?: boolean;
}

interface AliasDefinition {
  readonly [alias: string]: string;
}

const ALIASES: AliasDefinition = Object.freeze({
  gp: 'neo git pull',
  gpu: 'neo git push',
});

/**
 * Finds aliases that will be overwritten outside the NEO CLI markers section
 *
 * @param content - The content of the .zshrc file
 * @param aliases - The alias definitions to check for conflicts
 * @returns Array of conflicting aliases with their current values
 */
function findConflictingAliases(
  content: string,
  aliases: AliasDefinition
): { alias: string; current: string }[] {
  const conflicts: { alias: string; current: string }[] = [];

  // Simple pattern: alias name="value" or alias name='value'
  const aliasRegex = /^alias\s+([A-Za-z0-9_-]+)=(["'])(.*?)\2\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = aliasRegex.exec(content)) !== null) {
    const [, name, , value] = match;
    // Type guard: ensure name and value are defined
    if (name && value && aliases[name as keyof AliasDefinition] && value.trim() !== aliases[name]) {
      conflicts.push({ alias: name, current: value.trim() });
    }
  }

  return conflicts;
}

/**
 * Creates the 'alias setup' subcommand.
 */
export function createSetupCommand(): Command {
  const command = new Command('setup');

  command
    .description('Setup ZSH aliases for Neo CLI (gp, gpu). Backs up ~/.zshrc before modifying.')
    .option('-f, --force', 'skip confirmation and overwrite conflicting aliases')
    .action(async (options: SetupOptions): Promise<void> => {
      const shell = new ZshIntegration();

      try {
        // Read current rc content and detect conflicts
        const rcFile = shell.getRcFile();
        const rcContent = await (async () => {
          // ZshIntegration has a private readRc, so we access the file directly here for conflict scan
          try {
            const { readFile } = await import('fs/promises');
            return await readFile(rcFile, 'utf-8');
          } catch {
            return '';
          }
        })();

        const conflicts = findConflictingAliases(rcContent, ALIASES);

        if (conflicts.length > 0 && !options.force) {
          logger.warn('The following aliases already exist and will be overwritten:');
          for (const c of conflicts) {
            logger.log(
              `  ${chalk.cyan(c.alias)}: currently ${chalk.yellow(c.current)} -> new ${chalk.green(ALIASES[c.alias as keyof AliasDefinition])}`
            );
          }

          const { confirm } = await inquirer.prompt<{
            confirm: boolean;
          }>([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'Proceed with overwriting these aliases?',
              default: false,
            },
          ]);

          if (!confirm) {
            logger.info('Aborted. No changes were made.');
            return;
          }
        }

        // Backup .zshrc (timestamped)
        const backupPath = await shell.backup();
        if (backupPath) {
          logger.info(`Backed up ${chalk.cyan(rcFile)} to ${chalk.cyan(backupPath)}`);
        } else {
          logger.warn('No existing ~/.zshrc found to back up, proceeding to create/update it.');
        }

        // Apply aliases using ZshIntegration (this uses markers and updates cleanly)
        for (const [alias, value] of Object.entries(ALIASES)) {
          await shell.addAlias(alias, value);
        }

        logger.success('Aliases configured successfully.');
        logger.log('Added/updated aliases:');
        for (const [alias, value] of Object.entries(ALIASES)) {
          logger.log(`  ${chalk.cyan(alias)}=${chalk.green(`"${value}"`)}`);
        }

        logger.info('Restart your shell or run: source ~/.zshrc');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to setup aliases: ${message}`);
        process.exitCode = 1;
      }
    });

  return command;
}
