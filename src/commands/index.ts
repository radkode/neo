import { Command } from '@commander-js/extra-typings';
import { createInitCommand } from '@/commands/init/index.js';
import { createConfigCommand } from '@/commands/config/index.js';
import { createGitCommand } from '@/commands/git/index.js';
import { createGhCommand } from '@/commands/gh/index.js';
import { createPrAliasCommand } from '@/commands/pr/index.js';
import { createUpdateCommand } from '@/commands/update/index.js';
import { createAliasCommand } from '@/commands/alias/index.js';
import { createAgentCommand } from '@/commands/agent/index.js';
import { createCompletionsCommand } from '@/commands/completions/index.js';

export function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createGitCommand());
  program.addCommand(createGhCommand());
  program.addCommand(createPrAliasCommand());
  program.addCommand(createAliasCommand());
  program.addCommand(createUpdateCommand());
  program.addCommand(createAgentCommand());
  program.addCommand(createCompletionsCommand());
}

export { createInitCommand } from '@/commands/init/index.js';
export { createConfigCommand } from '@/commands/config/index.js';
export { createGitCommand } from '@/commands/git/index.js';
export { createGhCommand } from '@/commands/gh/index.js';
export { createPrAliasCommand } from '@/commands/pr/index.js';
export { createAliasCommand } from '@/commands/alias/index.js';
export { createUpdateCommand } from '@/commands/update/index.js';
export { createAgentCommand } from '@/commands/agent/index.js';
export { createCompletionsCommand } from '@/commands/completions/index.js';
