import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitPullOptionsSchema, deletedBranchActionSchema } from '@/types/schemas.js';
import type { GitPullOptions } from '@/types/schemas.js';

/**
 * Create the git pull command
 *
 * This command attempts a normal pull first, and if it fails due to
 * non-fast-forward issues, automatically retries with --rebase
 *
 * @returns Command instance for git pull
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
          ui.error('No upstream branch configured!');
          ui.warn('Set an upstream branch first:');
          ui.muted(`  git branch --set-upstream-to=origin/${branchName} ${branchName}`);
          ui.muted('Or push with upstream:');
          ui.muted(`  neo git push -u ${branchName}`);
          process.exit(1);
        }

        spinner.start();

        // If user explicitly requested rebase, use it directly
        if (validatedOptions.rebase) {
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

          return;
        }

        // Try normal pull first
        logger.debug('Attempting normal pull...');

        try {
          const { stdout } = await execa('git', ['pull'], {
            stdio: 'pipe',
            encoding: 'utf8',
          });

          spinner.succeed('Successfully pulled from remote!');

          if (stdout.trim()) {
            ui.muted(stdout);
          }
        } catch (error: unknown) {
          // Check if it's a non-fast-forward error
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (
            (errorMessage.includes('non-fast-forward') ||
              errorMessage.includes('divergent branches') ||
              errorMessage.includes('cannot fast-forward')) &&
            !validatedOptions.noRebase
          ) {
            logger.debug('Normal pull failed, attempting rebase...');
            spinner.text = 'Cannot fast-forward, retrying with rebase...';

            const { stdout } = await execa('git', ['pull', '--rebase'], {
              stdio: 'pipe',
              encoding: 'utf8',
            });

            spinner.succeed('Successfully pulled with rebase!');
            ui.info('Used rebase strategy due to divergent branches');

            if (stdout.trim()) {
              ui.muted(stdout);
            }
          } else {
            throw error; // Re-throw if not a fast-forward issue
          }
        }
      } catch (error: unknown) {
        spinner.stop();

        if (error instanceof Error) {
          const errorMessage = error.message;

          if (errorMessage.includes('not a git repository')) {
            ui.error('Not a git repository!');
            ui.warn('Make sure you are in a git repository directory');
            process.exit(1);
          }

          // Handle deleted remote branch
          if (
            errorMessage.includes('no such ref was fetched') ||
            errorMessage.includes('but no such ref was fetched')
          ) {
            await handleDeletedRemoteBranch(branchName);
            return;
          }

          if (errorMessage.includes('conflict')) {
            ui.error('Merge conflicts detected!');
            ui.warn('Resolve conflicts manually, then:');
            ui.list([
              'Fix conflicts in your editor',
              'Stage resolved files: git add <files>',
              'Continue rebase: git rebase --continue',
            ]);
            ui.muted('Or abort the rebase:');
            ui.muted('  git rebase --abort');
            process.exit(1);
          }

          if (errorMessage.includes('authentication') || errorMessage.includes('permission')) {
            ui.error('Authentication failed!');
            ui.warn('Check your git credentials or SSH keys');
            process.exit(1);
          }

          if (errorMessage.includes('Could not resolve host')) {
            ui.error('Network error!');
            ui.warn('Check your internet connection');
            process.exit(1);
          }
        }

        ui.error('Failed to pull from remote');
        ui.muted(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}

/**
 * Handle deleted remote branch scenario with interactive prompt
 * @param branchName - The current branch name
 */
async function handleDeletedRemoteBranch(branchName: string): Promise<void> {
  ui.error('Remote branch no longer exists!');
  ui.warn(`Your local branch "${branchName}" is tracking a remote branch that has been deleted`);
  console.log('');

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'How would you like to resolve this?',
      default: 'switch_main_delete',
      choices: [
        {
          name: 'Switch to main and delete this branch (recommended)',
          value: 'switch_main_delete',
        },
        {
          name: 'Switch to main and keep this branch',
          value: 'switch_main_keep',
        },
        {
          name: `Set a new upstream for "${branchName}"`,
          value: 'set_upstream',
        },
        {
          name: 'Cancel (no changes)',
          value: 'cancel',
        },
      ],
    },
  ]);

  const validatedAction = deletedBranchActionSchema.parse(action);

  switch (validatedAction) {
    case 'switch_main_delete':
      await switchToMainAndDelete(branchName);
      break;
    case 'switch_main_keep':
      await switchToMain(branchName);
      break;
    case 'set_upstream':
      await setNewUpstream(branchName);
      break;
    case 'cancel':
      ui.muted('Operation cancelled. No changes were made.');
      process.exit(0);
  }
}

/**
 * Switch to main branch and delete the current branch
 * @param branchName - The branch to delete
 */
async function switchToMainAndDelete(branchName: string): Promise<void> {
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
  } catch (error) {
    ui.error('Failed to switch branches or delete branch');
    ui.muted(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Switch to main branch but keep the current branch
 * @param branchName - The current branch name
 */
async function switchToMain(branchName: string): Promise<void> {
  try {
    // First check if main branch exists
    const mainBranch = await findDefaultBranch();

    // Switch to main/master
    await execa('git', ['checkout', mainBranch]);
    ui.success(`Switched to ${mainBranch} branch`);
    ui.info(`Branch "${branchName}" was preserved`);
    ui.muted(`You can switch back with: git checkout ${branchName}`);
  } catch (error) {
    ui.error('Failed to switch to main branch');
    ui.muted(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Set a new upstream for the current branch
 * @param branchName - The current branch name
 */
async function setNewUpstream(branchName: string): Promise<void> {
  try {
    await execa('git', ['branch', '--set-upstream-to', `origin/${branchName}`, branchName]);
    ui.success(`Set upstream for "${branchName}" to origin/${branchName}`);
    ui.info('You can now try pulling again');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('does not exist')) {
      ui.error(`Remote branch origin/${branchName} does not exist`);
      ui.warn('You may need to push your branch first:');
      ui.muted(`  git push -u origin ${branchName}`);
    } else {
      ui.error('Failed to set upstream branch');
      ui.muted(errorMessage);
    }
    process.exit(1);
  }
}

/**
 * Find the default branch (main, master, or other)
 * @returns The name of the default branch
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
