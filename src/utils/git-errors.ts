/**
 * Shared git error handling utilities
 * Provides consistent error detection and handling across all git commands
 */

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
  NON_FAST_FORWARD = 'GIT_NON_FAST_FORWARD',
  NOTHING_TO_COMMIT = 'GIT_NOTHING_TO_COMMIT',
  NO_STAGED_CHANGES = 'GIT_NO_STAGED_CHANGES',
  REMOTE_BRANCH_DELETED = 'GIT_REMOTE_BRANCH_DELETED',
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
    code: GitErrorCode.MERGE_CONFLICT,
    patterns: ['merge conflict', 'automatic merge failed', 'fix conflicts'],
    message: 'Merge conflicts detected!',
    getSuggestions: () => [
      'Fix conflicts in your editor',
      'Stage resolved files: git add <files>',
      'Commit the merge: git commit',
    ],
  },
  {
    code: GitErrorCode.REBASE_CONFLICT,
    patterns: ['rebase', 'conflict'],
    message: 'Rebase hit conflicts.',
    getSuggestions: () => [
      'Fix conflicts in your editor',
      'Stage resolved files: git add <files>',
      'Continue rebase: git rebase --continue',
      'Or abort the rebase: git rebase --abort',
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
        context: { error: error instanceof Error ? error.message : String(error) },
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
    context: { error: error instanceof Error ? error.message : String(error) },
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
  return isGitError(error, GitErrorCode.MERGE_CONFLICT) || isGitError(error, GitErrorCode.REBASE_CONFLICT);
}

/**
 * Check if error is non-fast-forward/diverged error
 */
export function isNonFastForwardError(error: unknown): boolean {
  return isGitError(error, GitErrorCode.NON_FAST_FORWARD);
}

/**
 * Create specific git errors with appropriate messages and suggestions
 */
export const GitErrors = {
  notARepository(commandName: string): GitError {
    return new GitError('Not a git repository!', GitErrorCode.NOT_A_REPOSITORY, commandName, {
      suggestions: ['Make sure you are in a git repository directory'],
    });
  },

  authenticationFailed(commandName: string): GitError {
    return new GitError('Authentication failed!', GitErrorCode.AUTHENTICATION_FAILED, commandName, {
      suggestions: ['Check your git credentials or SSH keys'],
    });
  },

  noUpstream(commandName: string, branchName?: string): GitError {
    return new GitError('No upstream branch configured!', GitErrorCode.NO_UPSTREAM, commandName, {
      suggestions: [
        `Set an upstream branch: git branch --set-upstream-to=origin/${branchName || 'your-branch'} ${branchName || 'your-branch'}`,
        `Or push with upstream: git push -u origin ${branchName || 'your-branch'}`,
      ],
    });
  },

  networkError(commandName: string): GitError {
    return new GitError('Network error!', GitErrorCode.NETWORK_ERROR, commandName, {
      suggestions: ['Check your internet connection'],
    });
  },

  mergeConflict(commandName: string): GitError {
    return new GitError('Merge conflicts detected!', GitErrorCode.MERGE_CONFLICT, commandName, {
      suggestions: [
        'Fix conflicts in your editor',
        'Stage resolved files: git add <files>',
        'Commit the merge: git commit',
      ],
    });
  },

  rebaseConflict(commandName: string): GitError {
    return new GitError('Rebase hit conflicts.', GitErrorCode.REBASE_CONFLICT, commandName, {
      suggestions: [
        'Fix conflicts in your editor',
        'Stage resolved files: git add <files>',
        'Continue rebase: git rebase --continue',
        'Or abort the rebase: git rebase --abort',
      ],
    });
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
    return new GitError('Remote branch no longer exists!', GitErrorCode.REMOTE_BRANCH_DELETED, commandName, {
      suggestions: [
        `Your local branch "${branchName}" is tracking a remote branch that has been deleted`,
        'Switch to main: git checkout main',
        `Or set a new upstream: git branch --set-upstream-to=origin/${branchName} ${branchName}`,
      ],
    });
  },

  unknown(commandName: string, error?: unknown): GitError {
    const options: {
      context?: Record<string, unknown>;
      originalError?: Error;
    } = {};
    if (error) {
      options.context = { error: error instanceof Error ? error.message : String(error) };
    }
    if (error instanceof Error) {
      options.originalError = error;
    }
    return new GitError(`Git command failed: ${commandName}`, GitErrorCode.UNKNOWN, commandName, options);
  },
};
