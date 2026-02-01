/**
 * Git worktree switch command
 * Interactively select and switch to a worktree
 */

import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { listWorktrees, formatWorktreeStatus, copyToClipboard } from './utils.js';

/**
 * Execute the worktree switch command
 */
export async function executeWorktreeSwitch(): Promise<Result<string | null>> {
  const spinner = ui.spinner('Loading worktrees');
  spinner.start();

  try {
    const worktrees = await listWorktrees();
    spinner.stop();

    if (worktrees.length <= 1) {
      ui.info('No additional worktrees found.');
      ui.muted('Create a new worktree with: neo git worktree add <branch>');
      return success(null);
    }

    // Display status dashboard
    ui.section('Worktree Status');
    ui.table({
      headers: ['#', 'Branch', 'Path', 'Status'],
      rows: worktrees.map((wt, i) => [
        String(i + 1),
        wt.branch || '(detached)',
        wt.path,
        formatWorktreeStatus(wt),
      ]),
    });

    console.log('');

    // Interactive selection
    const choices = [
      ...worktrees.map((wt, index) => ({
        name: `${wt.branch || wt.head.substring(0, 8)} - ${wt.path}${wt.isDirty ? ' (dirty)' : ''}`,
        value: index,
        short: wt.branch || wt.head.substring(0, 8),
      })),
      new inquirer.Separator(),
      { name: 'Cancel', value: -1, short: 'Cancel' },
    ];

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a worktree to switch to:',
        choices,
        pageSize: 10,
      },
    ]);

    if (selected === -1) {
      ui.muted('Cancelled.');
      return success(null);
    }

    const selectedWorktree = worktrees[selected];
    if (!selectedWorktree) {
      return success(null);
    }

    // Build the cd command
    const cdCommand = `cd ${selectedWorktree.path}`;

    // Copy to clipboard
    const copied = await copyToClipboard(cdCommand);

    // Display result
    ui.success('Switch to worktree:');
    ui.code(cdCommand);

    if (copied) {
      ui.muted('Copied to clipboard - paste in your terminal');
    } else {
      ui.muted('Copy and paste this command in your terminal');
    }

    return success(selectedWorktree.path);
  } catch (error) {
    spinner.fail('Failed to list worktrees');

    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('worktree switch'));
    }

    return failure(GitErrors.unknown('worktree switch', error));
  }
}

/**
 * Create the worktree switch subcommand
 */
export function createWorktreeSwitchCommand(): Command {
  const command = new Command('switch');

  command.description('Interactively select and switch to a worktree').action(async () => {
    const result = await executeWorktreeSwitch();

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
