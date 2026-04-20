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
    .addCommand(createAgentContextCommand())
    .addHelpText(
      'after',
      `
Agent-friendly usage:
  $ neo agent context list --json
  $ neo agent context add "Important fact" --tag important --json
  $ neo agent context remove <id> --yes --json
`
    );

  return command;
}
