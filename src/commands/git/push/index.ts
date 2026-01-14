import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { promptSelect } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitPushOptionsSchema } from '@/types/schemas.js';
import type { GitPushOptions } from '@/types/schemas.js';
import {
  type Result,
  success,
  failure,
  isFailure,
  CommandError,
} from '@/core/errors/index.js';

/**
 * Execute the push command logic
 * Returns a Result indicating success or failure
 */
export async function executePush(options: GitPushOptions): Promise<Result<void>> {
  let branchName: string = '';
  const spinner = ui.spinner('Pushing to remote');
  let pushArgs: string[] = [];

  try {
    const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
    branchName = currentBranch.trim();

    logger.debug(`Current branch: ${branchName}`);

    if (branchName === 'main') {
      ui.warn('You are about to push directly to main branch');
      ui.muted('This is generally not recommended as it bypasses code review processes');

      const { confirmPush } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmPush',
          message: 'Are you sure you want to continue?',
          default: false,
        },
      ]);

      if (!confirmPush) {
        ui.success("Push cancelled. Here's how to push your changes safely:");
        ui.list([
          'Create a feature branch: git checkout -b feature/your-feature-name',
          'Push to your branch: git push -u origin feature/your-feature-name',
          'Create a pull request to merge into main',
        ]);
        ui.muted('This protects the main branch from accidental changes');
        return success(undefined);
      }

      ui.step('Proceeding with push to main branch');
    }

    spinner.start();

    logger.debug(`Force push: ${options.force || false}`);
    logger.debug(`Set upstream: ${options.setUpstream || 'none'}`);
    logger.debug(`Dry run: ${options.dryRun || false}`);
    logger.debug(`Push tags: ${options.tags || false}`);

    if (options.dryRun) {
      spinner.stop();
      ui.warn('Dry run mode - no changes will be pushed');
      ui.info(`Would push from branch: ${branchName}`);

      // Show what would be pushed
      try {
        const { stdout: commits } = await execa('git', [
          'log',
          '--oneline',
          `origin/${branchName}..HEAD`,
        ]);
        if (commits.trim()) {
          ui.info('Would push the following commits:');
          ui.list(commits.trim().split('\n'));
        } else {
          ui.info('No new commits to push');
        }
      } catch {
        ui.info('Would push current branch (unable to determine commit differences)');
      }
      return success(undefined);
    }

    pushArgs = ['push'];

    if (options.force) {
      pushArgs.push('--force');
    }

    if (options.tags) {
      pushArgs.push('--tags');
    }

    if (options.setUpstream) {
      pushArgs.push('-u', 'origin', options.setUpstream);
    } else {
      pushArgs.push('origin', branchName);
    }

    logger.debug(`Executing: git ${pushArgs.join(' ')}`);

    const pushResult = await execa('git', pushArgs, {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    spinner.succeed('Successfully pushed to remote!');

    if (pushResult.stdout) {
      ui.muted(pushResult.stdout);
    }

    if (options.setUpstream) {
      ui.info(`Set upstream branch: ${options.setUpstream}`);
    }

    return success(undefined);
  } catch (error: unknown) {
    spinner.stop();

    if (error instanceof Error) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const shortMessage = (error as { shortMessage?: string }).shortMessage ?? '';
      const combinedMessage = `${error.message} ${stderr} ${shortMessage}`.toLowerCase();

      if (error.message?.includes('not a git repository')) {
        return failure(
          new CommandError('Not a git repository!', 'push', {
            suggestions: ['Make sure you are in a git repository directory'],
          })
        );
      }

      if (error.message?.includes('no upstream branch')) {
        return failure(
          new CommandError('No upstream branch configured!', 'push', {
            suggestions: [`Use --set-upstream to set the upstream branch: git push -u origin ${branchName || 'your-branch'}`],
          })
        );
      }

      if (
        combinedMessage.includes('non-fast-forward') ||
        combinedMessage.includes('fetch first') ||
        combinedMessage.includes('behind') ||
        combinedMessage.includes('remote contains') ||
        combinedMessage.includes('tip of your current branch is behind its remote counterpart')
      ) {
        ui.error('Push was rejected because the remote has new commits.');
        ui.warn('Choose how to resolve the divergence:');

        const resolution = await promptSelect({
          choices: [
            {
              label: 'Pull with rebase and retry push',
              value: 'pull-rebase',
            },
            {
              label: 'Force push (overwrite remote)',
              value: 'force',
            },
            {
              label: 'Cancel for now',
              value: 'cancel',
            },
          ],
          defaultValue: 'pull-rebase',
          message: 'Select a resolution strategy',
        });

        if (resolution === 'pull-rebase') {
          const rebaseResult = await handlePullRebase(branchName, pushArgs, options);
          return rebaseResult;
        }

        if (resolution === 'force') {
          const forceResult = await handleForcePush(pushArgs, options);
          return forceResult;
        }

        ui.info('Push cancelled. No changes were pushed.');
        return failure(new CommandError('Push cancelled by user', 'push'));
      }

      if (error.message?.includes('authentication')) {
        return failure(
          new CommandError('Authentication failed!', 'push', {
            suggestions: ['Check your git credentials or SSH keys'],
          })
        );
      }
    }

    return failure(
      new CommandError('Failed to push to remote', 'push', {
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/**
 * Handle pull with rebase and retry push
 */
async function handlePullRebase(
  branchName: string,
  pushArgs: string[],
  options: GitPushOptions
): Promise<Result<void>> {
  const rebaseSpinner = ui.spinner('Pulling latest changes with rebase');
  try {
    rebaseSpinner.start();
    await execa('git', ['pull', '--rebase', 'origin', branchName || 'HEAD']);
    rebaseSpinner.succeed('Rebased onto remote changes');

    const retrySpinner = ui.spinner('Retrying push after rebase');
    retrySpinner.start();
    const retryResult = await execa('git', pushArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    retrySpinner.succeed('Successfully pushed after rebase');

    if (retryResult.stdout) {
      ui.muted(retryResult.stdout);
    }

    if (options.setUpstream) {
      ui.info(`Set upstream branch: ${options.setUpstream}`);
    }

    return success(undefined);
  } catch (rebaseError) {
    rebaseSpinner.stop();
    return failure(
      new CommandError('Rebase failed. Resolve conflicts then push again.', 'push', {
        context: { error: rebaseError instanceof Error ? rebaseError.message : String(rebaseError) },
      })
    );
  }
}

/**
 * Handle force push
 */
async function handleForcePush(
  pushArgs: string[],
  options: GitPushOptions
): Promise<Result<void>> {
  const forceSpinner = ui.spinner('Force pushing (overwriting remote)');
  const forceArgs = pushArgs.includes('--force')
    ? pushArgs
    : ['push', '--force', ...pushArgs.slice(1)];
  try {
    forceSpinner.start();
    const forceResult = await execa('git', forceArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    forceSpinner.succeed('Force push completed');

    if (forceResult.stdout) {
      ui.muted(forceResult.stdout);
    }

    if (options.setUpstream) {
      ui.info(`Set upstream branch: ${options.setUpstream}`);
    }

    return success(undefined);
  } catch (forceError) {
    forceSpinner.stop();
    return failure(
      new CommandError('Force push failed.', 'push', {
        context: { error: forceError instanceof Error ? forceError.message : String(forceError) },
      })
    );
  }
}

export function createPushCommand(): Command {
  const command = new Command('push');

  command
    .description('Push changes to remote repository')
    .option('-f, --force', 'force push (overwrites remote)')
    .option('-u, --set-upstream <branch>', 'set upstream branch')
    .option('--dry-run', 'show what would be pushed without actually pushing')
    .option('--tags', 'push tags along with commits')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: GitPushOptions;
      try {
        validatedOptions = validate(gitPushOptionsSchema, options, 'git push options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      const result = await executePush(validatedOptions);

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
