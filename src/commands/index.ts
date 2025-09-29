import { Command } from '@commander-js/extra-typings';
import { createInitCommand } from './init/index.js';
import { createConfigCommand } from './config/index.js';
import { createGitCommand } from './git/index.js';

export function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createGitCommand());
}

export { createInitCommand } from './init/index.js';
export { createConfigCommand } from './config/index.js';
export { createGitCommand } from './git/index.js';
