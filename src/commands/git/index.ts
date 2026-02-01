import { Command } from '@commander-js/extra-typings';
import { createPushCommand } from '@/commands/git/push/index.js';
import { createPullCommand } from '@/commands/git/pull/index.js';
import { createBranchCommand } from '@/commands/git/branch/index.js';
import { createCommitCommand } from '@/commands/git/commit/index.js';
import { createStashCommand } from '@/commands/git/stash/index.js';
import { createWorktreeCommand } from '@/commands/git/worktree/index.js';

export function createGitCommand(): Command {
  const command = new Command('git');

  command
    .description('Git operations and utilities')
    .addCommand(createCommitCommand())
    .addCommand(createPushCommand())
    .addCommand(createPullCommand())
    .addCommand(createBranchCommand())
    .addCommand(createStashCommand())
    .addCommand(createWorktreeCommand());

  return command;
}
