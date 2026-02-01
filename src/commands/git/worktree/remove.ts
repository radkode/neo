/**
 * Git worktree remove command
 * Removes an existing worktree
 */

import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { listWorktrees } from './utils.js';

interface RemoveWorktreeOptions {
  force?: boolean;
}

/**
 * Execute the worktree remove command
 */
export async function executeWorktreeRemove(
  pathArg: string,
  options: RemoveWorktreeOptions
): Promise<Result<void>> {
  const spinner = ui.spinner('Removing worktree');

  try {
    // Get worktree info to validate
    const worktrees = await listWorktrees();
    const worktree = worktrees.find((wt) => wt.path === pathArg || wt.path.endsWith(pathArg));

    if (!worktree) {
      return failure(GitErrors.worktreeNotFound('worktree remove', pathArg));
    }

    if (worktree.isMain) {
      ui.error('Cannot remove the main worktree!');
      return failure(GitErrors.unknown('worktree remove', new Error('Cannot remove main worktree')));
    }

    // Warn if dirty
    if (worktree.isDirty && !options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Worktree at ${worktree.path} has uncommitted changes. Remove anyway?`,
          default: false,
        },
      ]);

      if (!confirm) {
        ui.muted('Cancelled. Worktree not removed.');
        return success(undefined);
      }
    }

    // Warn if locked
    if (worktree.isLocked && !options.force) {
      ui.warn(`Worktree is locked${worktree.lockReason ? `: ${worktree.lockReason}` : ''}`);
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Force remove locked worktree?',
          default: false,
        },
      ]);

      if (!confirm) {
        ui.muted('Cancelled. Worktree not removed.');
        return success(undefined);
      }
    }

    spinner.start();

    const args = ['worktree', 'remove'];
    if (options.force || worktree.isDirty || worktree.isLocked) {
      args.push('--force');
    }
    args.push(worktree.path);

    await execa('git', args);

    spinner.succeed(`Removed worktree at ${worktree.path}`);

    return success(undefined);
  } catch (error) {
    spinner.fail('Failed to remove worktree');

    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('worktree remove'));
    }

    return failure(GitErrors.unknown('worktree remove', error));
  }
}

/**
 * Create the worktree remove subcommand
 */
export function createWorktreeRemoveCommand(): Command {
  const command = new Command('remove');

  command
    .description('Remove a worktree')
    .argument('<path>', 'path to the worktree to remove')
    .option('-f, --force', 'force removal even if dirty or locked')
    .action(async (path, options) => {
      const result = await executeWorktreeRemove(path, options);

      if (isFailure(result)) {
        ui.error(result.error.message);
        if (result.error.suggestions?.length) {
          ui.warn('Suggestions:');
          ui.list(result.error.suggestions);
        }
        process.exit(1);
      }
    });

  return command;
}
