import { Command } from '@commander-js/extra-typings';
import { createAgentInitCommand } from '@/commands/agent/init/index.js';
import { createAgentContextCommand } from '@/commands/agent/context/index.js';

/**
 * Create the main agent command with all subcommands
 */
export function createAgentCommand(): Command {
  const command = new Command('agent');

  command
    .description('Manage AI agent context and configuration')
    .addCommand(createAgentInitCommand())
    .addCommand(createAgentContextCommand());

  return command;
}
