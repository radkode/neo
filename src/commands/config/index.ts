import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { logger } from '@/utils/logger.js';
import { configManager } from '@/utils/config.js';
import type { NeoConfig } from '@/utils/config.js';

export function createConfigCommand(): Command {
  const command = new Command('config');

  command
    .description('Manage configuration')
    .addCommand(createConfigGetCommand())
    .addCommand(createConfigSetCommand())
    .addCommand(createConfigListCommand());

  return command;
}

/**
 * Creates the 'config get' command for retrieving configuration values
 *
 * Supports dot notation for nested properties (e.g., 'preferences.banner')
 */
function createConfigGetCommand(): Command {
  const command = new Command('get');

  command
    .description('Get a configuration value')
    .argument('<key>', 'configuration key (supports dot notation, e.g., preferences.banner)')
    .action(async (key: string) => {
      try {
        const config = await configManager.read();
        const value = getNestedValue(config, key);

        if (value === undefined) {
          logger.error(`Configuration key not found: ${chalk.cyan(key)}`);
          process.exit(1);
        }

        if (typeof value === 'object' && value !== null) {
          logger.info(`${chalk.cyan(key)}:`);
          console.log(JSON.stringify(value, null, 2));
        } else {
          logger.info(`${chalk.cyan(key)}: ${chalk.green(String(value))}`);
        }
      } catch (error) {
        logger.error(`Failed to read configuration: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Creates the 'config set' command for setting configuration values
 *
 * Supports dot notation for nested properties and validates specific config values
 */
function createConfigSetCommand(): Command {
  const command = new Command('set');

  command
    .description('Set a configuration value')
    .argument('<key>', 'configuration key (supports dot notation, e.g., preferences.banner)')
    .argument('<value>', 'configuration value')
    .action(async (key: string, value: string) => {
      try {
        if (key === 'preferences.banner') {
          const validBannerValues = ['full', 'compact', 'none'];
          if (!validBannerValues.includes(value)) {
            logger.error(
              `Invalid banner value: ${chalk.red(value)}. Must be one of: ${validBannerValues.map((v) => chalk.cyan(v)).join(', ')}`
            );
            process.exit(1);
          }
        }

        if (key === 'preferences.theme') {
          const validThemeValues = ['dark', 'light', 'auto'];
          if (!validThemeValues.includes(value)) {
            logger.error(
              `Invalid theme value: ${chalk.red(value)}. Must be one of: ${validThemeValues.map((v) => chalk.cyan(v)).join(', ')}`
            );
            process.exit(1);
          }
        }

        if (key === 'shell.type') {
          const validShellTypes = ['zsh', 'bash', 'fish'];
          if (!validShellTypes.includes(value)) {
            logger.error(
              `Invalid shell type: ${chalk.red(value)}. Must be one of: ${validShellTypes.map((v) => chalk.cyan(v)).join(', ')}`
            );
            process.exit(1);
          }
        }

        const config = await configManager.read();
        const updated = setNestedValue(config, key, parseValue(value));
        await configManager.write(updated);

        logger.success(`Configuration updated: ${chalk.cyan(key)} = ${chalk.green(value)}`);
      } catch (error) {
        logger.error(`Failed to set configuration: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Helper function to get a nested value from an object using dot notation
 */
function getNestedValue(obj: NeoConfig | Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce(
    (current: unknown, key: string) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    },
    obj as Record<string, unknown>
  );
}

/**
 * Helper function to set a nested value in an object using dot notation
 */
function setNestedValue(obj: NeoConfig, path: string, value: unknown): NeoConfig {
  const keys = path.split('.');
  const result = JSON.parse(JSON.stringify(obj)) as NeoConfig;
  let current: Record<string, unknown> = result as unknown as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!current[key]) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
  return result;
}

/**
 * Helper function to parse string values into appropriate types
 */
function parseValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

/**
 * Creates the 'config list' command for displaying all configuration values
 */
function createConfigListCommand(): Command {
  const command = new Command('list');

  command.description('List all configuration values').action(async () => {
    try {
      const config = await configManager.read();

      logger.info('Current Neo CLI Configuration:\n');

      if (config.user.name || config.user.email) {
        logger.log(chalk.bold('User:'));
        if (config.user.name) {
          logger.log(`  ${chalk.cyan('user.name')}: ${chalk.green(config.user.name)}`);
        }
        if (config.user.email) {
          logger.log(`  ${chalk.cyan('user.email')}: ${chalk.green(config.user.email)}`);
        }
        console.log();
      }

      logger.log(chalk.bold('Preferences:'));
      logger.log(
        `  ${chalk.cyan('preferences.banner')}: ${chalk.green(config.preferences.banner)}`
      );
      logger.log(`  ${chalk.cyan('preferences.theme')}: ${chalk.green(config.preferences.theme)}`);
      if (config.preferences.editor) {
        logger.log(
          `  ${chalk.cyan('preferences.editor')}: ${chalk.green(config.preferences.editor)}`
        );
      }
      logger.log(
        `  ${chalk.cyan('preferences.aliases.n')}: ${chalk.green(config.preferences.aliases.n ? 'enabled' : 'disabled')}`
      );
      console.log();

      logger.log(chalk.bold('Shell:'));
      logger.log(`  ${chalk.cyan('shell.type')}: ${chalk.green(config.shell.type)}`);
      logger.log(`  ${chalk.cyan('shell.rcFile')}: ${chalk.green(config.shell.rcFile)}`);
      console.log();

      logger.log(chalk.bold('Installation:'));
      logger.log(
        `  ${chalk.cyan('installation.version')}: ${chalk.green(config.installation.version)}`
      );
      logger.log(
        `  ${chalk.cyan('installation.installedAt')}: ${chalk.green(config.installation.installedAt)}`
      );
      if (config.installation.globalPath) {
        logger.log(
          `  ${chalk.cyan('installation.globalPath')}: ${chalk.green(config.installation.globalPath)}`
        );
      }
      if (config.installation.completionsPath) {
        logger.log(
          `  ${chalk.cyan('installation.completionsPath')}: ${chalk.green(config.installation.completionsPath)}`
        );
      }

      console.log(`\n${chalk.dim(`Config file: ${configManager.getConfigFile()}`)}`);
      console.log(
        chalk.dim(
          `\nUse these full keys with 'neo config get <key>' or 'neo config set <key> <value>'`
        )
      );
    } catch (error) {
      logger.error(`Failed to read configuration: ${error}`);
      process.exit(1);
    }
  });

  return command;
}
