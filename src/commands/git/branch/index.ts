import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { gitBranchOptionsSchema } from '@/types/schemas.js';
import type { GitBranchOptions } from '@/types/schemas.js';
import {
  type Result,
  success,
  failure,
  isFailure,
  CommandError,
} from '@/core/errors/index.js';

/**
 * Interface for branch information
 */
interface BranchInfo {
  name: string;
  isCurrent: boolean;
  hasRemoteTracking: boolean;
  remoteTrackingBranch?: string | undefined;
  isProtected: boolean; // main, master, develop, etc.
  isRemoteDeleted: boolean; // remote branch exists but is deleted (: gone)
}

/**
 * Interface for branch analysis results
 */
interface BranchAnalysis {
  totalBranches: number;
  currentBranch: string;
  trackedBranches: BranchInfo[];
  untrackedBranches: BranchInfo[];
  deletedRemoteBranches: BranchInfo[];
  cleanupCandidates: BranchInfo[]; // untracked + deleted remote branches
  protectedBranches: BranchInfo[];
}

/**
 * Execute the branch command logic
 * Returns a Result indicating success or failure
 */
export async function executeBranch(options: GitBranchOptions): Promise<Result<void>> {
  const spinner = ui.spinner('Analyzing local branches');
  spinner.start();

  try {
    // Verify we're in a git repository
    await verifyGitRepository();

    // Analyze all local branches
    const analysis = await analyzeBranches();
    spinner.succeed(`Found ${analysis.totalBranches} local branches`);

    // Display branch analysis summary
    displayBranchSummary(analysis);

    // If no cleanup candidates, nothing to clean up
    if (analysis.cleanupCandidates.length === 0) {
      ui.success(
        'All branches are either protected or have active remote tracking - nothing to clean up!'
      );
      return success(undefined);
    }

    // Show branches that could be deleted
    displayCleanupCandidates(analysis);

    // Handle dry run mode
    if (options.dryRun) {
      ui.warn('Dry run mode - no branches will be deleted');
      return success(undefined);
    }

    // Interactive cleanup prompt
    return interactiveBranchCleanup(analysis.cleanupCandidates, options.force);
  } catch (error: unknown) {
    spinner.fail('Failed to analyze branches');

    if (error instanceof Error) {
      if (error.message.includes('not a git repository')) {
        return failure(
          new CommandError('Not a git repository!', 'branch', {
            suggestions: ['Make sure you are in a git repository directory'],
          })
        );
      }

      if (error.message.includes('no branches found')) {
        return failure(
          new CommandError('No local branches found!', 'branch', {
            suggestions: ['This repository appears to have no local branches'],
          })
        );
      }
    }

    return failure(
      new CommandError('An unexpected error occurred', 'branch', {
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    );
  }
}

/**
 * Verify that we're in a git repository
 */
async function verifyGitRepository(): Promise<void> {
  try {
    await execa('git', ['rev-parse', '--git-dir']);
  } catch {
    throw new Error('not a git repository');
  }
}

/**
 * Analyze all local branches and categorize them
 */
async function analyzeBranches(): Promise<BranchAnalysis> {
  try {
    // Get all local branches with verbose info
    const { stdout: branchOutput } = await execa('git', ['branch', '-vv']);

    if (!branchOutput.trim()) {
      throw new Error('no branches found');
    }

    const branchLines = branchOutput.split('\n').filter((line) => line.trim());
    const branches: BranchInfo[] = [];
    let currentBranch = '';

    // Protected branch names (won't be suggested for deletion)
    const protectedBranchNames = [
      'main',
      'master',
      'develop',
      'dev',
      'staging',
      'production',
      'prod',
    ];

    for (const line of branchLines) {
      const branchInfo = await parseBranchLine(line.trim(), protectedBranchNames);
      if (branchInfo) {
        branches.push(branchInfo);
        if (branchInfo.isCurrent) {
          currentBranch = branchInfo.name;
        }
      }
    }

    // Categorize branches
    const trackedBranches = branches.filter((b) => b.hasRemoteTracking && !b.isRemoteDeleted);
    const untrackedBranches = branches.filter(
      (b) => !b.hasRemoteTracking && !b.isCurrent && !b.isProtected
    );
    const deletedRemoteBranches = branches.filter(
      (b) => b.isRemoteDeleted && !b.isCurrent && !b.isProtected
    );
    const cleanupCandidates = [...untrackedBranches, ...deletedRemoteBranches];
    const protectedBranches = branches.filter((b) => b.isProtected);

    logger.debug(`Total branches: ${branches.length}`);
    logger.debug(`Current branch: ${currentBranch}`);
    logger.debug(`Tracked branches: ${trackedBranches.length}`);
    logger.debug(`Untracked branches: ${untrackedBranches.length}`);
    logger.debug(`Deleted remote branches: ${deletedRemoteBranches.length}`);
    logger.debug(`Cleanup candidates: ${cleanupCandidates.length}`);
    logger.debug(`Protected branches: ${protectedBranches.length}`);

    return {
      totalBranches: branches.length,
      currentBranch,
      trackedBranches,
      untrackedBranches,
      deletedRemoteBranches,
      cleanupCandidates,
      protectedBranches,
    };
  } catch (error) {
    logger.debug(`Branch analysis failed: ${error}`);
    throw error;
  }
}

/**
 * Parse a single branch line from git branch -vv output
 */
async function parseBranchLine(
  line: string,
  protectedBranchNames: string[]
): Promise<BranchInfo | null> {
  // Format: "* main    abc1234 [origin/main] Latest commit message"
  //      or "  feature abc1234 Latest commit message" (no tracking)

  const isCurrent = line.startsWith('* ');
  const cleanLine = line.replace(/^\*?\s+/, '');

  // Extract branch name (first word)
  const parts = cleanLine.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const name = parts[0];
  if (!name) {
    return null;
  }

  const isProtected = protectedBranchNames.includes(name);

  // Check for remote tracking info in brackets
  const trackingMatch = cleanLine.match(/\[([^\]]+)\]/);
  const hasRemoteTracking = !!trackingMatch;
  const remoteTrackingBranch = trackingMatch ? trackingMatch[1] : undefined;

  // Check if remote branch is deleted (contains ": gone")
  const isRemoteDeleted = hasRemoteTracking && !!remoteTrackingBranch?.includes(': gone');

  return {
    name,
    isCurrent,
    hasRemoteTracking,
    remoteTrackingBranch,
    isProtected,
    isRemoteDeleted,
  };
}

/**
 * Display a summary of the branch analysis
 */
function displayBranchSummary(analysis: BranchAnalysis): void {
  console.log('');
  ui.section('Branch Analysis');

  ui.keyValue([
    ['Current branch', analysis.currentBranch],
    ['Total branches', analysis.totalBranches.toString()],
    ['With active remote tracking', analysis.trackedBranches.length.toString()],
    ['Without remote tracking', analysis.untrackedBranches.length.toString()],
    ['With deleted remotes', analysis.deletedRemoteBranches.length.toString()],
    ['Available for cleanup', analysis.cleanupCandidates.length.toString()],
    ['Protected branches', analysis.protectedBranches.length.toString()],
  ]);

  if (analysis.trackedBranches.length > 0) {
    console.log('');
    ui.info('Branches with active remote tracking:');
    const trackedList = analysis.trackedBranches.map(
      (b) => `${b.name} → ${b.remoteTrackingBranch}${b.isCurrent ? ' (current)' : ''}`
    );
    ui.list(trackedList);
  }

  if (analysis.protectedBranches.length > 0) {
    console.log('');
    ui.info('Protected branches (will not be deleted):');
    const protectedList = analysis.protectedBranches.map(
      (b) => `${b.name}${b.isCurrent ? ' (current)' : ''}`
    );
    ui.list(protectedList);
  }
}

/**
 * Display cleanup candidates (untracked and deleted remote branches)
 */
function displayCleanupCandidates(analysis: BranchAnalysis): void {
  console.log('');

  if (analysis.cleanupCandidates.length === 0) {
    return;
  }

  ui.warn(`Found ${analysis.cleanupCandidates.length} branch(es) available for cleanup:`);
  console.log('');

  // Create a single consolidated list with clear indicators
  const cleanupList = analysis.cleanupCandidates.map((branch) => {
    if (branch.isRemoteDeleted) {
      return `${branch.name} (remote deleted)`;
    } else {
      return `${branch.name} (no remote)`;
    }
  });

  ui.list(cleanupList);

  // Show summary counts if both types exist
  if (analysis.untrackedBranches.length > 0 && analysis.deletedRemoteBranches.length > 0) {
    console.log('');
    ui.muted(`├─ ${analysis.untrackedBranches.length} without remote tracking`);
    ui.muted(`└─ ${analysis.deletedRemoteBranches.length} with deleted remotes`);
  }

  console.log('');
}

/**
 * Interactive prompt for branch cleanup
 */
async function interactiveBranchCleanup(
  cleanupCandidates: BranchInfo[],
  forceMode: boolean = false
): Promise<Result<void>> {
  const { action } = await inquirer.prompt([
    {
      choices: [
        {
          name: `Delete all ${cleanupCandidates.length} cleanup candidates`,
          short: `Delete all ${cleanupCandidates.length} cleanup candidates`,
          value: 'delete_all',
        },
        {
          name: 'Select specific branches to delete',
          short: 'Select specific branches to delete',
          value: 'delete_selected',
        },
        {
          name: 'Cancel (no changes)',
          short: 'Cancel (no changes)',
          value: 'cancel',
        },
      ],
      message: 'What would you like to do with these branches?',
      name: 'action',
      type: 'list',
    },
  ]);

  switch (action) {
    case 'delete_all':
      return deleteBranches(cleanupCandidates, forceMode);
    case 'delete_selected':
      return selectAndDeleteBranches(cleanupCandidates, forceMode);
    case 'cancel':
      ui.muted('Operation cancelled. No branches were deleted.');
      return success(undefined);
  }

  return success(undefined);
}

/**
 * Allow user to select specific branches to delete
 */
async function selectAndDeleteBranches(
  cleanupCandidates: BranchInfo[],
  forceMode: boolean
): Promise<Result<void>> {
  const { selectedBranches } = await inquirer.prompt({
    choices: cleanupCandidates.map((b) => ({
      name: `${b.name}${b.isRemoteDeleted ? ' (deleted remote)' : ' (no remote)'}`,
      short: `${b.name}${b.isRemoteDeleted ? ' (deleted remote)' : ' (no remote)'}`,
      value: b.name,
    })),
    message: 'Select branches to delete:',
    name: 'selectedBranches',
    type: 'checkbox',
    validate: (choices: readonly { value: unknown }[]) => {
      if (!choices || choices.length === 0) {
        return 'Please select at least one branch';
      }
      return true;
    },
  });

  const branchesToDelete = cleanupCandidates.filter((b) => selectedBranches.includes(b.name));
  return deleteBranches(branchesToDelete, forceMode);
}

/**
 * Delete the specified branches
 */
async function deleteBranches(branches: BranchInfo[], forceMode: boolean): Promise<Result<void>> {
  if (branches.length === 0) {
    ui.info('No branches selected for deletion');
    return success(undefined);
  }

  // Final confirmation unless in force mode
  if (!forceMode) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete ${branches.length} branch(es)?`,
        default: false,
      },
    ]);

    if (!confirm) {
      ui.muted('Operation cancelled. No branches were deleted.');
      return success(undefined);
    }
  }

  const results = {
    deleted: [] as string[],
    failed: [] as { name: string; reason: string }[],
    forceDeleted: [] as string[],
  };

  for (const branch of branches) {
    try {
      // Try regular delete first
      await execa('git', ['branch', '-d', branch.name]);
      results.deleted.push(branch.name);
      ui.success(`Deleted branch "${branch.name}"`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's an unmerged branch error
      if (errorMessage.includes('not fully merged')) {
        // For branches that appear unmerged, check if they've been squash-merged
        const isSquashMerged = await checkIfSquashMerged(branch.name);

        if (isSquashMerged) {
          // Branch content has been integrated via squash merge, safe to delete
          await execa('git', ['branch', '-D', branch.name]);
          results.deleted.push(branch.name);
          ui.success(`Deleted branch "${branch.name}" (content was squash-merged)`);
        } else {
          // Branch has genuinely unmerged changes
          try {
            if (forceMode) {
              await execa('git', ['branch', '-D', branch.name]);
              results.forceDeleted.push(branch.name);
              ui.success(`Force deleted branch "${branch.name}"`);
              ui.warn('This branch had unmerged changes');
            } else {
              const { forceDelete } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'forceDelete',
                  message: `Branch "${branch.name}" has unmerged changes. Force delete?`,
                  default: false,
                },
              ]);

              if (forceDelete) {
                await execa('git', ['branch', '-D', branch.name]);
                results.forceDeleted.push(branch.name);
                ui.success(`Force deleted branch "${branch.name}"`);
                ui.warn('Unmerged changes were lost');
              } else {
                results.failed.push({
                  name: branch.name,
                  reason: 'Has unmerged changes (skipped)',
                });
                ui.info(`Skipped branch "${branch.name}" (unmerged changes)`);
              }
            }
          } catch {
            results.failed.push({ name: branch.name, reason: 'Failed to force delete' });
            ui.error(`Failed to force delete branch "${branch.name}"`);
          }
        }
      } else {
        results.failed.push({ name: branch.name, reason: errorMessage });
        ui.error(`Failed to delete branch "${branch.name}": ${errorMessage}`);
      }
    }
  }

  // Display summary
  displayDeletionSummary(results);

  return success(undefined);
}

/**
 * Check if a branch has been squash-merged into main/master
 * This works by comparing the patch content of the branch with recent commits on main
 */
async function checkIfSquashMerged(branchName: string): Promise<boolean> {
  try {
    // Get the default branch name (main or master)
    const defaultBranch = await findDefaultBranch();

    // Get the merge base between the branch and default branch
    const { stdout: mergeBase } = await execa('git', ['merge-base', branchName, defaultBranch]);

    // Get the patch content of all commits on the branch since merge base
    const { stdout: branchPatch } = await execa('git', [
      'diff',
      `${mergeBase.trim()}..${branchName}`,
    ]);

    if (!branchPatch.trim()) {
      // No changes on the branch, it's effectively merged
      return true;
    }

    // Check recent commits on main (last 50) to see if any have similar content
    const { stdout: recentCommits } = await execa('git', [
      'rev-list',
      '--max-count=50',
      defaultBranch,
    ]);

    const commitShas = recentCommits.trim().split('\n');

    // Check each recent commit to see if it contains the branch content
    for (const commitSha of commitShas) {
      try {
        // Get the patch of this commit
        const { stdout: commitPatch } = await execa('git', ['show', '--format=', commitSha]);

        // Simple heuristic: if the commit patch contains significant overlap with branch patch
        // we consider it squash merged. This checks for similar additions/deletions patterns.
        if (patchesHaveSimilarContent(branchPatch, commitPatch)) {
          return true;
        }
      } catch {
        // Skip commits that can't be analyzed
        continue;
      }
    }

    return false;
  } catch (error) {
    logger.debug(`Failed to check squash merge status for ${branchName}: ${error}`);
    // If we can't determine, err on the side of caution
    return false;
  }
}

/**
 * Simple heuristic to check if two patches have similar content
 * This is not perfect but works well for most squash merge scenarios
 */
function patchesHaveSimilarContent(patch1: string, patch2: string): boolean {
  if (!patch1.trim() || !patch2.trim()) {
    return false;
  }

  // Extract added and removed lines (excluding context)
  const getSignificantLines = (patch: string) => {
    return patch
      .split('\n')
      .filter((line) => line.startsWith('+') || line.startsWith('-'))
      .filter((line) => !line.startsWith('+++') && !line.startsWith('---')) // Exclude file headers
      .map((line) => line.substring(1).trim()) // Remove +/- and trim
      .filter((line) => line.length > 0) // Remove empty lines
      .filter((line) => !line.match(/^\s*(\{|\}|\(|\)|;|,)\s*$/)); // Remove simple structural lines
  };

  const lines1 = getSignificantLines(patch1);
  const lines2 = getSignificantLines(patch2);

  if (lines1.length === 0 || lines2.length === 0) {
    return false;
  }

  // Calculate similarity ratio
  const commonLines = lines1.filter((line) => lines2.includes(line));
  const similarity = commonLines.length / Math.max(lines1.length, lines2.length);

  // If more than 70% of the content is similar, consider it squash merged
  return similarity > 0.7;
}

/**
 * Find the default branch (main, master, or other)
 * @returns The name of the default branch
 */
async function findDefaultBranch(): Promise<string> {
  try {
    // Try main first
    await execa('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main']);
    return 'main';
  } catch {
    try {
      // Try master
      await execa('git', ['show-ref', '--verify', '--quiet', 'refs/heads/master']);
      return 'master';
    } catch {
      // Get the default branch from remote
      try {
        const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
        return stdout.replace('refs/remotes/origin/', '').trim();
      } catch {
        // Fallback to main
        ui.warn('Could not determine default branch, using "main"');
        return 'main';
      }
    }
  }
}

/**
 * Display summary of branch deletion results
 */
function displayDeletionSummary(results: {
  deleted: string[];
  failed: { name: string; reason: string }[];
  forceDeleted: string[];
}): void {
  console.log('');
  ui.section('Cleanup Summary');

  const totalProcessed =
    results.deleted.length + results.failed.length + results.forceDeleted.length;
  const successCount = results.deleted.length + results.forceDeleted.length;

  ui.keyValue([
    ['Total processed', totalProcessed.toString()],
    ['Successfully deleted', successCount.toString()],
    ['Failed to delete', results.failed.length.toString()],
  ]);

  if (results.deleted.length > 0) {
    console.log('');
    ui.success(`Successfully deleted ${results.deleted.length} branch(es):`);
    ui.list(results.deleted);
  }

  if (results.forceDeleted.length > 0) {
    console.log('');
    ui.warn(`Force deleted ${results.forceDeleted.length} branch(es) with unmerged changes:`);
    ui.list(results.forceDeleted);
  }

  if (results.failed.length > 0) {
    console.log('');
    ui.error(`Failed to delete ${results.failed.length} branch(es):`);
    const failedList = results.failed.map((f) => `${f.name}: ${f.reason}`);
    ui.list(failedList);
  }

  if (successCount > 0) {
    console.log('');
    ui.success('Branch cleanup completed!');
  }
}

/**
 * Create the git branch command
 */
export function createBranchCommand(): Command {
  const command = new Command('branch');

  command
    .description('Analyze and manage local git branches')
    .option('--dry-run', 'show what would be deleted without actually deleting')
    .option('--force', 'force delete branches without confirmation prompts')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: GitBranchOptions;
      try {
        validatedOptions = validate(gitBranchOptionsSchema, options, 'git branch options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      const result = await executeBranch(validatedOptions);

      if (isFailure(result)) {
        ui.error(result.error.message);
        if (result.error.suggestions && result.error.suggestions.length > 0) {
          ui.warn('Suggestions:');
          ui.list(result.error.suggestions);
        }
        if (result.error.context?.['error']) {
          ui.muted(String(result.error.context['error']));
        }
        process.exit(1);
      }
    });

  return command;
}
