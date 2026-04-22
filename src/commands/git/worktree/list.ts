/**
 * Git worktree list command
 * Lists all worktrees with their status
 */

import { Command } from '@commander-js/extra-typings';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
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

    emitJson(
      {
        ok: true,
        command: 'git.worktree.list',
        count: worktrees.length,
        worktrees: worktrees.map((wt) => ({
          path: wt.path,
          branch: wt.branch ?? null,
          head: wt.head,
          detached: !wt.branch,
          status: formatWorktreeStatus(wt),
        })),
      },
      {
        text: () => {
          if (worktrees.length === 0) {
            ui.info('No worktrees found.');
            return;
          }
          ui.table({
            headers: ['Path', 'Branch', 'Commit', 'Status'],
            rows: worktrees.map((wt) => [
              wt.path,
              wt.branch || '(detached)',
              wt.head.substring(0, 8),
              formatWorktreeStatus(wt),
            ]),
          });
        },
      }
    );

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

  command.description('List all worktrees').action(runAction(async () => {
    const result = await executeWorktreeList();
    if (isFailure(result)) {
      throw result.error;
    }
  }));

  return command;
}
