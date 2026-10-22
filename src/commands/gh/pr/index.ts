import { Command } from '@commander-js/extra-typings';
import { createPrCreateCommand } from '@/commands/gh/pr/create/index.js';
import { createPrMergeCommand } from '@/commands/gh/pr/merge/index.js';
import { createPrStatusCommand } from '@/commands/gh/pr/status/index.js';

export function createPrCommand(): Command {
  const command = new Command('pr');

  command
    .description('Pull request operations')
    .addCommand(createPrCreateCommand())
    .addCommand(createPrMergeCommand())
    .addCommand(createPrStatusCommand());

  return command;
}
