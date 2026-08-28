import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { parseWorktreeList, type WorktreeInfo } from '@/commands/git/worktree/utils.js';
import {
  GitErrors,
  isNotGitRepository,
  isAuthenticationError,
  isNetworkError,
} from '@/utils/git-errors.js';
import { isAgentInitialized, getAgentDbPath } from '@/utils/agent.js';
import { ContextDB } from '@/storage/db.js';

interface WorkFinishOptions {
  base?: string;
  force?: boolean;
  pull?: boolean;
  keepWorktree?: boolean;
}

interface WorkFinishResult {
  branch: string;
  base: string;
  mergedOnRemote: boolean | null;
  prUrl?: string;
  branchDeleted: boolean;
  worktreeRemoved: boolean;
  worktreePath?: string;
  pulled: boolean;
  contextUpdated: boolean;
}

async function detectDefaultBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return stdout.replace('refs/remotes/origin/', '').trim();
  } catch {
    for (const name of ['main', 'master']) {
      try {
        await execa('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`]);
        return name;
      } catch {
        continue;
      }
    }
    throw new Error(
      'Could not detect default branch. Pass --base <name>, or run `git remote set-head origin --auto`.'
    );
  }
}

async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  const { stdout } = cwd
    ? await execa('git', ['status', '--porcelain'], { cwd })
    : await execa('git', ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

async function branchExistsLocally(branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function ghInstalled(): Promise<boolean> {
  try {
    await execa('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask GitHub whether the PR associated with this branch has been merged.
 *
 * Returns `{ merged, url }` when gh can see a PR. Returns `null` if gh isn't
 * available or there's no PR for the branch. Squash-merges live here — GH is
 * the only reliable source of truth for "this got into main via squash".
 */
async function queryPrMerged(branch: string): Promise<{ merged: boolean; url: string } | null> {
  if (!(await ghInstalled())) return null;
  try {
    const { stdout } = await execa(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state,url', '--limit', '1'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(stdout) as Array<{ state?: string; url?: string }>;
    const first = parsed[0];
    if (!first) return null;
    return {
      merged: first.state === 'MERGED',
      url: first.url ?? '',
    };
  } catch {
    return null;
  }
}

async function isBranchAncestorOfBase(branch: string, base: string): Promise<boolean> {
  try {
    // `git merge-base --is-ancestor` exits 0 if ancestor, 1 if not.
    await execa('git', ['merge-base', '--is-ancestor', branch, `origin/${base}`]);
    return true;
  } catch {
    return false;
  }
}

async function getWorktrees(): Promise<WorktreeInfo[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain']);
  return parseWorktreeList(stdout);
}

async function resolveAgentDbPath(): Promise<string | null> {
  if (!(await isAgentInitialized())) return null;
  const dbPath = await getAgentDbPath();
  return dbPath;
}

async function markWorkItemDone(branch: string, dbPath: string | null): Promise<boolean> {
  if (!dbPath) return false;

  let db: ContextDB | null = null;
  try {
    db = await ContextDB.create(dbPath);
    const items = db.listContexts({ tag: `branch:${branch}` });
    const workItem = items.find((it) => it.tags.includes('work-item'));
    if (!workItem) return false;

    const nextTags = workItem.tags
      .filter((t) => t !== 'active')
      .concat(workItem.tags.includes('done') ? [] : ['done']);
    db.updateContext(workItem.id, { tags: nextTags, priority: 'low' });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function executeWorkFinish(
  branchArg: string | undefined,
  options: WorkFinishOptions
): Promise<WorkFinishResult> {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (isNotGitRepository(error)) throw GitErrors.notARepository('work finish');
    throw GitErrors.unknown('work finish', error);
  }

  const base = options.base ?? (await detectDefaultBranch());
  const currentBranch = await getCurrentBranch();
  const branch = branchArg?.trim() || currentBranch;

  if (!branch) {
    throw new Error('No branch specified and HEAD is detached. Pass a branch name.');
  }
  if (branch === base) {
    throw new Error(`Refusing to delete base branch "${base}".`);
  }
  if (!(await branchExistsLocally(branch))) {
    throw new Error(`Branch "${branch}" does not exist locally.`);
  }

  // Removing or switching the target worktree can discard local changes.
  // The force flag is the only opt-out.
  if (currentBranch === branch && (await hasUncommittedChanges()) && !options.force) {
    throw new Error(
      'You have uncommitted changes on the branch being finished. Commit/stash first, or pass --force to override.'
    );
  }

  // Determine merge status. Prefer the GitHub PR — it's the only source that
  // correctly reflects squash-merges. Fall back to the ancestor check so the
  // command works in repos without a PR (or gh).
  const prInfo = await queryPrMerged(branch);
  let mergedOnRemote: boolean | null;
  if (prInfo) {
    mergedOnRemote = prInfo.merged;
  } else {
    mergedOnRemote = (await isBranchAncestorOfBase(branch, base)) ? true : null;
  }

  if (mergedOnRemote === false && !options.force) {
    throw new Error(
      `PR for ${branch} is not merged${prInfo?.url ? ` (${prInfo.url})` : ''}. Pass --force to finish anyway.`
    );
  }
  if (mergedOnRemote === null && !options.force) {
    throw new Error(
      `Could not confirm ${branch} is merged (no PR found and not an ancestor of origin/${base}). Pass --force to finish anyway.`
    );
  }

  const worktrees = await getWorktrees();
  const primaryWorktree = worktrees[0];
  const targetWorktree = worktrees.find((worktree) => worktree.branch === branch);
  const existingBaseWorktree = worktrees.find((worktree) => worktree.branch === base);
  const targetIsPrimary = targetWorktree?.path === primaryWorktree?.path;

  if (!options.force && currentBranch !== branch && targetWorktree) {
    if (await hasUncommittedChanges(targetWorktree.path)) {
      throw new Error(
        'You have uncommitted changes on the branch being finished. Commit/stash first, or pass --force to override.'
      );
    }
  }

  if (!primaryWorktree) {
    throw new Error('Could not locate the primary worktree.');
  }

  if (targetIsPrimary && existingBaseWorktree) {
    throw new Error(
      `Cannot finish "${branch}" from the primary worktree because "${base}" is already checked out at ${existingBaseWorktree.path}.`
    );
  }

  const agentDbPath = await resolveAgentDbPath();
  let controlWorktree = existingBaseWorktree ?? primaryWorktree;
  let baseWorktree = existingBaseWorktree;

  if (targetIsPrimary && targetWorktree) {
    const switchSpinner = ui.spinner(`Switching to ${base}`);
    switchSpinner.start();
    try {
      await execa('git', ['checkout', ...(options.force ? ['--force'] : []), base], {
        cwd: targetWorktree.path,
      });
      switchSpinner.succeed(`Switched to ${base}`);
      baseWorktree = targetWorktree;
      controlWorktree = targetWorktree;
    } catch (error) {
      switchSpinner.fail(`Failed to switch to ${base}`);
      throw GitErrors.unknown('work finish', error);
    }
  }

  // Pull (optional)
  let pulled = false;
  if (options.pull !== false && baseWorktree) {
    const pullSpinner = ui.spinner(`Pulling ${base}`);
    pullSpinner.start();
    try {
      await execa('git', ['pull', '--ff-only', 'origin', base], { cwd: baseWorktree.path });
      pullSpinner.succeed(`Pulled ${base}`);
      pulled = true;
    } catch (error) {
      pullSpinner.fail(`Pull failed for ${base}`);
      if (isAuthenticationError(error)) throw GitErrors.authenticationFailed('work finish');
      if (isNetworkError(error)) throw GitErrors.networkError('work finish');
      throw GitErrors.unknown('work finish', error);
    }
  } else if (options.pull !== false) {
    ui.warn(`Skipped pulling ${base} because no worktree has it checked out.`);
  }

  // Remove worktree (if any)
  let worktreeRemoved = false;
  let worktreePath: string | undefined;
  if (options.keepWorktree !== true && targetWorktree && !targetIsPrimary) {
    worktreePath = targetWorktree.path;
    const wtSpinner = ui.spinner(`Removing worktree ${targetWorktree.path}`);
    wtSpinner.start();
    try {
      const removeArgs = ['worktree', 'remove', targetWorktree.path];
      if (options.force) removeArgs.push('--force');
      await execa('git', removeArgs, { cwd: controlWorktree.path });
      wtSpinner.succeed(`Removed worktree ${targetWorktree.path}`);
      worktreeRemoved = true;
    } catch (error) {
      wtSpinner.fail(`Failed to remove worktree ${targetWorktree.path}`);
      throw GitErrors.unknown('work finish', error);
    }
  }

  // Delete branch. `-D` covers squash-merged branches that `git branch -d`
  // would refuse because the ref tree doesn't match base.
  const delSpinner = ui.spinner(`Deleting local branch ${branch}`);
  delSpinner.start();
  let branchDeleted: boolean;
  try {
    await execa('git', ['branch', '-D', branch], { cwd: controlWorktree.path });
    delSpinner.succeed(`Deleted ${branch}`);
    branchDeleted = true;
  } catch (error) {
    delSpinner.fail(`Failed to delete ${branch}`);
    throw GitErrors.unknown('work finish', error);
  }

  const contextUpdated = await markWorkItemDone(branch, agentDbPath);

  const result: WorkFinishResult = {
    branch,
    base,
    mergedOnRemote,
    branchDeleted,
    worktreeRemoved,
    pulled,
    contextUpdated,
  };
  if (prInfo?.url) result.prUrl = prInfo.url;
  if (worktreePath !== undefined) result.worktreePath = worktreePath;
  return result;
}

export function createWorkFinishCommand(): Command {
  const command = new Command('finish');

  command
    .description('After a PR merges: update the base, delete the local branch, remove any worktree')
    .argument('[branch]', 'branch to finish (default: current branch)')
    .option('--base <branch>', 'base branch (default: origin HEAD)')
    .option('--force', 'finish unconfirmed work and allow discarding target worktree changes')
    .option('--no-pull', 'do not pull the base branch')
    .option('--keep-worktree', 'leave the associated worktree in place')
    .addHelpText(
      'after',
      `
Examples:
  After your PR merged, from the feature branch:
    $ neo work finish

  Finish another branch without switching to it:
    $ neo work finish jacek/old-feature

  Agent-friendly:
    $ neo work finish --yes --json

  Force finish an unmerged branch (e.g. abandoned):
    $ neo work finish --force
`
    )
    .action(
      runAction(async (branchArg: string | undefined, options: WorkFinishOptions) => {
        const result = await executeWorkFinish(branchArg, options);
        emitJson(
          {
            ok: true,
            command: 'work finish',
            branch: result.branch,
            base: result.base,
            mergedOnRemote: result.mergedOnRemote,
            prUrl: result.prUrl,
            branchDeleted: result.branchDeleted,
            worktreeRemoved: result.worktreeRemoved,
            worktreePath: result.worktreePath,
            pulled: result.pulled,
            contextUpdated: result.contextUpdated,
          },
          {
            text: () => {
              ui.newline();
              ui.success(`Finished ${result.branch}`);
              ui.muted(
                `Base branch: ${result.base} (${result.pulled ? 'updated' : 'not updated'})`
              );
              if (result.worktreeRemoved && result.worktreePath) {
                ui.muted(`Removed worktree: ${result.worktreePath}`);
              }
              if (result.contextUpdated) {
                ui.muted('Marked work item as done in agent context DB');
              }
            },
          }
        );
      })
    );

  return command;
}
