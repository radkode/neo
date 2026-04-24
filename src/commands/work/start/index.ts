import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import {
  GitErrors,
  isNotGitRepository,
  isAuthenticationError,
  isNetworkError,
} from '@/utils/git-errors.js';
import { getProjectRoot, isAgentInitialized, getAgentDbPath } from '@/utils/agent.js';
import { ContextDB } from '@/storage/db.js';

interface WorkStartOptions {
  /**
   * Commander encodes `--prefix <name>` + `--no-prefix` as a single field
   * that's either a string (explicit prefix), `false` (explicit skip), or
   * `undefined` (fall back to the derived default).
   */
  prefix?: string | false;
  from?: string;
  worktree?: boolean;
}

interface WorkStartResult {
  branch: string;
  base: string;
  worktreePath?: string;
  previousBranch: string;
  contextRecorded: boolean;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
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
      'Could not detect default branch. Pass --from <ref>, or run `git remote set-head origin --auto`.'
    );
  }
}

async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

async function readGitUserName(): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['config', '--get', 'user.name']);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Turn a git user.name ("Jacek Radko", "jdoe", "First Last") into a safe
 * branch prefix. Lowercased, non-alphanumeric → '-', leading segment only
 * (so "Jacek Radko" → "jacek" rather than "jacek-radko"). Mirrors the
 * convention in the user's CLAUDE.md without forcing them to configure it.
 */
function userNameToPrefix(userName: string): string | null {
  const firstToken = userName.trim().split(/\s+/)[0] ?? '';
  const normalized = firstToken.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return normalized.length > 0 ? normalized : null;
}

async function resolveBranchName(
  raw: string,
  options: WorkStartOptions
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Branch name is required.');
  }

  if (options.prefix === false) return trimmed;
  if (trimmed.includes('/')) return trimmed;

  if (typeof options.prefix === 'string' && options.prefix.length > 0) {
    const clean = options.prefix.replace(/\/+$/, '');
    return `${clean}/${trimmed}`;
  }

  const userName = await readGitUserName();
  const derived = userName ? userNameToPrefix(userName) : null;
  if (!derived) {
    throw new Error(
      'Could not derive a branch prefix from git user.name. Pass --prefix <name> or --no-prefix.'
    );
  }
  return `${derived}/${trimmed}`;
}

async function branchExistsLocally(branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function recordWorkItemInAgentDb(payload: {
  branch: string;
  base: string;
  worktreePath?: string;
}): Promise<boolean> {
  if (!(await isAgentInitialized())) return false;
  const dbPath = await getAgentDbPath();
  if (!dbPath) return false;

  let db: ContextDB | null = null;
  try {
    db = await ContextDB.create(dbPath);
    db.addContext({
      content: JSON.stringify({
        kind: 'work-item',
        branch: payload.branch,
        base: payload.base,
        worktreePath: payload.worktreePath ?? null,
        createdAt: new Date().toISOString(),
      }),
      tags: ['work-item', 'active', `branch:${payload.branch}`],
      priority: 'medium',
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function executeWorkStart(
  rawName: string,
  options: WorkStartOptions
): Promise<WorkStartResult> {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (isNotGitRepository(error)) throw GitErrors.notARepository('work start');
    throw GitErrors.unknown('work start', error);
  }

  const previousBranch = await getCurrentBranch();
  const branch = await resolveBranchName(rawName, options);

  if (await branchExistsLocally(branch)) {
    throw new Error(
      `Branch "${branch}" already exists locally. Run \`git checkout ${branch}\` to switch to it.`
    );
  }

  const base = options.from ?? `origin/${await detectDefaultBranch()}`;

  // Fetch the base explicitly so we branch off the freshest tip. Skip when
  // the user passed a local ref — they've already decided what's current.
  if (base.startsWith('origin/')) {
    const remoteBranch = base.replace(/^origin\//, '');
    const fetchSpinner = ui.spinner(`Fetching ${base}`);
    fetchSpinner.start();
    try {
      await execa('git', ['fetch', 'origin', remoteBranch]);
      fetchSpinner.succeed(`Fetched ${base}`);
    } catch (error) {
      fetchSpinner.fail(`Fetch failed for ${base}`);
      if (isAuthenticationError(error)) throw GitErrors.authenticationFailed('work start');
      if (isNetworkError(error)) throw GitErrors.networkError('work start');
      throw GitErrors.unknown('work start', error);
    }
  }

  let worktreePath: string | undefined;

  if (options.worktree) {
    const projectRoot = (await getProjectRoot()) ?? (await execa('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
    // Last path segment only — "jacek/fix-foo" → "fix-foo" for the dir name.
    const lastSegment = branch.split('/').pop() ?? branch;
    const wtAbs = resolve(projectRoot, '.worktrees', lastSegment);

    if (await pathExists(wtAbs)) {
      throw new Error(`Worktree path already exists: ${wtAbs}`);
    }

    const wtSpinner = ui.spinner(`Creating worktree at .worktrees/${lastSegment}`);
    wtSpinner.start();
    try {
      await execa('git', ['worktree', 'add', '-b', branch, wtAbs, base]);
      wtSpinner.succeed(`Created worktree at .worktrees/${lastSegment}`);
      worktreePath = wtAbs;
    } catch (error) {
      wtSpinner.fail('Worktree creation failed');
      throw GitErrors.unknown('work start', error);
    }
  } else {
    const coSpinner = ui.spinner(`Creating branch ${branch} from ${base}`);
    coSpinner.start();
    try {
      await execa('git', ['checkout', '-b', branch, base]);
      coSpinner.succeed(`Created branch ${branch} from ${base}`);
    } catch (error) {
      coSpinner.fail('Branch creation failed');
      throw GitErrors.unknown('work start', error);
    }
  }

  const contextRecorded = await recordWorkItemInAgentDb({
    branch,
    base,
    ...(worktreePath !== undefined ? { worktreePath } : {}),
  });

  const result: WorkStartResult = {
    branch,
    base,
    previousBranch,
    contextRecorded,
  };
  if (worktreePath !== undefined) result.worktreePath = worktreePath;
  return result;
}

export function createWorkStartCommand(): Command {
  const command = new Command('start');

  command
    .description('Start a new piece of work: create a prefixed branch (and optionally a worktree)')
    .argument('<name>', 'branch name (e.g. fix-login-redirect or CLRK-123-fix-login)')
    .option('--prefix <name>', 'branch prefix (default: lowercased first token of git user.name)')
    .option('--no-prefix', 'skip automatic prefixing')
    .option('--from <ref>', 'base ref (default: origin/<default-branch>)')
    .option('--worktree', 'create under .worktrees/<name>/ instead of checking out in place')
    .addHelpText(
      'after',
      `
Examples:
  New branch off origin/main with auto prefix:
    $ neo work start fix-login-redirect
    # → creates jacek/fix-login-redirect (for user jacek)

  Start in a worktree (keeps your current branch intact):
    $ neo work start fix-login-redirect --worktree

  Override the prefix:
    $ neo work start 123-auth-bug --prefix team

  From a specific ref:
    $ neo work start experiment --from origin/develop

  Agent-friendly:
    $ neo work start fix-foo --yes --json
`
    )
    .action(
      runAction(async (name: string, options: WorkStartOptions) => {
        const result = await executeWorkStart(name, options);
        emitJson(
          {
            ok: true,
            command: 'work start',
            branch: result.branch,
            base: result.base,
            worktreePath: result.worktreePath,
            previousBranch: result.previousBranch,
            contextRecorded: result.contextRecorded,
          },
          {
            text: () => {
              if (result.worktreePath) {
                ui.newline();
                ui.success(`Worktree ready: ${result.worktreePath}`);
                ui.muted(`  cd ${result.worktreePath}`);
              } else {
                ui.newline();
                ui.success(`On branch ${result.branch} (from ${result.base})`);
              }
              if (result.contextRecorded) {
                ui.muted('Recorded work item in .neo/agent/context.db');
              }
            },
          }
        );
      })
    );

  return command;
}
