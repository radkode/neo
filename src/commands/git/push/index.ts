import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { promptSelect } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import {
  GitErrors,
  isNotGitRepository,
  isNoUpstreamError,
  isNonFastForwardError,
  isAuthenticationError,
  isConflictError,
} from '@/utils/git-errors.js';

interface PushOptions {
  dryRun?: boolean | undefined;
  passthrough: string[];
  remote?: string | undefined;
  branch?: string | undefined;
}

/**
 * Execute the push command logic
 * Returns a Result indicating success or failure
 */
export async function executePush(options: PushOptions): Promise<Result<void>> {
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

    const remoteName = options.remote || 'origin';
    const targetBranch = options.branch || branchName;

    logger.debug(`Remote: ${remoteName}`);
    logger.debug(`Target branch: ${targetBranch}`);
    logger.debug(`Dry run: ${options.dryRun || false}`);
    logger.debug(`Passthrough args: ${options.passthrough.join(' ')}`);

    if (options.dryRun) {
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

    spinner.start();

    // Build push args: git push [passthrough options] remote branch
    pushArgs = ['push', ...options.passthrough, remoteName, targetBranch];

    logger.debug(`Executing: git ${pushArgs.join(' ')}`);

    const pushResult = await execa('git', pushArgs, {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    spinner.succeed('Successfully pushed to remote!');

    if (pushResult.stdout) {
      ui.muted(pushResult.stdout);
    }

    if (options.passthrough.includes('-u') || options.passthrough.includes('--set-upstream')) {
      ui.info(`Set upstream branch: ${remoteName}/${targetBranch}`);
    }

    return success(undefined);
  } catch (error: unknown) {
    spinner.stop();

    // Use shared git error detection
    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('push'));
    }

    if (isNoUpstreamError(error)) {
      return failure(GitErrors.noUpstream('push', branchName));
    }

    if (isNonFastForwardError(error)) {
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
        return handlePullRebase(branchName, pushArgs, options);
      }

      if (resolution === 'force') {
        return handleForcePush(pushArgs, options);
      }

      ui.info('Push cancelled. No changes were pushed.');
      return failure(GitErrors.unknown('push'));
    }

    if (isAuthenticationError(error)) {
      return failure(GitErrors.authenticationFailed('push'));
    }

    return failure(GitErrors.unknown('push', error));
  }
}

/**
 * Handle pull with rebase and retry push
 */
async function handlePullRebase(
  branchName: string,
  pushArgs: string[],
  options: PushOptions
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

    if (options.passthrough.includes('-u') || options.passthrough.includes('--set-upstream')) {
      // Extract remote and branch from pushArgs (last two elements)
      const remoteName = pushArgs[pushArgs.length - 2];
      const targetBranch = pushArgs[pushArgs.length - 1];
      ui.info(`Set upstream branch: ${remoteName}/${targetBranch}`);
    }

    return success(undefined);
  } catch (rebaseError) {
    rebaseSpinner.stop();
    if (isConflictError(rebaseError)) {
      return failure(GitErrors.rebaseConflict('push'));
    }
    return failure(GitErrors.unknown('push', rebaseError));
  }
}

/**
 * Handle force push
 */
async function handleForcePush(pushArgs: string[], options: PushOptions): Promise<Result<void>> {
  const forceSpinner = ui.spinner('Force pushing (overwriting remote)');
  const hasForce =
    pushArgs.includes('--force') ||
    pushArgs.includes('-f') ||
    pushArgs.includes('--force-with-lease');
  const forceArgs = hasForce ? pushArgs : ['push', '--force', ...pushArgs.slice(1)];
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

    if (options.passthrough.includes('-u') || options.passthrough.includes('--set-upstream')) {
      // Extract remote and branch from pushArgs (last two elements)
      const remoteName = pushArgs[pushArgs.length - 2];
      const targetBranch = pushArgs[pushArgs.length - 1];
      ui.info(`Set upstream branch: ${remoteName}/${targetBranch}`);
    }

    return success(undefined);
  } catch (forceError) {
    forceSpinner.stop();
    return failure(GitErrors.unknown('push', forceError));
  }
}

export function createPushCommand(): Command {
  const command = new Command('push');

  command
    .description('Push changes to remote repository (passes unknown options to git)')
    .argument('[args...]', 'git push arguments (remote, branch, and options like -u)')
    .option('--dry-run', 'show what would be pushed without actually pushing')
    .allowUnknownOption()
    .action(async (args: string[], opts) => {
      // Parse args to extract remote, branch, and passthrough options
      // Options start with - or --, positional args are remote and branch
      const passthrough: string[] = [];
      const positionalArgs: string[] = [];

      for (const arg of args) {
        // Skip our known options
        if (arg === '--dry-run') {
          continue;
        }

        if (arg.startsWith('-')) {
          // This is an option to pass through to git
          passthrough.push(arg);
        } else {
          // This is a positional argument (remote or branch)
          positionalArgs.push(arg);
        }
      }

      // First positional is remote, second is branch
      const remote = positionalArgs[0];
      const branch = positionalArgs[1];

      const options: PushOptions = {
        dryRun: (opts as { dryRun?: boolean }).dryRun,
        passthrough,
        remote,
        branch,
      };

      logger.debug(`Options: ${JSON.stringify(options)}`);

      const result = await executePush(options);

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
