import { Command } from '@commander-js/extra-typings';
import { createAiPrCommand } from '@/commands/ai/pr/index.js';

export function createAiCommand(): Command {
  const command = new Command('ai');

  command
    .description('AI-powered helpers (pr description, review, etc.)')
    .addHelpText(
      'after',
      `
Subcommands:
  pr         Generate a PR title + body from the current branch

Examples:
  Generate a PR description and open it:
    $ neo ai pr

  Agent-friendly (emits { title, body } on stdout):
    $ neo ai pr --json --no-create
`
    );

  command.addCommand(createAiPrCommand());

  return command;
}
