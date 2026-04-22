import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import {
  GitErrors,
  isAuthenticationError,
  isConflictError,
  isNetworkError,
  isNotGitRepository,
} from '@/utils/git-errors.js';

interface SyncOptions {
  merge?: boolean;
  branch?: string;
  stash?: boolean;
}

interface SyncResult {
  branch: string;
  base: string;
  strategy: 'rebase' | 'merge';
  stashed: boolean;
  ahead: number;
  behind: number;
}

/**
 * Resolve the default branch name from origin's HEAD. Falls back to probing
 * `origin/main` then `origin/master` for repos where `git remote set-head`
 * has never run. Throws a helpful message if none resolve.
 */
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
      'Could not detect default branch. Run `git remote set-head origin --auto`, or pass --branch <name>.'
    );
  }
}

async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

async function isTreeDirty(): Promise<boolean> {
  const { stdout } = await execa('git', ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

async function tryPopStash(): Promise<void> {
  try {
    await execa('git', ['stash', 'pop']);
    ui.muted('Restored stashed changes.');
  } catch {
    ui.warn('Stash pop failed; run `git stash list` to recover.');
  }
}

export async function executeSync(options: SyncOptions): Promise<SyncResult> {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (isNotGitRepository(error)) {
      throw GitErrors.notARepository('sync');
    }
    throw GitErrors.unknown('sync', error);
  }

  const currentBranch = await getCurrentBranch();
  if (!currentBranch) {
    throw new Error('Detached HEAD — check out a branch before syncing.');
  }

  const targetBranch = options.branch ?? (await detectDefaultBranch());
  const strategy: 'rebase' | 'merge' = options.merge ? 'merge' : 'rebase';
  const allowStash = options.stash !== false;

  let stashed = false;
  if (await isTreeDirty()) {
    if (!allowStash) {
      throw new Error(
        'Working tree has uncommitted changes. Commit them first, or drop --no-stash to auto-stash.'
      );
    }
    const stashSpinner = ui.spinner('Stashing local changes');
    stashSpinner.start();
    try {
      await execa('git', [
        'stash',
        'push',
        '--include-untracked',
        '--message',
        'neo sync: auto-stash',
      ]);
      stashed = true;
      stashSpinner.succeed('Stashed local changes');
    } catch (error) {
      stashSpinner.fail('Failed to stash local changes');
      throw GitErrors.unknown('sync', error);
    }
  }

  const rebaseTarget = `origin/${targetBranch}`;
  const fetchSpinner = ui.spinner(`Fetching ${rebaseTarget}`);
  fetchSpinner.start();
  try {
    await execa('git', ['fetch', 'origin', targetBranch]);
    fetchSpinner.succeed(`Fetched ${rebaseTarget}`);
  } catch (error) {
    fetchSpinner.fail('Fetch failed');
    if (stashed) await tryPopStash();
    if (isAuthenticationError(error)) throw GitErrors.authenticationFailed('sync');
    if (isNetworkError(error)) throw GitErrors.networkError('sync');
    throw GitErrors.unknown('sync', error);
  }

  const verb = strategy === 'rebase' ? 'Rebasing' : 'Merging';
  const applySpinner = ui.spinner(`${verb} onto ${rebaseTarget}`);
  applySpinner.start();
  try {
    if (strategy === 'rebase') {
      await execa('git', ['rebase', rebaseTarget]);
    } else {
      await execa('git', ['merge', '--no-ff', rebaseTarget]);
    }
    applySpinner.succeed(`${verb === 'Rebasing' ? 'Rebased' : 'Merged'} onto ${rebaseTarget}`);
  } catch (error) {
    applySpinner.fail(`${verb} failed`);
    // Don't pop the stash — user needs to resolve the conflict first; popping
    // now would compound merge conflicts with stash conflicts.
    if (isConflictError(error)) {
      if (strategy === 'rebase') throw GitErrors.rebaseConflict('sync');
      throw GitErrors.mergeConflict('sync');
    }
    throw GitErrors.unknown('sync', error);
  }

  if (stashed) {
    const popSpinner = ui.spinner('Restoring stashed changes');
    popSpinner.start();
    try {
      await execa('git', ['stash', 'pop']);
      popSpinner.succeed('Restored stashed changes');
    } catch {
      popSpinner.warn('Stash pop had conflicts — left stash in place. Run `git stash list`.');
    }
  }

  const { stdout } = await execa('git', [
    'rev-list',
    '--left-right',
    '--count',
    `${rebaseTarget}...HEAD`,
  ]);
  const [behindStr, aheadStr] = stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindStr ?? '0', 10) || 0;
  const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0;

  return {
    branch: currentBranch,
    base: targetBranch,
    strategy,
    stashed,
    ahead,
    behind,
  };
}

export function createSyncCommand(): Command {
  const command = new Command('sync');

  command
    .description('Rebase the current branch onto origin/<default-branch>, auto-stashing if dirty')
    .option('--merge', 'use merge (--no-ff) instead of rebase')
    .option('--branch <name>', 'sync against a specific remote branch (default: origin HEAD)')
    .option('--no-stash', 'do not auto-stash a dirty tree — fail instead')
    .addHelpText(
      'after',
      `
Examples:
  Rebase current branch onto origin/<default>:
    $ neo sync

  Merge instead of rebase:
    $ neo sync --merge

  Sync against a non-default base:
    $ neo sync --branch develop

  Agent-friendly (structured output):
    $ neo sync --yes --json
`
    )
    .action(
      runAction(async (options: SyncOptions) => {
        const result = await executeSync(options);
        emitJson(
          {
            ok: true,
            command: 'sync',
            branch: result.branch,
            base: result.base,
            strategy: result.strategy,
            stashed: result.stashed,
            ahead: result.ahead,
            behind: result.behind,
          },
          {
            text: () => {
              ui.success(`Synced ${result.branch} onto origin/${result.base}`);
              ui.muted(`ahead: ${result.ahead}, behind: ${result.behind}`);
              if (result.stashed) {
                ui.muted('auto-stash restored');
              }
            },
          }
        );
      })
    );

  return command;
}
