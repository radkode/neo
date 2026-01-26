import { Command } from '@commander-js/extra-typings';
import { createPrCommand } from '@/commands/gh/pr/index.js';

export function createGhCommand(): Command {
  const command = new Command('gh');

  command.description('GitHub CLI operations').addCommand(createPrCommand());

  return command;
}
