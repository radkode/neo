import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { promptSelect } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitPullOptionsSchema, deletedBranchActionSchema } from '@/types/schemas.js';
import type { GitPullOptions } from '@/types/schemas.js';
import {
  type Result,
  success,
  failure,
  isFailure,
  CommandError,
} from '@/core/errors/index.js';

/**
 * Execute the pull command logic
 * Returns a Result indicating success or failure
 */
export async function executePull(options: GitPullOptions): Promise<Result<void>> {
  const spinner = ui.spinner('Pulling from remote');
  let branchName = '';

  try {
    // Get current branch name
    const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
    branchName = currentBranch.trim();

    logger.debug(`Current branch: ${branchName}`);

    // Check if branch has an upstream
    try {
      await execa('git', ['rev-parse', '--abbrev-ref', '@{u}']);
    } catch {
      return failure(
        new CommandError('No upstream branch configured!', 'pull', {
          suggestions: [
            `Set an upstream branch first: git branch --set-upstream-to=origin/${branchName} ${branchName}`,
            `Or push with upstream: neo git push -u ${branchName}`,
          ],
        })
      );
    }

    spinner.start();

    // If user explicitly requested rebase, use it directly
    if (options.rebase) {
      logger.debug('Using rebase strategy (user specified)');
      spinner.text = 'Pulling with rebase...';

      const { stdout } = await execa('git', ['pull', '--rebase'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });

      spinner.succeed('Successfully pulled with rebase!');

      if (stdout.trim()) {
        ui.muted(stdout);
      }

      return success(undefined);
    }

    // Try normal pull first
    logger.debug('Attempting normal pull...');

    try {
      const { stdout } = await execa('git', ['pull'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });

      spinner.succeed('Successfully pulled from remote!');

      if (stdout.trim()) {
        ui.muted(stdout);
      }

      return success(undefined);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const shortMessage = (error as { shortMessage?: string }).shortMessage ?? '';
      const combinedMessage = `${
        error instanceof Error ? error.message : String(error)
      } ${stderr} ${shortMessage}`.toLowerCase();

      const diverged =
        combinedMessage.includes('divergent') ||
        combinedMessage.includes('diverging') ||
        combinedMessage.includes('fast-forward') ||
        combinedMessage.includes('pull.ff') ||
        combinedMessage.includes('non-fast-forward') ||
        combinedMessage.includes('not possible to fast-forward');

      if (diverged) {
        spinner.stop();
        return handleDivergedPull(branchName, options);
      }

      throw error;
    }
  } catch (error: unknown) {
    spinner.stop();

    if (error instanceof Error) {
      const errorMessage = error.message;

      if (errorMessage.includes('not a git repository')) {
        return failure(
          new CommandError('Not a git repository!', 'pull', {
            suggestions: ['Make sure you are in a git repository directory'],
          })
        );
      }

      // Handle deleted remote branch
      if (
        errorMessage.includes('no such ref was fetched') ||
        errorMessage.includes('but no such ref was fetched')
      ) {
        return handleDeletedRemoteBranch(branchName);
      }

      if (errorMessage.includes('conflict')) {
        return failure(
          new CommandError('Merge conflicts detected!', 'pull', {
            suggestions: [
              'Fix conflicts in your editor',
              'Stage resolved files: git add <files>',
              'Continue rebase: git rebase --continue',
              'Or abort the rebase: git rebase --abort',
            ],
          })
        );
      }

      if (errorMessage.includes('authentication') || errorMessage.includes('permission')) {
        return failure(
          new CommandError('Authentication failed!', 'pull', {
            suggestions: ['Check your git credentials or SSH keys'],
          })
        );
      }

      if (errorMessage.includes('Could not resolve host')) {
        return failure(
          new CommandError('Network error!', 'pull', {
            suggestions: ['Check your internet connection'],
          })
        );
      }
    }

    return failure(
      new CommandError('Failed to pull from remote', 'pull', {
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

async function handleDivergedPull(
  branchName: string,
  options: GitPullOptions
): Promise<Result<void>> {
  ui.error('Local and remote branches have diverged.');
  ui.warn('Choose how to reconcile the branches.');

  const defaultStrategy: 'merge' | 'rebase' = options.noRebase ? 'merge' : 'rebase';

  const strategy = await promptSelect({
    choices: [
      {
        label: 'Cancel (do nothing)',
        value: 'cancel',
      },
      {
        label: 'Merge remote into current branch (--no-ff)',
        value: 'merge',
      },
      {
        label: 'Rebase onto remote (recommended)',
        value: 'rebase',
      },
    ],
    defaultValue: defaultStrategy,
    message: 'Branches have diverged. Choose a pull strategy:',
  });

  if (strategy === 'rebase') {
    const rebaseSpinner = ui.spinner('Pulling with rebase');
    try {
      rebaseSpinner.start();
      const { stdout } = await execa('git', ['pull', '--rebase'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      rebaseSpinner.succeed('Successfully pulled with rebase');
      ui.info('Rebased onto remote to resolve divergence');

      if (stdout.trim()) {
        ui.muted(stdout);
      }

      return success(undefined);
    } catch (error) {
      rebaseSpinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('conflict')) {
        return failure(
          new CommandError('Rebase hit conflicts.', 'pull', {
            suggestions: [
              'Fix conflicts in your editor',
              'Stage resolved files: git add <files>',
              'Continue rebase: git rebase --continue',
              'Or abort the rebase: git rebase --abort',
            ],
          })
        );
      }

      return failure(
        new CommandError('Rebase pull failed.', 'pull', {
          context: { error: message },
        })
      );
    }
  }

  if (strategy === 'merge') {
    const fetchSpinner = ui.spinner('Fetching latest changes');
    const mergeSpinner = ui.spinner('Merging remote into current branch');
    const remoteRef = branchName || 'HEAD';
    try {
      fetchSpinner.start();
      await execa('git', ['fetch', 'origin', remoteRef], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      fetchSpinner.succeed('Fetched remote updates');

      mergeSpinner.start();
      const { stdout } = await execa('git', ['merge', '--no-ff', `origin/${remoteRef}`], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      mergeSpinner.succeed('Merge completed');
      ui.info('Merged remote changes (non fast-forward)');

      if (stdout.trim()) {
        ui.muted(stdout);
      }

      return success(undefined);
    } catch (error) {
      fetchSpinner.stop();
      mergeSpinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('conflict')) {
        return failure(
          new CommandError('Merge produced conflicts.', 'pull', {
            suggestions: [
              'Fix conflicts in your editor',
              'Stage resolved files: git add <files>',
              'Commit the merge: git commit',
            ],
          })
        );
      }

      return failure(
        new CommandError('Merge pull failed.', 'pull', {
          context: { error: message },
        })
      );
    }
  }

  ui.info('Pull cancelled. No changes were applied.');
  return failure(new CommandError('Pull cancelled by user', 'pull'));
}

/**
 * Handle deleted remote branch scenario with interactive prompt
 */
async function handleDeletedRemoteBranch(branchName: string): Promise<Result<void>> {
  ui.error('Remote branch no longer exists!');
  ui.warn(`Your local branch "${branchName}" is tracking a remote branch that has been deleted`);
  console.log('');

  const validatedAction = deletedBranchActionSchema.parse(
    await promptSelect({
      choices: [
        {
          label: 'Switch to main and delete this branch (recommended)',
          value: 'switch_main_delete',
        },
        {
          label: 'Switch to main and keep this branch',
          value: 'switch_main_keep',
        },
        {
          label: `Set a new upstream for "${branchName}"`,
          value: 'set_upstream',
        },
        {
          label: 'Cancel (no changes)',
          value: 'cancel',
        },
      ],
      defaultValue: 'switch_main_delete',
      message: 'How would you like to resolve this?',
    })
  );

  switch (validatedAction) {
    case 'switch_main_delete':
      return switchToMainAndDelete(branchName);
    case 'switch_main_keep':
      return switchToMain(branchName);
    case 'set_upstream':
      return setNewUpstream(branchName);
    case 'cancel':
      ui.muted('Operation cancelled. No changes were made.');
      return success(undefined);
  }
}

/**
 * Switch to main branch and delete the current branch
 */
async function switchToMainAndDelete(branchName: string): Promise<Result<void>> {
  try {
    // First check if main branch exists
    const mainBranch = await findDefaultBranch();

    // Switch to main/master
    await execa('git', ['checkout', mainBranch]);
    ui.success(`Switched to ${mainBranch} branch`);

    // Try to delete the branch
    try {
      await execa('git', ['branch', '-d', branchName]);
      ui.success(`Deleted branch "${branchName}"`);
    } catch (error) {
      // If regular delete fails, branch might have unmerged changes
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not fully merged')) {
        ui.warn(`Branch "${branchName}" has unmerged changes`);

        const { forceDelete } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'forceDelete',
            message: 'Force delete anyway? (This will lose any uncommitted changes)',
            default: false,
          },
        ]);

        if (forceDelete) {
          await execa('git', ['branch', '-D', branchName]);
          ui.success(`Force deleted branch "${branchName}"`);
          ui.warn('Any uncommitted changes in that branch have been lost');
        } else {
          ui.info(`Branch "${branchName}" was preserved`);
          ui.muted(`You can delete it later with: git branch -D ${branchName}`);
        }
      } else {
        throw error;
      }
    }

    return success(undefined);
  } catch (error) {
    return failure(
      new CommandError('Failed to switch branches or delete branch', 'pull', {
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/**
 * Switch to main branch but keep the current branch
 */
async function switchToMain(branchName: string): Promise<Result<void>> {
  try {
    // First check if main branch exists
    const mainBranch = await findDefaultBranch();

    // Switch to main/master
    await execa('git', ['checkout', mainBranch]);
    ui.success(`Switched to ${mainBranch} branch`);
    ui.info(`Branch "${branchName}" was preserved`);
    ui.muted(`You can switch back with: git checkout ${branchName}`);

    return success(undefined);
  } catch (error) {
    return failure(
      new CommandError('Failed to switch to main branch', 'pull', {
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/**
 * Set a new upstream for the current branch
 */
async function setNewUpstream(branchName: string): Promise<Result<void>> {
  try {
    await execa('git', ['branch', '--set-upstream-to', `origin/${branchName}`, branchName]);
    ui.success(`Set upstream for "${branchName}" to origin/${branchName}`);
    ui.info('You can now try pulling again');

    return success(undefined);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('does not exist')) {
      return failure(
        new CommandError(`Remote branch origin/${branchName} does not exist`, 'pull', {
          suggestions: [`You may need to push your branch first: git push -u origin ${branchName}`],
        })
      );
    }

    return failure(
      new CommandError('Failed to set upstream branch', 'pull', {
        context: { error: errorMessage },
      })
    );
  }
}

/**
 * Find the default branch (main, master, or other)
 */
async function findDefaultBranch(): Promise<string> {
  try {
    // Try main first
    await execa('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main']);
    return 'main';
  } catch {
    try {
      // Try master
      await execa('git', ['show-ref', '--verify', '--quiet', 'refs/heads/master']);
      return 'master';
    } catch {
      // Get the default branch from remote
      try {
        const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
        return stdout.replace('refs/remotes/origin/', '').trim();
      } catch {
        // Fallback to main
        ui.warn('Could not determine default branch, using "main"');
        return 'main';
      }
    }
  }
}

/**
 * Create the git pull command
 */
export function createPullCommand(): Command {
  const command = new Command('pull');

  command
    .description('Pull changes from remote repository with automatic rebase fallback')
    .option('--rebase', 'force rebase strategy')
    .option('--no-rebase', 'prevent automatic rebase fallback')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: GitPullOptions;
      try {
        validatedOptions = validate(gitPullOptionsSchema, options, 'git pull options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      const result = await executePull(validatedOptions);

      if (isFailure(result)) {
        ui.error(result.error.message);
        if (result.error.suggestions && result.error.suggestions.length > 0) {
          ui.warn('Suggestions:');
          ui.list(result.error.suggestions);
        }
        if (result.error.context?.['error']) {
          ui.muted(String(result.error.context['error']));
        }
        process.exit(1);
      }
    });

  return command;
}
