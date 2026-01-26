import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '@/utils/logger.js';
import { promptSelect } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { ghPrCreateOptionsSchema } from '@/types/schemas.js';
import type { GhPrCreateOptions } from '@/types/schemas.js';
import { type Result, success, failure, isFailure, CommandError } from '@/core/errors/index.js';

/**
 * Check if GitHub CLI is installed
 */
async function isGhInstalled(): Promise<boolean> {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user is authenticated with GitHub CLI
 */
async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execa('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

/**
 * Get the default branch (main/master/develop)
 */
async function getDefaultBranch(): Promise<string> {
  try {
    // Try to get the default branch from remote
    const { stdout } = await execa('git', ['remote', 'show', 'origin']);
    const match = stdout.match(/HEAD branch: (.+)/);
    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    // Fallback to checking common branch names
  }

  // Check if common default branches exist
  for (const branch of ['main', 'master', 'develop']) {
    try {
      await execa('git', ['rev-parse', '--verify', `refs/heads/${branch}`]);
      return branch;
    } catch {
      // Branch doesn't exist, continue
    }
  }

  return 'main';
}

/**
 * Check if there are unpushed commits
 */
async function hasUnpushedCommits(): Promise<boolean> {
  try {
    const currentBranch = await getCurrentBranch();
    const { stdout } = await execa('git', [
      'log',
      '--oneline',
      `origin/${currentBranch}..HEAD`,
    ]);
    return stdout.trim().length > 0;
  } catch {
    // If origin branch doesn't exist, there are unpushed commits
    return true;
  }
}

/**
 * Check if the current branch has been pushed to remote
 */
async function branchExistsOnRemote(): Promise<boolean> {
  try {
    const currentBranch = await getCurrentBranch();
    await execa('git', ['ls-remote', '--exit-code', '--heads', 'origin', currentBranch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a title suggestion from branch name
 */
function generateTitleFromBranch(branchName: string): string {
  // Remove common prefixes
  let title = branchName.replace(/^(feature|fix|bugfix|hotfix|chore|docs)\//, '');

  // Replace separators with spaces
  title = title.replace(/[-_]/g, ' ');

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return title;
}

/**
 * Get the last commit message
 */
async function getLastCommitMessage(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['log', '-1', '--format=%s']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Look for PR template files
 */
async function findPrTemplate(): Promise<string | null> {
  const templatePaths = [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/pull_request_template.md',
    'PULL_REQUEST_TEMPLATE.md',
    'pull_request_template.md',
    'docs/PULL_REQUEST_TEMPLATE.md',
  ];

  for (const templatePath of templatePaths) {
    try {
      const fullPath = path.join(process.cwd(), templatePath);
      const content = await fs.readFile(fullPath, 'utf8');
      return content;
    } catch {
      // Template doesn't exist, continue
    }
  }

  return null;
}

/**
 * Execute the PR create command logic
 */
export async function executeGhPrCreate(options: GhPrCreateOptions): Promise<Result<string>> {
  try {
    // Check if gh CLI is installed
    if (!(await isGhInstalled())) {
      return failure(
        new CommandError('GitHub CLI (gh) is not installed', 'gh-pr-create', {
          suggestions: [
            'Install GitHub CLI: https://cli.github.com/',
            'macOS: brew install gh',
            'Ubuntu: sudo apt install gh',
          ],
        })
      );
    }

    // Check if authenticated
    if (!(await isGhAuthenticated())) {
      return failure(
        new CommandError('Not authenticated with GitHub CLI', 'gh-pr-create', {
          suggestions: ['Run: gh auth login'],
        })
      );
    }

    const currentBranch = await getCurrentBranch();
    logger.debug(`Current branch: ${currentBranch}`);

    // Check if on default branch
    const defaultBranch = await getDefaultBranch();
    if (currentBranch === defaultBranch) {
      return failure(
        new CommandError(`Cannot create PR from ${defaultBranch} branch`, 'gh-pr-create', {
          suggestions: [
            'Create a feature branch: git checkout -b feature/your-feature',
            'Make your changes and commit them',
            'Then run: neo pr',
          ],
        })
      );
    }

    // Check for unpushed commits
    if (await hasUnpushedCommits()) {
      const remoteBranchExists = await branchExistsOnRemote();

      if (!remoteBranchExists) {
        ui.warn('Branch has not been pushed to remote yet');
      } else {
        ui.warn('You have unpushed commits');
      }

      const { shouldPush } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldPush',
          message: 'Push changes to remote before creating PR?',
          default: true,
        },
      ]);

      if (shouldPush) {
        const pushSpinner = ui.spinner('Pushing to remote');
        pushSpinner.start();
        try {
          if (!remoteBranchExists) {
            await execa('git', ['push', '-u', 'origin', currentBranch]);
          } else {
            await execa('git', ['push', 'origin', currentBranch]);
          }
          pushSpinner.succeed('Pushed to remote');
        } catch {
          pushSpinner.fail('Failed to push to remote');
          return failure(
            new CommandError('Failed to push changes to remote', 'gh-pr-create', {
              suggestions: ['Resolve any conflicts and try again'],
            })
          );
        }
      } else {
        ui.info('Skipping push. Note: PR will only include already pushed commits.');
      }
    }

    // Determine base branch
    let baseBranch = options.base;
    if (!baseBranch) {
      baseBranch = defaultBranch;
      ui.info(`Using base branch: ${baseBranch}`);
    }

    // Get title
    let title = options.title;
    if (!title) {
      const branchTitle = generateTitleFromBranch(currentBranch);
      const lastCommit = await getLastCommitMessage();

      const titleSuggestion = lastCommit || branchTitle;

      const { prTitle } = await inquirer.prompt([
        {
          type: 'input',
          name: 'prTitle',
          message: 'PR title:',
          default: titleSuggestion,
          validate: (input: string) => {
            if (!input.trim()) {
              return 'PR title cannot be empty';
            }
            return true;
          },
        },
      ]);
      title = prTitle;
    }

    // Get body
    let body = options.body;
    if (!body) {
      const template = await findPrTemplate();

      if (template) {
        ui.info('Found PR template');
      }

      const { wantBody } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'wantBody',
          message: 'Add a description?',
          default: !!template,
        },
      ]);

      if (wantBody) {
        const { prBody } = await inquirer.prompt([
          {
            type: 'editor',
            name: 'prBody',
            message: 'PR description:',
            default: template || '',
          },
        ]);
        body = prBody;
      }
    }

    // Ask about draft
    let isDraft = options.draft;
    if (isDraft === undefined) {
      const draftChoice = await promptSelect({
        message: 'PR type:',
        choices: [
          { label: 'Ready for review', value: 'ready' },
          { label: 'Draft PR', value: 'draft' },
        ],
        defaultValue: 'ready',
      });
      isDraft = draftChoice === 'draft';
    }

    // Build gh pr create command args
    const prArgs = ['pr', 'create', '--title', title!, '--base', baseBranch];

    if (body) {
      prArgs.push('--body', body);
    } else {
      prArgs.push('--body', '');
    }

    if (isDraft) {
      prArgs.push('--draft');
    }

    if (options.reviewer && options.reviewer.length > 0) {
      for (const reviewer of options.reviewer) {
        prArgs.push('--reviewer', reviewer);
      }
    }

    if (options.label && options.label.length > 0) {
      for (const label of options.label) {
        prArgs.push('--label', label);
      }
    }

    if (options.web) {
      prArgs.push('--web');
    }

    logger.debug(`Executing: gh ${prArgs.join(' ')}`);

    const createSpinner = ui.spinner('Creating pull request');
    createSpinner.start();

    try {
      const { stdout } = await execa('gh', prArgs);
      createSpinner.succeed('Pull request created!');

      const prUrl = stdout.trim();
      ui.success(`PR URL: ${prUrl}`);

      return success(prUrl);
    } catch (ghError: unknown) {
      createSpinner.fail('Failed to create pull request');

      const errorMessage =
        ghError instanceof Error ? ghError.message : String(ghError);

      // Check for common errors
      if (errorMessage.includes('already exists')) {
        return failure(
          new CommandError('A pull request already exists for this branch', 'gh-pr-create', {
            suggestions: ['View existing PR: gh pr view --web'],
          })
        );
      }

      return failure(
        new CommandError(`Failed to create PR: ${errorMessage}`, 'gh-pr-create', {
          suggestions: ['Check your GitHub CLI configuration: gh auth status'],
        })
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return failure(new CommandError(`Unexpected error: ${errorMessage}`, 'gh-pr-create'));
  }
}

export function createPrCreateCommand(): Command {
  const command = new Command('create');

  command
    .description('Create a pull request on GitHub')
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
        validatedOptions = validate(ghPrCreateOptionsSchema, options, 'gh pr create options');
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
