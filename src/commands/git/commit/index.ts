import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitCommitOptionsSchema } from '@/types/schemas.js';
import type { GitCommitOptions, CommitType } from '@/types/schemas.js';

/**
 * Commit type descriptions for the interactive wizard
 */
const COMMIT_TYPE_DESCRIPTIONS: Record<CommitType, string> = {
  feat: 'A new feature',
  fix: 'A bug fix',
  docs: 'Documentation changes',
  style: 'Code style changes (formatting, semicolons, etc)',
  refactor: 'Code refactoring (no feature or bug fix)',
  test: 'Adding or updating tests',
  chore: 'Build process, tooling, or dependencies',
};

/**
 * Format a conventional commit message
 */
function formatCommitMessage(
  type: string,
  scope: string | undefined,
  message: string,
  body: string | undefined,
  breaking: boolean
): string {
  let commitMsg = type;

  if (scope) {
    commitMsg += `(${scope})`;
  }

  if (breaking) {
    commitMsg += '!';
  }

  commitMsg += `: ${message}`;

  if (body) {
    commitMsg += `\n\n${body}`;
  }

  if (breaking && body) {
    commitMsg += '\n\nBREAKING CHANGE: This commit contains breaking changes.';
  }

  return commitMsg;
}

/**
 * Check if there are staged changes
 */
async function hasStagedChanges(): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['diff', '--cached', '--name-only']);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get list of staged files
 */
async function getStagedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['diff', '--cached', '--name-only']);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create the git commit command
 */
export function createCommitCommand(): Command {
  const command = new Command('commit');

  command
    .description('Create a conventional commit with interactive wizard')
    .option('-t, --type <type>', 'commit type (feat, fix, docs, style, refactor, test, chore)')
    .option('-s, --scope <scope>', 'commit scope (optional)')
    .option('-m, --message <message>', 'commit message description')
    .option('-b, --body <body>', 'commit body (optional)')
    .option('--breaking', 'mark as breaking change')
    .option('-a, --all', 'automatically stage all modified files')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: GitCommitOptions;
      try {
        validatedOptions = validate(gitCommitOptionsSchema, options, 'git commit options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        // Check if we're in a git repository
        await execa('git', ['rev-parse', '--git-dir']);

        // Stage all files if --all flag is provided
        if (validatedOptions.all) {
          const spinner = ui.spinner('Staging modified files');
          spinner.start();
          try {
            await execa('git', ['add', '-u']);
            spinner.succeed('Staged all modified files');
          } catch (error) {
            spinner.fail('Failed to stage files');
            throw error;
          }
        }

        // Check for staged changes
        const hasStaged = await hasStagedChanges();
        if (!hasStaged) {
          ui.warn('No files staged for commit');
          ui.info('Stage files before committing:');
          ui.list([
            'Stage specific files: git add <file>',
            'Stage all changes: git add .',
            'Use --all flag: neo git commit --all',
          ]);
          process.exit(1);
        }

        // Show staged files
        const stagedFiles = await getStagedFiles();
        ui.section('Staged Files');
        ui.list(stagedFiles.slice(0, 10));
        if (stagedFiles.length > 10) {
          ui.muted(`... and ${stagedFiles.length - 10} more files`);
        }
        console.log('');

        let commitType: CommitType;
        let commitScope: string | undefined;
        let commitMessage: string;
        let commitBody: string | undefined;
        let isBreaking: boolean;

        // Check if we're in quick mode (all options provided)
        const quickMode =
          validatedOptions.type !== undefined && validatedOptions.message !== undefined;

        if (quickMode) {
          // Quick commit mode with CLI options
          commitType = validatedOptions.type!;
          commitScope = validatedOptions.scope;
          commitMessage = validatedOptions.message!;
          commitBody = validatedOptions.body;
          isBreaking = validatedOptions.breaking || false;
        } else {
          // Interactive mode
          ui.section('Conventional Commit Wizard');

          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'type',
              message: 'Select the type of change:',
              choices: Object.entries(COMMIT_TYPE_DESCRIPTIONS).map(([value, description]) => ({
                name: `${value.padEnd(10)} - ${description}`,
                value,
                short: value,
              })),
              default: validatedOptions.type,
            },
            {
              type: 'input',
              name: 'scope',
              message: 'Scope of the change (optional, lowercase):',
              default: validatedOptions.scope,
              validate: (input: string) => {
                if (!input) return true; // Optional
                if (!/^[a-z][a-z0-9-]*$/.test(input)) {
                  return 'Scope must be lowercase and alphanumeric with hyphens';
                }
                return true;
              },
            },
            {
              type: 'input',
              name: 'message',
              message: 'Short description (max 100 chars):',
              default: validatedOptions.message,
              validate: (input: string) => {
                if (!input || input.trim().length === 0) {
                  return 'Message is required';
                }
                if (input.length > 100) {
                  return 'Message too long (max 100 characters)';
                }
                return true;
              },
            },
            {
              type: 'input',
              name: 'body',
              message: 'Longer description (optional, press Enter to skip):',
              default: validatedOptions.body,
            },
            {
              type: 'confirm',
              name: 'breaking',
              message: 'Is this a breaking change?',
              default: validatedOptions.breaking || false,
            },
          ]);

          commitType = answers.type as CommitType;
          commitScope = answers.scope || undefined;
          commitMessage = answers.message;
          commitBody = answers.body || undefined;
          isBreaking = answers.breaking;
        }

        // Format the commit message
        const formattedMessage = formatCommitMessage(
          commitType,
          commitScope,
          commitMessage,
          commitBody,
          isBreaking
        );

        // Show preview
        console.log('');
        ui.section('Commit Preview');
        ui.keyValue([
          ['Type', commitType],
          ['Scope', commitScope || '(none)'],
          ['Breaking', isBreaking ? 'Yes' : 'No'],
        ]);
        console.log('');
        ui.highlight('Full commit message:');
        console.log('');
        ui.muted(formattedMessage);
        console.log('');

        // Confirm commit
        if (!quickMode) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'Create this commit?',
              default: true,
            },
          ]);

          if (!confirm) {
            ui.warn('Commit cancelled');
            process.exit(0);
          }
        }

        // Create the commit
        const spinner = ui.spinner('Creating commit');
        spinner.start();

        try {
          await execa('git', ['commit', '-m', formattedMessage]);
          spinner.succeed('Commit created successfully!');

          // Show commit hash
          const { stdout: commitHash } = await execa('git', ['rev-parse', '--short', 'HEAD']);
          ui.info(`Commit: ${commitHash.trim()}`);
        } catch (error) {
          spinner.fail('Failed to create commit');
          throw error;
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          if (error.message?.includes('not a git repository')) {
            ui.error('Not a git repository!');
            ui.warn('Make sure you are in a git repository directory');
            process.exit(1);
          }

          if (error.message?.includes('nothing to commit')) {
            ui.error('Nothing to commit');
            ui.warn('All changes are already committed');
            process.exit(1);
          }
        }

        ui.error('Failed to create commit');
        ui.muted(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}
