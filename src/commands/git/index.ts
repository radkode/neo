import { Command } from '@commander-js/extra-typings';
import { createPushCommand } from '@/commands/git/push/index.js';
import { createPullCommand } from '@/commands/git/pull/index.js';
import { createBranchCommand } from '@/commands/git/branch/index.js';

export function createGitCommand(): Command {
  const command = new Command('git');

  command
    .description('Git operations and utilities')
    .addCommand(createPushCommand())
    .addCommand(createPullCommand())
    .addCommand(createBranchCommand());

  return command;
}
