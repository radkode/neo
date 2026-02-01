/**
 * Git worktree list command
 * Lists all worktrees with their status
 */

import { Command } from '@commander-js/extra-typings';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { listWorktrees, formatWorktreeStatus, type WorktreeInfo } from './utils.js';

/**
 * Execute the worktree list command
 */
export async function executeWorktreeList(): Promise<Result<WorktreeInfo[]>> {
  const spinner = ui.spinner('Loading worktrees');
  spinner.start();

  try {
    const worktrees = await listWorktrees();
    spinner.succeed(`Found ${worktrees.length} worktree(s)`);

    if (worktrees.length === 0) {
      ui.info('No worktrees found.');
      return success(worktrees);
    }

    // Display as table
    ui.table({
      headers: ['Path', 'Branch', 'Commit', 'Status'],
      rows: worktrees.map((wt) => [
        wt.path,
        wt.branch || '(detached)',
        wt.head.substring(0, 8),
        formatWorktreeStatus(wt),
      ]),
    });

    return success(worktrees);
  } catch (error) {
    spinner.fail('Failed to list worktrees');

    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('worktree list'));
    }

    return failure(GitErrors.unknown('worktree list', error));
  }
}

/**
 * Create the worktree list subcommand
 */
export function createWorktreeListCommand(): Command {
  const command = new Command('list');

  command.description('List all worktrees').action(async () => {
    const result = await executeWorktreeList();

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
