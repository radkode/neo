import { Command } from '@commander-js/extra-typings';
import { createSetupCommand } from '@/commands/alias/setup/index.js';

/**
 * Creates the alias command with all subcommands
 *
 * @returns The configured alias command
 */
export function createAliasCommand(): Command {
  const command = new Command('alias');

  command.description('Manage shell aliases for Neo CLI').addCommand(createSetupCommand());

  return command;
}
