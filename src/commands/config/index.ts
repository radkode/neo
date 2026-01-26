import { Command } from '@commander-js/extra-typings';
import { ui } from '@/utils/ui.js';
import { configManager } from '@/utils/config.js';
import { secretsManager, SecretsManager } from '@/utils/secrets.js';
import { validateArgument, validateConfigValue, isValidationError } from '@/utils/validation.js';
import { configKeySchema, aiApiKeySchema } from '@/types/schemas.js';
import { promptPassword } from '@/utils/prompt.js';
import { createProfileCommand } from '@/commands/config/profile/index.js';
import type { NeoConfig } from '@/utils/config.js';

/**
 * Keys that are stored in the secrets file instead of config
 */
const SECRET_KEYS = ['ai.apiKey'];

export function createConfigCommand(): Command {
  const command = new Command('config');

  command
    .description('Manage configuration')
    .addCommand(createConfigGetCommand())
    .addCommand(createConfigSetCommand())
    .addCommand(createConfigListCommand())
    .addCommand(createProfileCommand());

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
    .action(async (rawKey: string) => {
      // Validate key
      let key: string;
      try {
        key = validateArgument(configKeySchema, rawKey, 'configuration key');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Handle secret keys differently
      if (SECRET_KEYS.includes(key)) {
        try {
          const value = await secretsManager.getSecret(key);
          if (value) {
            ui.keyValue([[key, `${SecretsManager.maskSecret(value)} (configured)`]]);
          } else {
            ui.keyValue([[key, 'not configured']]);
          }
          return;
        } catch (error) {
          ui.error(`Failed to read secret: ${error}`);
          process.exit(1);
        }
      }

      try {
        const config = await configManager.read();
        const value = getNestedValue(config, key);

        if (value === undefined) {
          ui.error(`Configuration key not found: ${key}`);
          process.exit(1);
        }

        if (typeof value === 'object' && value !== null) {
          ui.info(`${key}:`);
          console.log(JSON.stringify(value, null, 2));
        } else {
          ui.keyValue([[key, String(value)]]);
        }
      } catch (error) {
        ui.error(`Failed to read configuration: ${error}`);
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
    .argument('[value]', 'configuration value (omit for secrets to use masked input)')
    .action(async (rawKey: string, rawValue?: string) => {
      // Validate key
      let key: string;
      try {
        key = validateArgument(configKeySchema, rawKey, 'configuration key');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Handle secret keys differently
      if (SECRET_KEYS.includes(key)) {
        try {
          let secretValue = rawValue;

          // If no value provided, prompt for masked input
          if (!secretValue) {
            secretValue = await promptPassword({ message: 'Enter API key' });
          }

          if (!secretValue || secretValue.trim() === '') {
            ui.error('API key cannot be empty');
            process.exit(1);
          }

          // Validate API key format
          const parseResult = aiApiKeySchema.safeParse(secretValue);
          if (!parseResult.success) {
            ui.error(`Invalid API key format: ${parseResult.error.issues[0]?.message}`);
            process.exit(1);
          }

          await secretsManager.setSecret(key, secretValue);
          ui.success(`Secret updated: ${key} = ${SecretsManager.maskSecret(secretValue)}`);
          return;
        } catch (error) {
          ui.error(`Failed to set secret: ${error}`);
          process.exit(1);
        }
      }

      // Regular config keys require a value
      if (!rawValue) {
        ui.error('Value is required for non-secret configuration keys');
        process.exit(1);
      }

      // Validate and parse value
      let value: string | number | boolean;
      try {
        value = await validateConfigValue(key, rawValue);
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        const config = await configManager.read();
        const updated = setNestedValue(config, key, value);
        await configManager.write(updated);

        ui.success(`Configuration updated: ${key} = ${value}`);
      } catch (error) {
        ui.error(`Failed to set configuration: ${error}`);
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
 * Creates the 'config list' command for displaying all configuration values
 */
function createConfigListCommand(): Command {
  const command = new Command('list');

  command.description('List all configuration values').action(async () => {
    try {
      const config = await configManager.read();
      const apiKeyConfigured = await secretsManager.isConfigured('ai.apiKey');

      ui.info('Current Neo CLI Configuration');

      // Show active profile if set
      if (config.activeProfile) {
        ui.muted(`Active profile: ${config.activeProfile}`);
      }
      console.log('');

      // AI section
      ui.section('AI');
      const aiPairs: Array<[string, string]> = [
        ['enabled', config.ai.enabled ? 'yes' : 'no'],
        ['apiKey', apiKeyConfigured ? 'configured' : 'not configured'],
      ];
      if (config.ai.model) {
        aiPairs.push(['model', config.ai.model]);
      }
      ui.keyValue(aiPairs);
      console.log('');

      if (config.user.name || config.user.email) {
        ui.section('User');
        const userPairs: Array<[string, string]> = [];
        if (config.user.name) userPairs.push(['user.name', config.user.name]);
        if (config.user.email) userPairs.push(['user.email', config.user.email]);
        ui.keyValue(userPairs);
        console.log('');
      }

      ui.section('Preferences');
      const prefPairs: Array<[string, string]> = [
        ['banner', config.preferences.banner],
        ['theme', config.preferences.theme],
      ];
      if (config.preferences.editor) {
        prefPairs.push(['editor', config.preferences.editor]);
      }
      prefPairs.push(['aliases.n', config.preferences.aliases.n ? 'enabled' : 'disabled']);
      ui.keyValue(prefPairs);
      console.log('');

      ui.section('Shell');
      ui.keyValue([
        ['type', config.shell.type],
        ['rcFile', config.shell.rcFile],
      ]);
      console.log('');

      ui.section('Installation');
      const installPairs: Array<[string, string]> = [
        ['version', config.installation.version],
        ['installedAt', config.installation.installedAt],
      ];
      if (config.installation.globalPath) {
        installPairs.push(['globalPath', config.installation.globalPath]);
      }
      if (config.installation.completionsPath) {
        installPairs.push(['completionsPath', config.installation.completionsPath]);
      }
      ui.keyValue(installPairs);
      console.log('');

      ui.divider();
      ui.muted(`Config file: ${configManager.getConfigFile()}`);
      ui.muted(`Secrets file: ${secretsManager.getSecretsFile()}`);
      ui.muted(
        `\nUse these full keys with 'neo config get <key>' or 'neo config set <key> <value>'`
      );
    } catch (error) {
      ui.error(`Failed to read configuration: ${error}`);
      process.exit(1);
    }
  });

  return command;
}
