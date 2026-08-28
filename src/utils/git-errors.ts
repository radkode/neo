/**
 * Shared git error handling utilities
 * Provides consistent error detection and handling across all git commands
 */

import { stripVTControlCharacters } from 'node:util';
import {
  AppError,
  ErrorSeverity,
  ErrorCategory,
  type Result,
  failure,
} from '@/core/errors/index.js';

/**
 * Git-specific error codes
 */
export enum GitErrorCode {
  NOT_A_REPOSITORY = 'GIT_NOT_A_REPOSITORY',
  NO_UPSTREAM = 'GIT_NO_UPSTREAM',
  AUTHENTICATION_FAILED = 'GIT_AUTHENTICATION_FAILED',
  NETWORK_ERROR = 'GIT_NETWORK_ERROR',
  MERGE_CONFLICT = 'GIT_MERGE_CONFLICT',
  REBASE_CONFLICT = 'GIT_REBASE_CONFLICT',
  UNCOMMITTED_CHANGES = 'GIT_UNCOMMITTED_CHANGES',
  NON_FAST_FORWARD = 'GIT_NON_FAST_FORWARD',
  NOTHING_TO_COMMIT = 'GIT_NOTHING_TO_COMMIT',
  NO_STAGED_CHANGES = 'GIT_NO_STAGED_CHANGES',
  REMOTE_BRANCH_DELETED = 'GIT_REMOTE_BRANCH_DELETED',
  STASH_NOT_FOUND = 'GIT_STASH_NOT_FOUND',
  STASH_APPLY_CONFLICT = 'GIT_STASH_APPLY_CONFLICT',
  STASH_NOTHING_TO_STASH = 'GIT_STASH_NOTHING_TO_STASH',
  WORKTREE_NOT_FOUND = 'GIT_WORKTREE_NOT_FOUND',
  WORKTREE_ALREADY_EXISTS = 'GIT_WORKTREE_ALREADY_EXISTS',
  WORKTREE_BRANCH_CHECKED_OUT = 'GIT_WORKTREE_BRANCH_CHECKED_OUT',
  UNKNOWN = 'GIT_UNKNOWN_ERROR',
}

/**
 * Git-specific error class
 */
export class GitError extends AppError {
  readonly code: string;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly category = ErrorCategory.COMMAND;

  constructor(
    message: string,
    public readonly gitErrorCode: GitErrorCode,
    public readonly commandName: string,
    options?: {
      context?: Record<string, unknown>;
      suggestions?: string[];
      originalError?: Error;
    }
  ) {
    super(message, options);
    this.code = gitErrorCode;
  }
}

/**
 * Error detection patterns for git commands
 */
interface GitErrorPattern {
  code: GitErrorCode;
  patterns: string[];
  message: string;
  getSuggestions: (context: GitErrorContext) => string[];
}

/**
 * Context for error handling
 */
export interface GitErrorContext {
  commandName: string;
  branchName?: string;
  error?: unknown;
}

const GIT_DETAIL_MAX_LINES = 20;
const GIT_DETAIL_MAX_CHARS = 8_000;
const GIT_COMMAND_MAX_CHARS = 2_000;

type GitProcessError = Error & {
  command?: unknown;
  escapedCommand?: unknown;
  exitCode?: unknown;
  shortMessage?: unknown;
  stderr?: unknown;
};

/**
 * Common git error patterns
 */
const GIT_ERROR_PATTERNS: GitErrorPattern[] = [
  {
    code: GitErrorCode.NOT_A_REPOSITORY,
    patterns: ['not a git repository', 'fatal: not a git repository'],
    message: 'Not a git repository!',
    getSuggestions: () => ['Make sure you are in a git repository directory'],
  },
  {
    code: GitErrorCode.AUTHENTICATION_FAILED,
    patterns: ['authentication', 'permission denied', 'could not read from remote'],
    message: 'Authentication failed!',
    getSuggestions: () => ['Check your git credentials or SSH keys'],
  },
  {
    code: GitErrorCode.NO_UPSTREAM,
    patterns: ['no upstream branch', 'no tracking information', 'no such ref was fetched'],
    message: 'No upstream branch configured!',
    getSuggestions: (ctx) => [
      `Set an upstream branch: git branch --set-upstream-to=origin/${ctx.branchName || 'your-branch'} ${ctx.branchName || 'your-branch'}`,
      `Or push with upstream: git push -u origin ${ctx.branchName || 'your-branch'}`,
    ],
  },
  {
    code: GitErrorCode.NETWORK_ERROR,
    patterns: ['could not resolve host', 'network is unreachable', 'connection refused'],
    message: 'Network error!',
    getSuggestions: () => ['Check your internet connection'],
  },
  {
    // Refusals to start must win over conflict recovery.
    code: GitErrorCode.UNCOMMITTED_CHANGES,
    patterns: [
      'cannot pull with rebase',
      'please commit or stash them',
      'your local changes to the following files would be overwritten',
      'untracked working tree files would be overwritten',
      'you have unstaged changes',
      'cannot rebase: your index contains uncommitted changes',
    ],
    message: 'You have uncommitted changes.',
    getSuggestions: () => [
      'Stash them: git stash push -u',
      'Or commit them: neo git commit',
      'Then retry the pull',
    ],
  },
  {
    // Specific conflict signatures must precede generic merge markers.
    code: GitErrorCode.STASH_APPLY_CONFLICT,
    patterns: ['could not apply stash', 'stash entry is kept', 'needs merge'],
    message: 'Conflicts detected when applying stash!',
    getSuggestions: () => [
      'Resolve conflicts manually in your editor',
      'Stage resolved files: git add <files>',
      'The stash was not dropped - you can retry after resolving',
    ],
  },
  {
    code: GitErrorCode.REBASE_CONFLICT,
    // Patterns are OR-matched, so each entry must identify a real conflict.
    patterns: [
      'could not apply',
      'resolve all conflicts manually',
      'after resolving the conflicts',
    ],
    message: 'Rebase hit conflicts.',
    getSuggestions: () => [
      'Fix conflicts in your editor',
      'Stage resolved files: git add <files>',
      'Continue rebase: git rebase --continue',
      'Or abort the rebase: git rebase --abort',
    ],
  },
  {
    code: GitErrorCode.MERGE_CONFLICT,
    patterns: [
      'merge conflict',
      'automatic merge failed',
      'fix conflicts',
      'conflict (',
      'unmerged files',
      'unresolved conflict',
    ],
    message: 'Merge conflicts detected!',
    getSuggestions: () => [
      'Fix conflicts in your editor',
      'Stage resolved files: git add <files>',
      'Commit the merge: git commit',
    ],
  },
  {
    code: GitErrorCode.NON_FAST_FORWARD,
    patterns: [
      'non-fast-forward',
      'fetch first',
      'behind',
      'remote contains',
      'tip of your current branch is behind',
      'divergent',
      'diverging',
      'not possible to fast-forward',
    ],
    message: 'Push was rejected because the remote has new commits.',
    getSuggestions: () => [
      'Pull the latest changes: git pull --rebase',
      'Or force push if intentional: git push --force',
    ],
  },
  {
    code: GitErrorCode.NOTHING_TO_COMMIT,
    patterns: ['nothing to commit', 'working tree clean'],
    message: 'Nothing to commit',
    getSuggestions: () => ['All changes are already committed'],
  },
  {
    code: GitErrorCode.NO_STAGED_CHANGES,
    patterns: ['no changes added to commit', 'nothing added to commit'],
    message: 'No files staged for commit',
    getSuggestions: () => [
      'Stage specific files: git add <file>',
      'Stage all changes: git add .',
      'Use --all flag: neo git commit --all',
    ],
  },
  {
    code: GitErrorCode.REMOTE_BRANCH_DELETED,
    patterns: ['no such ref was fetched', 'but no such ref was fetched'],
    message: 'Remote branch no longer exists!',
    getSuggestions: (ctx) => [
      `Your local branch "${ctx.branchName}" is tracking a remote branch that has been deleted`,
      'Switch to main: git checkout main',
      `Or set a new upstream: git branch --set-upstream-to=origin/${ctx.branchName} ${ctx.branchName}`,
    ],
  },
  {
    code: GitErrorCode.STASH_NOT_FOUND,
    patterns: ['no stash entries found', 'does not exist', 'stash@{', 'log for'],
    message: 'Stash not found!',
    getSuggestions: () => [
      'Use "neo git stash list" to see available stashes',
      'The stash may have been dropped or applied already',
    ],
  },
  {
    code: GitErrorCode.STASH_NOTHING_TO_STASH,
    patterns: ['no local changes to save', 'no changes added to commit but untracked'],
    message: 'No changes to stash!',
    getSuggestions: () => [
      'Make some changes first, then try stashing again',
      'Use "git status" to see the current state',
      'Use --include-untracked to stash untracked files',
    ],
  },
  {
    code: GitErrorCode.WORKTREE_ALREADY_EXISTS,
    patterns: ['already exists', 'already a worktree'],
    message: 'Worktree already exists!',
    getSuggestions: () => [
      'Use "neo git worktree list" to see existing worktrees',
      'Remove the existing worktree first with "neo git worktree remove"',
    ],
  },
  {
    code: GitErrorCode.WORKTREE_BRANCH_CHECKED_OUT,
    patterns: ['is already checked out', 'already used by worktree'],
    message: 'Branch is already checked out in another worktree!',
    getSuggestions: () => [
      'Use "neo git worktree switch" to switch to the existing worktree',
      'Or create a new branch with: git checkout -b new-branch',
    ],
  },
];

/**
 * Extract error message from various error types
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const shortMessage = (error as { shortMessage?: string }).shortMessage ?? '';
    return `${error.message} ${stderr} ${shortMessage}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

function redactCredentials(value: string): string {
  return value
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)([^/\s@]+)@/gi, '$1***@')
    .replace(/([?&](?:access_token|auth|password|token|x-amz-signature)=)[^&#\s'"]+/gi, '$1***')
    .replace(
      /((?:authorization|job-token|private-token|proxy-authorization|x-auth-token)\s*[:=]\s*(?:basic|bearer)?\s*)[^\s'"]+/gi,
      '$1***'
    );
}

function sanitizeText(value: string): string {
  const sanitized: string[] = [];
  for (const character of stripVTControlCharacters(value)) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      (codePoint >= 0x20 && codePoint !== 0x7f && (codePoint < 0x80 || codePoint > 0x9f))
    ) {
      sanitized.push(character);
    }
  }
  return sanitized.join('');
}

function maskMessageArguments(value: string): string {
  return value
    .replace(/(^|\s)--message(?:=|\s+)[\s\S]*$/g, '$1--message=***')
    .replace(/(^|\s)-m(?:\s+|\S)[\s\S]*$/g, '$1-m ***');
}

function formatCommand(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = maskMessageArguments(
    redactCredentials(sanitizeText(value)).trim().replace(/\n/g, '\\n')
  );
  if (!cleaned) return undefined;
  const suffix = ' [truncated]';
  return cleaned.length > GIT_COMMAND_MAX_CHARS
    ? `${cleaned.slice(0, GIT_COMMAND_MAX_CHARS - suffix.length)}${suffix}`
    : cleaned;
}

function outputTail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = maskMessageArguments(redactCredentials(sanitizeText(value))).trim();
  if (!cleaned) return undefined;
  const lines = cleaned.split('\n').slice(-GIT_DETAIL_MAX_LINES).join('\n');
  return lines.slice(-GIT_DETAIL_MAX_CHARS);
}

function gitErrorContext(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    const detail = outputTail(String(error));
    return detail ? { error: detail } : {};
  }

  const processError = error as GitProcessError;
  const context: Record<string, unknown> = {};
  const command = formatCommand(processError.escapedCommand) ?? formatCommand(processError.command);
  if (command) context['command'] = command;
  if (typeof processError.exitCode === 'number' && Number.isInteger(processError.exitCode)) {
    context['exitCode'] = processError.exitCode;
  }

  const stderr = outputTail(processError.stderr);
  if (stderr) {
    context['stderr'] = stderr;
    context['error'] = stderr;
    return context;
  }

  const shortMessage =
    typeof processError.shortMessage === 'string' ? processError.shortMessage : undefined;
  const messageWithoutPrefix =
    shortMessage && error.message.startsWith(shortMessage)
      ? error.message.slice(shortMessage.length).trim()
      : error.message;
  const detail = outputTail(messageWithoutPrefix) ?? outputTail(shortMessage);
  if (detail) context['error'] = detail;
  return context;
}

function gitErrorOptions(
  suggestions: string[],
  error?: unknown
): {
  suggestions: string[];
  context?: Record<string, unknown>;
  originalError?: Error;
} {
  const options: {
    suggestions: string[];
    context?: Record<string, unknown>;
    originalError?: Error;
  } = { suggestions };
  if (error !== undefined) options.context = gitErrorContext(error);
  if (error instanceof Error) options.originalError = error;
  return options;
}

/**
 * Detect git error type from error object
 */
export function detectGitError(error: unknown, context: GitErrorContext): GitError {
  const errorMessage = extractErrorMessage(error);

  for (const pattern of GIT_ERROR_PATTERNS) {
    const matches = pattern.patterns.some((p) => errorMessage.includes(p.toLowerCase()));
    if (matches) {
      const options: {
        suggestions: string[];
        context: Record<string, unknown>;
        originalError?: Error;
      } = {
        suggestions: pattern.getSuggestions(context),
        context: gitErrorContext(error),
      };
      if (error instanceof Error) {
        options.originalError = error;
      }
      return new GitError(pattern.message, pattern.code, context.commandName, options);
    }
  }

  // Unknown git error
  const unknownOptions: {
    context: Record<string, unknown>;
    originalError?: Error;
  } = {
    context: gitErrorContext(error),
  };
  if (error instanceof Error) {
    unknownOptions.originalError = error;
  }
  return new GitError(
    `Git command failed: ${context.commandName}`,
    GitErrorCode.UNKNOWN,
    context.commandName,
    unknownOptions
  );
}

/**
 * Check if error matches a specific git error code
 */
export function isGitError(error: unknown, code: GitErrorCode): boolean {
  const errorMessage = extractErrorMessage(error);
  const pattern = GIT_ERROR_PATTERNS.find((p) => p.code === code);
  if (!pattern) return false;
  return pattern.patterns.some((p) => errorMessage.includes(p.toLowerCase()));
}

/**
 * Create a failure Result from a git error
 */
export function gitFailure(error: unknown, context: GitErrorContext): Result<never, GitError> {
  const gitError = detectGitError(error, context);
  return failure(gitError);
}

/**
 * Check if error is "not a git repository" error
 */
export function isNotGitRepository(error: unknown): boolean {
  return isGitError(error, GitErrorCode.NOT_A_REPOSITORY);
}

/**
 * Check if error is authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.AUTHENTICATION_FAILED);
}

/**
 * Check if error is upstream error
 */
export function isNoUpstreamError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.NO_UPSTREAM);
}

/**
 * Check if error is network error
 */
export function isNetworkError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.NETWORK_ERROR);
}

/**
 * Check if error is conflict error (merge or rebase)
 */
export function isConflictError(error: unknown): boolean {
  return (
    isGitError(error, GitErrorCode.MERGE_CONFLICT) ||
    isGitError(error, GitErrorCode.REBASE_CONFLICT)
  );
}

/**
 * Check if error is git refusing to start because the working tree is dirty
 */
export function isUncommittedChangesError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.UNCOMMITTED_CHANGES);
}

/**
 * Check if error is non-fast-forward/diverged error
 */
export function isNonFastForwardError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.NON_FAST_FORWARD);
}

/**
 * Check if error is stash not found error
 */
export function isStashNotFoundError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.STASH_NOT_FOUND);
}

/**
 * Check if error is stash apply conflict error
 */
export function isStashApplyConflictError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.STASH_APPLY_CONFLICT);
}

/**
 * Check if error is nothing to stash error
 */
export function isNothingToStashError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.STASH_NOTHING_TO_STASH);
}

/**
 * Create specific git errors with appropriate messages and suggestions
 */
export const GitErrors = {
  notARepository(commandName: string, error?: unknown): GitError {
    return new GitError(
      'Not a git repository!',
      GitErrorCode.NOT_A_REPOSITORY,
      commandName,
      gitErrorOptions(['Make sure you are in a git repository directory'], error)
    );
  },

  authenticationFailed(commandName: string, error?: unknown): GitError {
    return new GitError(
      'Authentication failed!',
      GitErrorCode.AUTHENTICATION_FAILED,
      commandName,
      gitErrorOptions(['Check your git credentials or SSH keys'], error)
    );
  },

  noUpstream(commandName: string, branchName?: string): GitError {
    return new GitError('No upstream branch configured!', GitErrorCode.NO_UPSTREAM, commandName, {
      suggestions: [
        `Set an upstream branch: git branch --set-upstream-to=origin/${branchName || 'your-branch'} ${branchName || 'your-branch'}`,
        `Or push with upstream: git push -u origin ${branchName || 'your-branch'}`,
      ],
    });
  },

  networkError(commandName: string, error?: unknown): GitError {
    return new GitError(
      'Network error!',
      GitErrorCode.NETWORK_ERROR,
      commandName,
      gitErrorOptions(['Check your internet connection'], error)
    );
  },

  mergeConflict(commandName: string, error?: unknown): GitError {
    return new GitError(
      'Merge conflicts detected!',
      GitErrorCode.MERGE_CONFLICT,
      commandName,
      gitErrorOptions(
        [
          'Fix conflicts in your editor',
          'Stage resolved files: git add <files>',
          'Commit the merge: git commit',
        ],
        error
      )
    );
  },

  rebaseConflict(commandName: string, error?: unknown): GitError {
    return new GitError(
      'Rebase hit conflicts.',
      GitErrorCode.REBASE_CONFLICT,
      commandName,
      gitErrorOptions(
        [
          'Fix conflicts in your editor',
          'Stage resolved files: git add <files>',
          'Continue rebase: git rebase --continue',
          'Or abort the rebase: git rebase --abort',
        ],
        error
      )
    );
  },

  uncommittedChanges(commandName: string, error?: unknown): GitError {
    return new GitError(
      'You have uncommitted changes.',
      GitErrorCode.UNCOMMITTED_CHANGES,
      commandName,
      gitErrorOptions(
        ['Stash them: git stash push -u', 'Or commit them: neo git commit', 'Then retry the pull'],
        error
      )
    );
  },

  nonFastForward(commandName: string): GitError {
    return new GitError(
      'Push was rejected because the remote has new commits.',
      GitErrorCode.NON_FAST_FORWARD,
      commandName,
      {
        suggestions: [
          'Pull the latest changes: git pull --rebase',
          'Or force push if intentional: git push --force',
        ],
      }
    );
  },

  nothingToCommit(commandName: string): GitError {
    return new GitError('Nothing to commit', GitErrorCode.NOTHING_TO_COMMIT, commandName, {
      suggestions: ['All changes are already committed'],
    });
  },

  noStagedChanges(commandName: string): GitError {
    return new GitError('No files staged for commit', GitErrorCode.NO_STAGED_CHANGES, commandName, {
      suggestions: [
        'Stage specific files: git add <file>',
        'Stage all changes: git add .',
        'Use --all flag: neo git commit --all',
      ],
    });
  },

  remoteBranchDeleted(commandName: string, branchName: string): GitError {
    return new GitError(
      'Remote branch no longer exists!',
      GitErrorCode.REMOTE_BRANCH_DELETED,
      commandName,
      {
        suggestions: [
          `Your local branch "${branchName}" is tracking a remote branch that has been deleted`,
          'Switch to main: git checkout main',
          `Or set a new upstream: git branch --set-upstream-to=origin/${branchName} ${branchName}`,
        ],
      }
    );
  },

  unknown(commandName: string, error?: unknown): GitError {
    const options: {
      context?: Record<string, unknown>;
      originalError?: Error;
    } = {};
    if (error) {
      options.context = gitErrorContext(error);
    }
    if (error instanceof Error) {
      options.originalError = error;
    }
    return new GitError(
      `Git command failed: ${commandName}`,
      GitErrorCode.UNKNOWN,
      commandName,
      options
    );
  },

  stashNotFound(commandName: string): GitError {
    return new GitError('Stash not found!', GitErrorCode.STASH_NOT_FOUND, commandName, {
      suggestions: [
        'Use "neo git stash list" to see available stashes',
        'The stash may have been dropped or applied already',
      ],
    });
  },

  stashApplyConflict(commandName: string): GitError {
    return new GitError(
      'Conflicts detected when applying stash!',
      GitErrorCode.STASH_APPLY_CONFLICT,
      commandName,
      {
        suggestions: [
          'Resolve conflicts manually in your editor',
          'Stage resolved files: git add <files>',
          'The stash was not dropped - you can retry after resolving',
        ],
      }
    );
  },

  nothingToStash(commandName: string): GitError {
    return new GitError('No changes to stash!', GitErrorCode.STASH_NOTHING_TO_STASH, commandName, {
      suggestions: [
        'Make some changes first, then try stashing again',
        'Use "git status" to see the current state',
        'Use --include-untracked to stash untracked files',
      ],
    });
  },

  worktreeNotFound(commandName: string, path: string): GitError {
    return new GitError(
      `Worktree not found: ${path}`,
      GitErrorCode.WORKTREE_NOT_FOUND,
      commandName,
      {
        suggestions: [
          'Use "neo git worktree list" to see available worktrees',
          'The worktree may have been removed or the path is incorrect',
        ],
      }
    );
  },

  worktreeAlreadyExists(commandName: string, path: string): GitError {
    return new GitError(
      `Worktree already exists at: ${path}`,
      GitErrorCode.WORKTREE_ALREADY_EXISTS,
      commandName,
      {
        suggestions: [
          'Use "neo git worktree list" to see existing worktrees',
          'Remove the existing worktree first with "neo git worktree remove"',
        ],
      }
    );
  },

  worktreeBranchCheckedOut(commandName: string, branch: string): GitError {
    return new GitError(
      `Branch "${branch}" is already checked out in another worktree!`,
      GitErrorCode.WORKTREE_BRANCH_CHECKED_OUT,
      commandName,
      {
        suggestions: [
          'Use "neo git worktree switch" to switch to the existing worktree',
          'Or create a new branch with: git checkout -b new-branch',
        ],
      }
    );
  },
};
