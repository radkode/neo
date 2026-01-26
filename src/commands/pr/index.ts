import { Command } from '@commander-js/extra-typings';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { ghPrCreateOptionsSchema } from '@/types/schemas.js';
import type { GhPrCreateOptions } from '@/types/schemas.js';
import { isFailure } from '@/core/errors/index.js';
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
    .action(async (options: unknown) => {
      let validatedOptions: GhPrCreateOptions;
      try {
        validatedOptions = validate(ghPrCreateOptionsSchema, options, 'pr options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      const result = await executeGhPrCreate(validatedOptions);

      if (isFailure(result)) {
        ui.error(result.error.message);
        if (result.error.suggestions && result.error.suggestions.length > 0) {
          ui.warn('Suggestions:');
          ui.list(result.error.suggestions);
        }
        process.exit(1);
      }
    });

  return command;
}
