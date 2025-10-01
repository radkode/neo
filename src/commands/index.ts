import { Command } from '@commander-js/extra-typings';
import { createInitCommand } from '@/commands/init/index.js';
import { createConfigCommand } from '@/commands/config/index.js';
import { createGitCommand } from '@/commands/git/index.js';
import { createUpdateCommand } from '@/commands/update/index.js';

export function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createGitCommand());
  program.addCommand(createUpdateCommand());
}

export { createInitCommand } from '@/commands/init/index.js';
export { createConfigCommand } from '@/commands/config/index.js';
export { createGitCommand } from '@/commands/git/index.js';
export { createUpdateCommand } from '@/commands/update/index.js';
