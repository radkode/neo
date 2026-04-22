import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitCommitOptionsSchema } from '@/types/schemas.js';
import type { GitCommitOptions, CommitType } from '@/types/schemas.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { generateCommitMessage, isAICommitAvailable, AIErrors } from '@/services/ai/index.js';
import type { AICommitResponse } from '@/services/ai/index.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { emitJson, emitError } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

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
 * Check if error is "nothing to commit" error
 */
function isNothingToCommitError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return errorMessage.includes('nothing to commit');
}

/**
 * Get the staged diff content
 */
async function getStagedDiff(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['diff', '--cached']);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Get recent commit messages for context
 */
async function getRecentCommits(count: number = 5): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['log', '--oneline', `-${count}`]);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['branch', '--show-current']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * AI commit action choices
 */
type AICommitAction = 'commit' | 'edit' | 'regenerate' | 'cancel';

/**
 * Execute AI-powered commit flow
 */
async function executeAICommit(stagedFiles: string[]): Promise<Result<AICommitResponse | null>> {
  // Check if API key is available
  if (!(await isAICommitAvailable())) {
    return failure(AIErrors.missingApiKey());
  }

  // Get context for AI
  const [diff, recentCommits, branchName] = await Promise.all([
    getStagedDiff(),
    getRecentCommits(5),
    getCurrentBranch(),
  ]);

  if (!diff) {
    return failure(GitErrors.noStagedChanges('commit'));
  }

  // Generate commit message with spinner
  const spinner = ui.spinner('Generating commit message with AI...');
  spinner.start();

  const result = await generateCommitMessage({
    diff,
    recentCommits,
    branchName,
    stagedFiles,
  });

  if (isFailure(result)) {
    spinner.fail('Failed to generate commit message');
    return result;
  }

  spinner.succeed('Generated commit message');
  return success(result.data);
}

/**
 * Execute the commit command logic
 * Returns a Result indicating success or failure
 */
export async function executeCommit(options: GitCommitOptions): Promise<Result<void>> {
  try {
    // Check if we're in a git repository
    await execa('git', ['rev-parse', '--git-dir']);

    // Stage all files if --all flag is provided
    if (options.all) {
      const spinner = ui.spinner('Staging modified files');
      spinner.start();
      try {
        await execa('git', ['add', '-u']);
        spinner.succeed('Staged all modified files');
      } catch (error) {
        spinner.fail('Failed to stage files');
        return failure(GitErrors.unknown('commit', error));
      }
    }

    // Check for staged changes
    const hasStaged = await hasStagedChanges();
    if (!hasStaged) {
      return failure(GitErrors.noStagedChanges('commit'));
    }

    // Show staged files
    const stagedFiles = await getStagedFiles();
    ui.section('Staged Files');
    ui.list(stagedFiles.slice(0, 10));
    if (stagedFiles.length > 10) {
      ui.muted(`... and ${stagedFiles.length - 10} more files`);
    }
    ui.newline();

    let commitType: CommitType;
    let commitScope: string | undefined;
    let commitMessage: string;
    let commitBody: string | undefined;
    let isBreaking: boolean;

    // AI-powered commit flow
    if (options.ai) {
      let aiResponse: AICommitResponse | null = null;
      let action: AICommitAction = 'regenerate';

      // Loop for regenerate option
      while (action === 'regenerate') {
        const aiResult = await executeAICommit(stagedFiles);

        if (isFailure(aiResult)) {
          return aiResult;
        }

        aiResponse = aiResult.data;
        if (!aiResponse) {
          return failure(GitErrors.unknown('commit', new Error('No AI response')));
        }

        // Show AI-generated message preview
        ui.newline();
        ui.section('AI-Generated Commit');
        const previewMessage = formatCommitMessage(
          aiResponse.type,
          aiResponse.scope,
          aiResponse.message,
          aiResponse.body,
          aiResponse.breaking
        );
        ui.code(previewMessage);
        ui.newline();

        // Ask what to do. In non-interactive/yes mode, accept the AI output
        // directly — this is the behavior agents want from `--ai`.
        const runtimeCtx = getRuntimeContext();
        if (runtimeCtx.yes || runtimeCtx.nonInteractive) {
          action = 'commit';
        } else {
          const { selectedAction } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedAction',
              message: 'What would you like to do?',
              choices: [
                { name: 'Commit with this message', value: 'commit' },
                { name: 'Edit in wizard', value: 'edit' },
                { name: 'Regenerate', value: 'regenerate' },
                { name: 'Cancel', value: 'cancel' },
              ],
            },
          ]);
          action = selectedAction as AICommitAction;
        }
      }

      if (action === 'cancel') {
        ui.warn('Commit cancelled');
        return success(undefined);
      }

      if (action === 'commit' && aiResponse) {
        // Commit directly with AI-generated message
        commitType = aiResponse.type;
        commitScope = aiResponse.scope;
        commitMessage = aiResponse.message;
        commitBody = aiResponse.body;
        isBreaking = aiResponse.breaking;

        // Format and create commit
        const formattedMessage = formatCommitMessage(
          commitType,
          commitScope,
          commitMessage,
          commitBody,
          isBreaking
        );

        const spinner = ui.spinner('Creating commit');
        spinner.start();

        try {
          await execa('git', ['commit', '-m', formattedMessage]);
          spinner.succeed('Commit created successfully!');

          const { stdout: commitHash } = await execa('git', ['rev-parse', '--short', 'HEAD']);
          ui.info(`Commit: ${commitHash.trim()}`);

          return success(undefined);
        } catch (error) {
          spinner.fail('Failed to create commit');
          return failure(GitErrors.unknown('commit', error));
        }
      }

      // action === 'edit' - Fall through to interactive mode with AI values pre-filled
      if (aiResponse) {
        options = {
          ...options,
          type: aiResponse.type,
          scope: aiResponse.scope,
          message: aiResponse.message,
          body: aiResponse.body,
          breaking: aiResponse.breaking,
        };
      }
    }

    const runtimeCtx = getRuntimeContext();
    // Quick mode: all required fields provided OR agent mode with sensible inputs.
    // In non-interactive/yes mode, we can't prompt — require the essentials up front.
    const quickMode =
      options.type !== undefined && options.message !== undefined;

    if (!quickMode && (runtimeCtx.yes || runtimeCtx.nonInteractive)) {
      if (!options.type || !options.message) {
        throw new NonInteractiveError(
          'git commit requires --type and --message in non-interactive mode',
          '--type <type> --message <msg>'
        );
      }
    }

    if (quickMode) {
      // Quick commit mode with CLI options
      commitType = options.type!;
      commitScope = options.scope;
      commitMessage = options.message!;
      commitBody = options.body;
      isBreaking = options.breaking || false;
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
          default: options.type,
        },
        {
          type: 'input',
          name: 'scope',
          message: 'Scope of the change (optional, lowercase):',
          default: options.scope,
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
          default: options.message,
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
          default: options.body,
        },
        {
          type: 'confirm',
          name: 'breaking',
          message: 'Is this a breaking change?',
          default: options.breaking || false,
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
    ui.newline();
    ui.section('Commit Preview');
    ui.keyValue([
      ['Type', commitType],
      ['Scope', commitScope || '(none)'],
      ['Breaking', isBreaking ? 'Yes' : 'No'],
    ]);
    ui.newline();
    ui.highlight('Full commit message:');
    ui.newline();
    ui.muted(formattedMessage);
    ui.newline();

    // Confirm commit (skip in quick/yes/non-interactive mode).
    if (!quickMode && !runtimeCtx.yes && !runtimeCtx.nonInteractive) {
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
        return success(undefined);
      }
    }

    // Create the commit
    const spinner = ui.spinner('Creating commit');
    spinner.start();

    try {
      await execa('git', ['commit', '-m', formattedMessage]);
      spinner.succeed('Commit created successfully!');

      const { stdout: commitHash } = await execa('git', ['rev-parse', '--short', 'HEAD']);
      emitJson(
        {
          ok: true,
          command: 'git.commit',
          commit: commitHash.trim(),
          type: commitType,
          scope: commitScope ?? null,
          message: commitMessage,
          breaking: isBreaking,
          files: stagedFiles,
        },
        { text: () => ui.info(`Commit: ${commitHash.trim()}`) }
      );

      return success(undefined);
    } catch (error) {
      spinner.fail('Failed to create commit');
      return failure(GitErrors.unknown('commit', error));
    }
  } catch (error: unknown) {
    // Use shared git error detection
    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('commit'));
    }

    if (isNothingToCommitError(error)) {
      return failure(GitErrors.nothingToCommit('commit'));
    }

    return failure(GitErrors.unknown('commit', error));
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
    .option('--ai', 'generate commit message using AI')
    .addHelpText(
      'after',
      `
Examples:
  Interactive wizard:
    $ neo git commit

  Quick commit (no prompts):
    $ neo git commit --type fix --message "handle null token"

  AI-drafted commit, auto-accept (agent-friendly):
    $ neo git commit --ai --yes

  Machine-readable output:
    $ neo git commit --ai --yes --json
`
    )
    .action(runAction(async (options: unknown) => {
      let validatedOptions: GitCommitOptions;
      try {
        validatedOptions = validate(gitCommitOptionsSchema, options, 'git commit options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      const result = await executeCommit(validatedOptions);
      if (isFailure(result)) {
        emitError(result.error);
        process.exit(1);
      }
    }));

  return command;
}
