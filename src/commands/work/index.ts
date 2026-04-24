import { Command } from '@commander-js/extra-typings';
import { createWorkStartCommand } from '@/commands/work/start/index.js';
import { createWorkShipCommand } from '@/commands/work/ship/index.js';
import { createWorkFinishCommand } from '@/commands/work/finish/index.js';

export function createWorkCommand(): Command {
  const command = new Command('work');

  command
    .description('Workflow commands: start, ship, and finish a piece of work')
    .addHelpText(
      'after',
      `
Subcommands:
  start <name>    Create a new prefixed branch (optionally in a worktree)
  ship            Verify + ensure changeset + push + open PR for the current branch
  finish [branch] After merge: switch to base, pull, delete the local branch + worktree

Examples:
  Start a new change:
    $ neo work start fix-login-redirect

  Start in a worktree:
    $ neo work start fix-login-redirect --worktree

  Ship the current branch:
    $ neo work ship

  After the PR merged:
    $ neo work finish
`
    );

  command.addCommand(createWorkStartCommand());
  command.addCommand(createWorkShipCommand());
  command.addCommand(createWorkFinishCommand());

  return command;
}
