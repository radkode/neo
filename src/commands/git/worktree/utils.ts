/**
 * Shared utilities for git worktree operations
 */

import { execa } from 'execa';
import { homedir } from 'os';
import { join, basename } from 'path';
import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';

/**
 * Worktree information structure
 */
export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
  lockReason?: string;
  isDirty: boolean;
}

/**
 * Get the repository name from remote URL or directory
 */
export async function getRepoName(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    // Extract repo name from URL (handles .git suffix)
    const match = url.match(/\/([^/]+?)(\.git)?$/);
    return match?.[1] || basename(process.cwd());
  } catch {
    return basename(process.cwd());
  }
}

/**
 * Get the neo worktrees base directory
 */
export function getWorktreesBaseDir(): string {
  return join(homedir(), '.neo', 'worktrees');
}

/**
 * Get the worktree path for a given repo and branch
 */
export function getWorktreePath(repoName: string, branchName: string): string {
  // Sanitize branch name (replace / with -, remove special chars)
  const sanitizedBranch = branchName
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '');
  return join(getWorktreesBaseDir(), repoName, sanitizedBranch);
}

/**
 * Ensure the worktrees directory structure exists
 */
export async function ensureWorktreeDir(repoName: string): Promise<string> {
  const dir = join(getWorktreesBaseDir(), repoName);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Parse git worktree list --porcelain output
 */
export function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const entries = output.trim().split('\n\n');

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const lines = entry.split('\n');
    const info: Partial<WorktreeInfo> = {
      isMain: false,
      isLocked: false,
      isDirty: false,
    };

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        info.path = line.substring(9);
      } else if (line.startsWith('HEAD ')) {
        info.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        info.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        info.isMain = true;
      } else if (line === 'detached') {
        info.branch = null;
      } else if (line === 'locked') {
        info.isLocked = true;
      } else if (line.startsWith('locked ')) {
        info.isLocked = true;
        info.lockReason = line.substring(7);
      }
    }

    if (info.path && info.head) {
      worktrees.push(info as WorktreeInfo);
    }
  }

  return worktrees;
}

/**
 * Get all worktrees for the current repository
 */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktreeList(stdout);

  // Mark the first worktree as main
  if (worktrees.length > 0 && worktrees[0]) {
    worktrees[0].isMain = true;
  }

  // Check for dirty state in parallel
  await Promise.all(
    worktrees.map(async (wt) => {
      try {
        const { stdout: status } = await execa('git', ['-C', wt.path, 'status', '--porcelain']);
        wt.isDirty = status.trim().length > 0;
      } catch {
        wt.isDirty = false;
      }
    })
  );

  return worktrees;
}

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

/**
 * Format worktree status for display
 */
export function formatWorktreeStatus(wt: WorktreeInfo): string {
  const parts: string[] = [];

  if (wt.isMain) parts.push('main');
  if (wt.isLocked) parts.push('locked');
  if (wt.isDirty) parts.push('dirty');
  if (!wt.branch) parts.push('detached');

  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

/**
 * Copy text to clipboard using pbcopy (macOS) or xclip/xsel (Linux)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;

    if (platform === 'darwin') {
      await execa('pbcopy', { input: text });
      return true;
    } else if (platform === 'linux') {
      try {
        await execa('xclip', ['-selection', 'clipboard'], { input: text });
        return true;
      } catch {
        try {
          await execa('xsel', ['--clipboard', '--input'], { input: text });
          return true;
        } catch {
          return false;
        }
      }
    } else if (platform === 'win32') {
      await execa('clip', { input: text });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
