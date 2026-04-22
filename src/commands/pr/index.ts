import { Command } from '@commander-js/extra-typings';
import { validate } from '@/utils/validation.js';
import { ghPrCreateOptionsSchema } from '@/types/schemas.js';
import type { GhPrCreateOptions } from '@/types/schemas.js';
import { isFailure } from '@/core/errors/index.js';
import { runAction } from '@/utils/run-action.js';
import { executeGhPrCreate } from '@/commands/gh/pr/create/index.js';

export function createPrAliasCommand(): Command {
  const command = new Command('pr');

  command
    .description('Create a pull request (alias for gh pr create)')
    .option('-t, --title <title>', 'PR title')
    .option('-b, --body <body>', 'PR description')
    .option('-B, --base <branch>', 'base branch for the PR')
    .option('-d, --draft', 'create as draft PR')
    .option('-r, --reviewer <reviewers...>', 'request reviewers')
    .option('-l, --label <labels...>', 'add labels')
    .option('-w, --web', 'open PR in browser after creation')
    .action(runAction(async (options: unknown) => {
      const validatedOptions: GhPrCreateOptions = validate(
        ghPrCreateOptionsSchema,
        options,
        'pr options'
      );

      const result = await executeGhPrCreate(validatedOptions);

      if (isFailure(result)) {
        throw result.error;
      }
    }));

  return command;
}
