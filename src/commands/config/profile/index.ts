import { Command } from '@commander-js/extra-typings';
import { writeFile } from 'fs/promises';
import { ui } from '@/utils/ui.js';
import { profileManager } from '@/utils/profiles.js';
import { validate, validateArgument } from '@/utils/validation.js';
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
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

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

  command.description('List all configuration profiles').action(runAction(async () => {
    await profileManager.initialize();

    const profiles = await profileManager.list();
    const activeProfile = await profileManager.getActive();

    emitJson(
      {
        ok: true,
        command: 'config.profile.list',
        profiles,
        active: activeProfile,
        profilesDir: profileManager.getProfilesDir(),
      },
      {
        text: () => {
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
        },
      }
    );
  }));

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
    .action(runAction(async (rawName: string, options: unknown) => {
      const name = validateArgument(profileNameSchema, rawName, 'profile name');
      const validatedOptions: ProfileCreateOptions = validate(
        profileCreateOptionsSchema,
        options,
        'profile create options'
      );

      await profileManager.initialize();

      const copiedFrom = validatedOptions.from ?? null;
      if (copiedFrom) {
        await profileManager.copy(copiedFrom, name);
      } else {
        await profileManager.create(name);
      }

      emitJson(
        {
          ok: true,
          command: 'config.profile.create',
          name,
          copiedFrom,
        },
        {
          text: () => {
            ui.success(
              copiedFrom
                ? `Created profile '${name}' (copied from '${copiedFrom}')`
                : `Created profile '${name}'`
            );
            ui.muted(`Use 'neo config profile use ${name}' to switch to this profile`);
          },
        }
      );
    }));

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
    .action(runAction(async (rawName: string) => {
      const name = validateArgument(profileNameSchema, rawName, 'profile name');

      await profileManager.setActive(name);

      emitJson(
        {
          ok: true,
          command: 'config.profile.use',
          active: name,
        },
        {
          text: () => ui.success(`Switched to profile '${name}'`),
        }
      );
    }));

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
    .action(runAction(async (rawName: string) => {
      const name = validateArgument(profileNameSchema, rawName, 'profile name');

      await profileManager.delete(name);

      emitJson(
        {
          ok: true,
          command: 'config.profile.delete',
          name,
        },
        {
          text: () => ui.success(`Deleted profile '${name}'`),
        }
      );
    }));

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
    .action(runAction(async (rawName?: string) => {
      await profileManager.initialize();

      const name = rawName
        ? validateArgument(profileNameSchema, rawName, 'profile name')
        : await profileManager.getActive();

      const profileConfig = await profileManager.read(name);
      const activeProfile = await profileManager.getActive();
      const isActive = name === activeProfile;

      emitJson(
        {
          ok: true,
          command: 'config.profile.show',
          name,
          active: isActive,
          config: profileConfig,
        },
        {
          text: () => {
            ui.info(`Profile: ${name}${isActive ? ' (active)' : ''}`);
            console.log('');

            ui.section('AI');
            ui.keyValue([
              ['enabled', profileConfig.ai.enabled ? 'yes' : 'no'],
              ...(profileConfig.ai.model
                ? [['model', profileConfig.ai.model] as [string, string]]
                : []),
            ]);
            console.log('');

            if (profileConfig.user.name || profileConfig.user.email) {
              ui.section('User');
              const userPairs: Array<[string, string]> = [];
              if (profileConfig.user.name) userPairs.push(['name', profileConfig.user.name]);
              if (profileConfig.user.email) userPairs.push(['email', profileConfig.user.email]);
              ui.keyValue(userPairs);
              console.log('');
            }

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

            ui.section('Shell');
            ui.keyValue([
              ['type', profileConfig.shell.type],
              ['rcFile', profileConfig.shell.rcFile],
            ]);
          },
        }
      );
    }));

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
    .action(runAction(async (rawName: string, options: unknown) => {
      const name = validateArgument(profileNameSchema, rawName, 'profile name');
      const validatedOptions: ProfileExportOptions = validate(
        profileExportOptionsSchema,
        options,
        'profile export options'
      );

      const jsonContent = await profileManager.export(name);

      if (validatedOptions.output) {
        await writeFile(validatedOptions.output, jsonContent, 'utf-8');
        emitJson(
          {
            ok: true,
            command: 'config.profile.export',
            name,
            output: validatedOptions.output,
          },
          {
            text: () => ui.success(`Exported profile '${name}' to ${validatedOptions.output}`),
          }
        );
      } else {
        // stdout: emit raw JSON regardless of mode — this command is defined
        // to write the profile JSON to stdout when no --output is given.
        process.stdout.write(`${jsonContent}\n`);
      }
    }));

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
    .action(runAction(async (filePath: string, options: unknown) => {
      const validatedOptions: ProfileImportOptions = validate(
        profileImportOptionsSchema,
        options,
        'profile import options'
      );

      if (validatedOptions.name) {
        validateArgument(profileNameSchema, validatedOptions.name, 'profile name');
      }

      await profileManager.initialize();

      const importedName = await profileManager.import(filePath, validatedOptions.name);

      emitJson(
        {
          ok: true,
          command: 'config.profile.import',
          name: importedName,
          sourceFile: filePath,
        },
        {
          text: () => {
            ui.success(`Imported profile '${importedName}' from ${filePath}`);
            ui.muted(`Use 'neo config profile use ${importedName}' to switch to this profile`);
          },
        }
      );
    }));

  return command;
}
