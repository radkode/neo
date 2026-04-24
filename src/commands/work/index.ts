import { Command } from '@commander-js/extra-typings';
import { createWorkStartCommand } from '@/commands/work/start/index.js';

export function createWorkCommand(): Command {
  const command = new Command('work');

  command
    .description('Workflow commands: start, ship, and finish a piece of work')
    .addHelpText(
      'after',
      `
Subcommands:
  start <name>   Create a new prefixed branch (optionally in a worktree)

Examples:
  Start a new change:
    $ neo work start fix-login-redirect

  Start in a worktree:
    $ neo work start fix-login-redirect --worktree
`
    );

  command.addCommand(createWorkStartCommand());

  return command;
}
