/**
 * Git worktree add command
 * Creates a new worktree for a branch
 */

import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';
import { getRepoName, getWorktreePath, ensureWorktreeDir, pathExists } from './utils.js';

interface AddWorktreeOptions {
  branch?: string;
  detach?: boolean;
  force?: boolean;
  lock?: boolean;
  path?: string;
}

/**
 * Execute the worktree add command
 */
export async function executeWorktreeAdd(
  branchOrCommit: string,
  options: AddWorktreeOptions
): Promise<Result<string>> {
  const spinner = ui.spinner('Creating worktree');

  try {
    const repoName = await getRepoName();
    const targetBranch = options.branch || branchOrCommit;

    // Determine worktree path
    let worktreePath: string;
    if (options.path) {
      worktreePath = options.path;
    } else {
      await ensureWorktreeDir(repoName);
      worktreePath = getWorktreePath(repoName, targetBranch);
    }

    // Check if path already exists
    if (await pathExists(worktreePath)) {
      return failure(GitErrors.worktreeAlreadyExists('worktree add', worktreePath));
    }

    spinner.start();

    // Build git worktree add arguments
    const args = ['worktree', 'add'];

    if (options.force) args.push('--force');
    if (options.lock) args.push('--lock');
    if (options.detach) args.push('--detach');

    if (options.branch && options.branch !== branchOrCommit) {
      args.push('-b', options.branch);
    }

    args.push(worktreePath, branchOrCommit);

    await execa('git', args);

    spinner.succeed(`Created worktree at ${worktreePath}`);

    ui.keyValue([
      ['Path', worktreePath],
      ['Branch', targetBranch],
    ]);

    console.log('');
    ui.info('To switch to this worktree:');
    ui.code(`cd ${worktreePath}`);

    return success(worktreePath);
  } catch (error) {
    spinner.fail('Failed to create worktree');

    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('worktree add'));
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const fullError = `${errorMsg} ${stderr}`.toLowerCase();

    if (fullError.includes('already checked out') || fullError.includes('already used')) {
      return failure(GitErrors.worktreeBranchCheckedOut('worktree add', branchOrCommit));
    }

    return failure(GitErrors.unknown('worktree add', error));
  }
}

/**
 * Create the worktree add subcommand
 */
export function createWorktreeAddCommand(): Command {
  const command = new Command('add');

  command
    .description('Create a worktree for a branch')
    .argument('<branch>', 'branch name or commit to checkout')
    .option('-b, --branch <name>', 'create a new branch')
    .option('-d, --detach', 'detach HEAD at the commit')
    .option('-f, --force', 'force creation even if branch is checked out')
    .option('--lock', 'lock the worktree after creation')
    .option('-p, --path <path>', 'custom path for worktree (default: ~/.neo/worktrees/<repo>/<branch>)')
    .action(async (branch, options) => {
      const result = await executeWorktreeAdd(branch, options);

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
