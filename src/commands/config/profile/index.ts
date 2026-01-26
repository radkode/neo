import { Command } from '@commander-js/extra-typings';
import { writeFile } from 'fs/promises';
import { ui } from '@/utils/ui.js';
import { profileManager } from '@/utils/profiles.js';
import { validateArgument, isValidationError } from '@/utils/validation.js';
import {
  profileNameSchema,
  profileCreateOptionsSchema,
  profileExportOptionsSchema,
  profileImportOptionsSchema,
} from '@/types/schemas.js';
import type {
  ProfileCreateOptions,
  ProfileExportOptions,
  ProfileImportOptions,
} from '@/types/schemas.js';
import { validate } from '@/utils/validation.js';

export function createProfileCommand(): Command {
  const command = new Command('profile');

  command
    .description('Manage configuration profiles')
    .addCommand(createProfileListCommand())
    .addCommand(createProfileCreateCommand())
    .addCommand(createProfileUseCommand())
    .addCommand(createProfileDeleteCommand())
    .addCommand(createProfileShowCommand())
    .addCommand(createProfileExportCommand())
    .addCommand(createProfileImportCommand());

  return command;
}

/**
 * List all available profiles
 */
function createProfileListCommand(): Command {
  const command = new Command('list');

  command.description('List all configuration profiles').action(async () => {
    try {
      // Initialize profile system if needed
      await profileManager.initialize();

      const profiles = await profileManager.list();
      const activeProfile = await profileManager.getActive();

      if (profiles.length === 0) {
        ui.info('No profiles found');
        return;
      }

      ui.info('Configuration Profiles:');
      console.log('');

      for (const profile of profiles) {
        const isActive = profile === activeProfile;
        if (isActive) {
          ui.highlight(`  ${profile} (active)`);
        } else {
          ui.muted(`  ${profile}`);
        }
      }

      console.log('');
      ui.muted(`Profiles directory: ${profileManager.getProfilesDir()}`);
    } catch (error) {
      ui.error(`Failed to list profiles: ${error}`);
      process.exit(1);
    }
  });

  return command;
}

/**
 * Create a new profile
 */
function createProfileCreateCommand(): Command {
  const command = new Command('create');

  command
    .description('Create a new configuration profile')
    .argument('<name>', 'profile name')
    .option('-f, --from <profile>', 'copy configuration from existing profile')
    .action(async (rawName: string, options: unknown) => {
      // Validate profile name
      let name: string;
      try {
        name = validateArgument(profileNameSchema, rawName, 'profile name');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Validate options
      let validatedOptions: ProfileCreateOptions;
      try {
        validatedOptions = validate(profileCreateOptionsSchema, options, 'profile create options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        // Initialize profile system if needed
        await profileManager.initialize();

        if (validatedOptions.from) {
          // Copy from existing profile
          await profileManager.copy(validatedOptions.from, name);
          ui.success(`Created profile '${name}' (copied from '${validatedOptions.from}')`);
        } else {
          // Create empty profile
          await profileManager.create(name);
          ui.success(`Created profile '${name}'`);
        }

        ui.muted(`Use 'neo config profile use ${name}' to switch to this profile`);
      } catch (error) {
        ui.error(`Failed to create profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Switch to a profile
 */
function createProfileUseCommand(): Command {
  const command = new Command('use');

  command
    .description('Switch to a configuration profile')
    .argument('<name>', 'profile name')
    .action(async (rawName: string) => {
      // Validate profile name
      let name: string;
      try {
        name = validateArgument(profileNameSchema, rawName, 'profile name');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        await profileManager.setActive(name);
        ui.success(`Switched to profile '${name}'`);
      } catch (error) {
        ui.error(`Failed to switch profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Delete a profile
 */
function createProfileDeleteCommand(): Command {
  const command = new Command('delete');

  command
    .description('Delete a configuration profile')
    .argument('<name>', 'profile name')
    .action(async (rawName: string) => {
      // Validate profile name
      let name: string;
      try {
        name = validateArgument(profileNameSchema, rawName, 'profile name');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        await profileManager.delete(name);
        ui.success(`Deleted profile '${name}'`);
      } catch (error) {
        ui.error(`Failed to delete profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Show profile configuration
 */
function createProfileShowCommand(): Command {
  const command = new Command('show');

  command
    .description('Show profile configuration')
    .argument('[name]', 'profile name (defaults to active profile)')
    .action(async (rawName?: string) => {
      try {
        // Initialize profile system if needed
        await profileManager.initialize();

        let name: string;
        if (rawName) {
          // Validate profile name
          try {
            name = validateArgument(profileNameSchema, rawName, 'profile name');
          } catch (error) {
            if (isValidationError(error)) {
              process.exit(1);
            }
            throw error;
          }
        } else {
          name = await profileManager.getActive();
        }

        const profileConfig = await profileManager.read(name);
        const activeProfile = await profileManager.getActive();
        const isActive = name === activeProfile;

        ui.info(`Profile: ${name}${isActive ? ' (active)' : ''}`);
        console.log('');

        // AI section
        ui.section('AI');
        ui.keyValue([
          ['enabled', profileConfig.ai.enabled ? 'yes' : 'no'],
          ...(profileConfig.ai.model ? [['model', profileConfig.ai.model] as [string, string]] : []),
        ]);
        console.log('');

        // User section
        if (profileConfig.user.name || profileConfig.user.email) {
          ui.section('User');
          const userPairs: Array<[string, string]> = [];
          if (profileConfig.user.name) userPairs.push(['name', profileConfig.user.name]);
          if (profileConfig.user.email) userPairs.push(['email', profileConfig.user.email]);
          ui.keyValue(userPairs);
          console.log('');
        }

        // Preferences section
        ui.section('Preferences');
        const prefPairs: Array<[string, string]> = [
          ['banner', profileConfig.preferences.banner],
          ['theme', profileConfig.preferences.theme],
        ];
        if (profileConfig.preferences.editor) {
          prefPairs.push(['editor', profileConfig.preferences.editor]);
        }
        prefPairs.push(['aliases.n', profileConfig.preferences.aliases.n ? 'enabled' : 'disabled']);
        ui.keyValue(prefPairs);
        console.log('');

        // Shell section
        ui.section('Shell');
        ui.keyValue([
          ['type', profileConfig.shell.type],
          ['rcFile', profileConfig.shell.rcFile],
        ]);
      } catch (error) {
        ui.error(`Failed to show profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Export a profile to file or stdout
 */
function createProfileExportCommand(): Command {
  const command = new Command('export');

  command
    .description('Export a profile to JSON')
    .argument('<name>', 'profile name')
    .option('-o, --output <file>', 'output file (defaults to stdout)')
    .action(async (rawName: string, options: unknown) => {
      // Validate profile name
      let name: string;
      try {
        name = validateArgument(profileNameSchema, rawName, 'profile name');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Validate options
      let validatedOptions: ProfileExportOptions;
      try {
        validatedOptions = validate(profileExportOptionsSchema, options, 'profile export options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        const jsonContent = await profileManager.export(name);

        if (validatedOptions.output) {
          await writeFile(validatedOptions.output, jsonContent, 'utf-8');
          ui.success(`Exported profile '${name}' to ${validatedOptions.output}`);
        } else {
          console.log(jsonContent);
        }
      } catch (error) {
        ui.error(`Failed to export profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Import a profile from file
 */
function createProfileImportCommand(): Command {
  const command = new Command('import');

  command
    .description('Import a profile from JSON file')
    .argument('<file>', 'JSON file to import')
    .option('-n, --name <name>', 'profile name (defaults to filename)')
    .action(async (filePath: string, options: unknown) => {
      // Validate options
      let validatedOptions: ProfileImportOptions;
      try {
        validatedOptions = validate(profileImportOptionsSchema, options, 'profile import options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Validate name if provided
      if (validatedOptions.name) {
        try {
          validateArgument(profileNameSchema, validatedOptions.name, 'profile name');
        } catch (error) {
          if (isValidationError(error)) {
            process.exit(1);
          }
          throw error;
        }
      }

      try {
        // Initialize profile system if needed
        await profileManager.initialize();

        const importedName = await profileManager.import(filePath, validatedOptions.name);
        ui.success(`Imported profile '${importedName}' from ${filePath}`);
        ui.muted(`Use 'neo config profile use ${importedName}' to switch to this profile`);
      } catch (error) {
        ui.error(`Failed to import profile: ${error}`);
        process.exit(1);
      }
    });

  return command;
}
