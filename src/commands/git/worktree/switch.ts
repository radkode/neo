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
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { emitJson, emitError } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

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

    const rtCtx = getRuntimeContext();
    // In non-interactive mode, emit the worktree list as JSON and exit — the
    // agent can choose one and cd itself. A CLI can't cd the parent shell anyway.
    if (rtCtx.nonInteractive) {
      emitJson({
        ok: true,
        command: 'git.worktree.switch',
        worktrees: worktrees.map((wt) => ({
          branch: wt.branch ?? null,
          path: wt.path,
          head: wt.head,
          isDirty: wt.isDirty,
          isLocked: wt.isLocked,
          isMain: wt.isMain,
        })),
      });
      return success(null);
    }

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

    ui.newline();

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

  command.description('Interactively select and switch to a worktree').action(
    runAction(async () => {
      const result = await executeWorktreeSwitch();

      if (isFailure(result)) {
        emitError(result.error);
        process.exit(1);
      }
    })
  );

  return command;
}
