import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { confirm, input, editor } from '@inquirer/prompts';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '@/utils/logger.js';
import { promptSelect } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';
import { ghPrCreateOptionsSchema } from '@/types/schemas.js';
import type { GhPrCreateOptions } from '@/types/schemas.js';
import {
  type Result,
  success,
  failure,
  isFailure,
  CommandError,
  AppError,
} from '@/core/errors/index.js';
import { detectGitError } from '@/utils/git-errors.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

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
  try {
    const { stdout } = await execa('git', ['branch', '--show-current']);
    return stdout.trim();
  } catch (error) {
    throw detectGitError(error, { commandName: 'gh-pr-create' });
  }
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
    const { stdout } = await execa('git', ['log', '--oneline', `origin/${currentBranch}..HEAD`]);
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a PR body exactly as written, from a UTF-8 file or, for `-`, from stdin. */
async function readBodyFile(bodyFile: string): Promise<Result<string>> {
  try {
    return success(bodyFile === '-' ? await readStdin() : await fs.readFile(bodyFile, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(
      new CommandError(`Could not read the PR body from ${bodyFile}: ${reason}`, 'gh-pr-create', {
        code: 'PR_BODY_FILE_UNREADABLE',
        suggestions: ['Check the path, or pass the body with --body-file - on stdin'],
      })
    );
  }
}

/**
 * Last commit subject on a branch other than the checked-out one, if it is available
 * locally.
 */
async function getLastCommitMessageOn(ref: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['log', '-1', '--format=%s', ref, '--']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Execute the PR create command logic
 */
export async function executeGhPrCreate(options: GhPrCreateOptions): Promise<Result<string>> {
  try {
    if (options.body !== undefined && options.bodyFile !== undefined) {
      return failure(
        new CommandError('Pass either --body or --body-file, not both', 'gh-pr-create', {
          code: 'PR_BODY_CONFLICT',
        })
      );
    }
    // Read the body before anything else, so an unreadable file fails without side effects.
    let bodyFromFile: string | undefined;
    if (options.bodyFile !== undefined) {
      const read = await readBodyFile(options.bodyFile);
      if (isFailure(read)) return read;
      bodyFromFile = read.data;
    }

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
    // The branch the PR comes from. With --head it need not be checked out, so the
    // checked-out branch is neither guarded nor pushed.
    const headBranch = options.head ?? currentBranch;

    // Check if on default branch
    const defaultBranch = await getDefaultBranch();
    if (options.head !== undefined) {
      const headName = headBranch.slice(headBranch.indexOf(':') + 1);
      if (headName === (options.base ?? defaultBranch) && !headBranch.includes(':')) {
        return failure(
          new CommandError(`Cannot create a PR from ${headBranch} into itself`, 'gh-pr-create', {
            suggestions: ['Pass a different --head or --base'],
          })
        );
      }
    } else if (currentBranch === defaultBranch) {
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
    if (options.head === undefined && (await hasUnpushedCommits())) {
      const remoteBranchExists = await branchExistsOnRemote();

      if (!remoteBranchExists) {
        ui.warn('Branch has not been pushed to remote yet');
      } else {
        ui.warn('You have unpushed commits');
      }

      const rtCtx = getRuntimeContext();
      let shouldPush: boolean;
      if (rtCtx.yes || rtCtx.nonInteractive) {
        // Default "yes" — pushing is the expected prelude to creating a PR.
        shouldPush = true;
      } else {
        shouldPush = await confirm({
          message: 'Push changes to remote before creating PR?',
          default: true,
        });
      }

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
        } catch (error) {
          pushSpinner.fail('Failed to push to remote');
          return failure(
            detectGitError(error, { commandName: 'gh-pr-create', branchName: currentBranch })
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

    const rtCtxForInputs = getRuntimeContext();

    // Get title
    let title = options.title;
    if (!title) {
      const branchTitle = generateTitleFromBranch(headBranch.slice(headBranch.indexOf(':') + 1));
      const lastCommit =
        options.head === undefined
          ? await getLastCommitMessage()
          : await getLastCommitMessageOn(headBranch);
      const titleSuggestion = lastCommit || branchTitle;

      if (rtCtxForInputs.yes || rtCtxForInputs.nonInteractive) {
        title = titleSuggestion;
      } else {
        title = await input({
          message: 'PR title:',
          default: titleSuggestion,
          validate: (value: string) => {
            if (!value.trim()) return 'PR title cannot be empty';
            return true;
          },
        });
      }
    }

    // Get body
    let body = bodyFromFile ?? options.body;
    if (!body && bodyFromFile === undefined) {
      const template = await findPrTemplate();
      if (template) {
        ui.info('Found PR template');
      }

      if (rtCtxForInputs.yes || rtCtxForInputs.nonInteractive) {
        // Agent default: use the template if present, otherwise no body.
        body = template ?? '';
      } else {
        const wantBody = await confirm({
          message: 'Add a description?',
          default: !!template,
        });

        if (wantBody) {
          body = await editor({
            message: 'PR description:',
            default: template || '',
          });
        }
      }
    }

    // Ask about draft (promptSelect already honors yes/non-interactive with a safe default)
    let isDraft = options.draft;
    if (isDraft === undefined) {
      const draftChoice = await promptSelect({
        message: 'PR type:',
        choices: [
          { label: 'Ready for review', value: 'ready' },
          { label: 'Draft PR', value: 'draft' },
        ],
        defaultValue: 'ready',
        flag: '--draft',
        safeDefaultForNonInteractive: true,
      });
      isDraft = draftChoice === 'draft';
    }

    // Build gh pr create command args. The body goes to gh on stdin, so it never appears
    // in the process list, shell history, debug logs, or execa error messages.
    const prArgs = ['pr', 'create', '--title', title!, '--base', baseBranch];
    if (options.head !== undefined) {
      prArgs.push('--head', headBranch);
    }
    prArgs.push('--body-file', '-');

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
      const { stdout } = await execa('gh', prArgs, { input: body ?? '' });
      createSpinner.succeed('Pull request created!');

      const prUrl = stdout.trim();
      ui.success(`PR URL: ${prUrl}`);

      emitJson(
        {
          ok: true,
          command: 'gh.pr.create',
          url: prUrl,
          title,
          base: baseBranch,
          head: headBranch,
          draft: Boolean(isDraft),
          reviewers: options.reviewer ?? [],
          labels: options.label ?? [],
        },
        { text: () => {} }
      );

      return success(prUrl);
    } catch (ghError: unknown) {
      createSpinner.fail('Failed to create pull request');

      const errorMessage = ghError instanceof Error ? ghError.message : String(ghError);

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
    // Already-classified errors carry their own code and suggestions.
    if (error instanceof AppError) {
      return failure(error);
    }
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
    .option('-F, --body-file <path>', 'read the PR description from a file ("-" reads stdin)')
    .option('-B, --base <branch>', 'base branch for the PR')
    .option('-H, --head <branch>', 'branch to open the PR from (default: the current branch)')
    .option('-d, --draft', 'create as draft PR')
    .option('-r, --reviewer <reviewers...>', 'request reviewers')
    .option('-l, --label <labels...>', 'add labels')
    .option('-w, --web', 'open PR in browser after creation')
    .addHelpText(
      'after',
      `
Examples:
  Interactive wizard:
    $ neo gh pr create

  Fully-specified:
    $ neo gh pr create --title "Add X" --body "..." --base main

  Multi-paragraph body from a file (or "-" for stdin):
    $ neo gh pr create --title "Add X" --body-file pr.md --base main

  PR for a branch that is not checked out:
    $ neo gh pr create --head feature/x --title "Add X" --body-file pr.md

  Agent-friendly (auto-fills title from commit + pushes first):
    $ neo gh pr create --yes --json
`
    )
    .action(
      runAction(async (options: unknown) => {
        const validatedOptions: GhPrCreateOptions = validate(
          ghPrCreateOptionsSchema,
          options,
          'gh pr create options'
        );

        const result = await executeGhPrCreate(validatedOptions);
        if (isFailure(result)) {
          throw result.error;
        }
      })
    );

  return command;
}
