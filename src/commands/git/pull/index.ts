import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { promptSelect, NonInteractiveError } from '@/utils/prompt.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { emitJson, emitError } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitPullOptionsSchema, deletedBranchActionSchema } from '@/types/schemas.js';
import type { GitPullOptions } from '@/types/schemas.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import {
  GitErrors,
  isNotGitRepository,
  isAuthenticationError,
  isNetworkError,
  isConflictError,
  isNonFastForwardError,
} from '@/utils/git-errors.js';

/**
 * Check if error indicates remote branch was deleted
 */
function isRemoteBranchDeletedError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return errorMessage.includes('no such ref was fetched') || errorMessage.includes('but no such ref was fetched');
}

/**
 * Check if error indicates pull failed due to multiple branch ambiguity
 */
function isMultipleBranchesError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return errorMessage.includes('cannot fast-forward to multiple branches');
}

/**
 * Outcome of an executePull call. `cancelled` distinguishes "the user chose
 * to abort" from "the pull completed" so the JSON emitter doesn't claim
 * `ok: true` on a no-op.
 */
export type PullOutcome = { cancelled: false } | { cancelled: true; reason: string };

/**
 * Execute the pull command logic
 * Returns a Result indicating success or failure
 */
export async function executePull(options: GitPullOptions): Promise<Result<PullOutcome>> {
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
      return failure(GitErrors.noUpstream('pull', branchName));
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

      return success({ cancelled: false } as const);
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

      return success({ cancelled: false } as const);
    } catch (error: unknown) {
      // Check for diverged branches
      if (isNonFastForwardError(error)) {
        spinner.stop();
        return handleDivergedPull(branchName, options);
      }

      // Handle "Cannot fast-forward to multiple branches" by retrying with explicit branch
      if (isMultipleBranchesError(error)) {
        logger.debug(`Multiple branches error, retrying with explicit branch: ${branchName}`);
        spinner.text = `Pulling from origin/${branchName}...`;

        try {
          const { stdout } = await execa('git', ['pull', 'origin', branchName], {
            encoding: 'utf8',
            stdio: 'pipe',
          });

          spinner.succeed('Successfully pulled from remote!');

          if (stdout.trim()) {
            ui.muted(stdout);
          }

          return success({ cancelled: false } as const);
        } catch (retryError: unknown) {
          if (isNonFastForwardError(retryError)) {
            spinner.stop();
            return handleDivergedPull(branchName, options);
          }
          throw retryError;
        }
      }

      throw error;
    }
  } catch (error: unknown) {
    spinner.stop();

    // Use shared git error detection
    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('pull'));
    }

    if (isRemoteBranchDeletedError(error)) {
      return handleDeletedRemoteBranch(branchName);
    }

    if (isConflictError(error)) {
      return failure(GitErrors.mergeConflict('pull'));
    }

    if (isAuthenticationError(error)) {
      return failure(GitErrors.authenticationFailed('pull'));
    }

    if (isNetworkError(error)) {
      return failure(GitErrors.networkError('pull'));
    }

    return failure(GitErrors.unknown('pull', error));
  }
}

async function handleDivergedPull(
  branchName: string,
  options: GitPullOptions
): Promise<Result<PullOutcome>> {
  ui.error('Local and remote branches have diverged.');
  ui.warn('Choose how to reconcile the branches.');

  const defaultStrategy: 'merge' | 'rebase' = options.noRebase ? 'merge' : 'rebase';

  const strategy = await promptSelect({
    choices: [
      { label: 'Cancel (do nothing)', value: 'cancel' },
      { label: 'Merge remote into current branch (--no-ff)', value: 'merge' },
      { label: 'Rebase onto remote (recommended)', value: 'rebase' },
    ],
    defaultValue: defaultStrategy,
    message: 'Branches have diverged. Choose a pull strategy:',
    flag: '--rebase or --no-rebase',
    // Rebasing on divergence is the documented default behavior — safe to auto-apply.
    safeDefaultForNonInteractive: true,
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

      return success({ cancelled: false } as const);
    } catch (error) {
      rebaseSpinner.stop();
      if (isConflictError(error)) {
        return failure(GitErrors.rebaseConflict('pull'));
      }
      return failure(GitErrors.unknown('pull', error));
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

      return success({ cancelled: false } as const);
    } catch (error) {
      fetchSpinner.stop();
      mergeSpinner.stop();
      if (isConflictError(error)) {
        return failure(GitErrors.mergeConflict('pull'));
      }
      return failure(GitErrors.unknown('pull', error));
    }
  }

  ui.info('Pull cancelled. No changes were applied.');
  return success({ cancelled: true, reason: 'user-cancelled-diverged' } as const);
}

/**
 * Handle deleted remote branch scenario with interactive prompt
 */
async function handleDeletedRemoteBranch(branchName: string): Promise<Result<PullOutcome>> {
  ui.error('Remote branch no longer exists!');
  ui.warn(`Your local branch "${branchName}" is tracking a remote branch that has been deleted`);
  ui.newline();

  // Note: no safeDefaultForNonInteractive — the default ("delete branch") is
  // destructive, so agents must explicitly opt in via a flag (future --on-deleted).
  const validatedAction = deletedBranchActionSchema.parse(
    await promptSelect({
      choices: [
        { label: 'Switch to main and delete this branch (recommended)', value: 'switch_main_delete' },
        { label: 'Switch to main and keep this branch', value: 'switch_main_keep' },
        { label: `Set a new upstream for "${branchName}"`, value: 'set_upstream' },
        { label: 'Cancel (no changes)', value: 'cancel' },
      ],
      defaultValue: 'switch_main_delete',
      message: 'How would you like to resolve this?',
      flag: '(no flag yet — remote branch deletion requires interactive resolution)',
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
      return success({ cancelled: true, reason: 'user-cancelled-deleted-remote' } as const);
  }
}

/**
 * Switch to main branch and delete the current branch
 */
async function switchToMainAndDelete(branchName: string): Promise<Result<PullOutcome>> {
  try {
    // First check if main branch exists
    const mainBranch = await findDefaultBranch();

    // Switch to main/master
    await execa('git', ['checkout', mainBranch]);
    ui.success(`Switched to ${mainBranch} branch`);

    // Pull latest changes on main
    await execa('git', ['pull']);
    ui.success(`Pulled latest changes on ${mainBranch}`);

    // Try to delete the branch
    try {
      await execa('git', ['branch', '-d', branchName]);
      ui.success(`Deleted branch "${branchName}"`);
    } catch (error) {
      // If regular delete fails, branch might have unmerged changes
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not fully merged')) {
        ui.warn(`Branch "${branchName}" has unmerged changes`);

        const rtCtx = getRuntimeContext();
        let forceDelete: boolean;
        if (rtCtx.nonInteractive || rtCtx.yes) {
          // Force-delete loses work silently — never auto-approve.
          throw new NonInteractiveError(
            'Branch has unmerged changes; force-delete requires explicit confirmation'
          );
        } else {
          const answer = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'forceDelete',
              message: 'Force delete anyway? (This will lose any uncommitted changes)',
              default: false,
            },
          ]);
          forceDelete = Boolean(answer.forceDelete);
        }

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

    return success({ cancelled: false } as const);
  } catch (error) {
    return failure(GitErrors.unknown('pull', error));
  }
}

/**
 * Switch to main branch but keep the current branch
 */
async function switchToMain(branchName: string): Promise<Result<PullOutcome>> {
  try {
    // First check if main branch exists
    const mainBranch = await findDefaultBranch();

    // Switch to main/master
    await execa('git', ['checkout', mainBranch]);
    ui.success(`Switched to ${mainBranch} branch`);

    // Pull latest changes on main
    await execa('git', ['pull']);
    ui.success(`Pulled latest changes on ${mainBranch}`);

    ui.info(`Branch "${branchName}" was preserved`);
    ui.muted(`You can switch back with: git checkout ${branchName}`);

    return success({ cancelled: false } as const);
  } catch (error) {
    return failure(GitErrors.unknown('pull', error));
  }
}

/**
 * Set a new upstream for the current branch
 */
async function setNewUpstream(branchName: string): Promise<Result<PullOutcome>> {
  try {
    await execa('git', ['branch', '--set-upstream-to', `origin/${branchName}`, branchName]);
    ui.success(`Set upstream for "${branchName}" to origin/${branchName}`);
    ui.info('You can now try pulling again');

    // Upstream set but no pull ran; treat as a cancelled pull so the JSON
    // emitter doesn't claim `ok: true` for a no-op.
    return success({ cancelled: true, reason: 'upstream-set-only' } as const);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('does not exist')) {
      return failure(GitErrors.noUpstream('pull', branchName));
    }
    return failure(GitErrors.unknown('pull', error));
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
    .addHelpText(
      'after',
      `
Examples:
  Normal pull (auto-rebases on divergence):
    $ neo git pull

  Force rebase:
    $ neo git pull --rebase

  Agent-friendly (structured output, auto-handles divergence):
    $ neo git pull --yes --json
`
    )
    .action(runAction(async (options: unknown) => {
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
        emitError(result.error);
        process.exit(1);
      }
      if (result.data.cancelled) {
        emitJson({ ok: false, command: 'git.pull', cancelled: true, reason: result.data.reason });
        return;
      }
      emitJson({ ok: true, command: 'git.pull' });
    }));

  return command;
}
