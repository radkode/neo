import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import { GitErrors, isNotGitRepository } from '@/utils/git-errors.js';

/**
 * Parsed stash entry information
 */
export interface StashEntry {
  index: number;
  ref: string;
  branch: string;
  message: string;
  timestamp: Date;
  filesChanged: number;
}

/**
 * Uncommitted file change
 */
interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

/**
 * Current working state
 */
interface WorkingState {
  changes: FileChange[];
  stashes: StashEntry[];
  hasChanges: boolean;
  hasStashes: boolean;
}

/**
 * Format relative time from date
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Build stash reference from index
 */
export function buildStashRef(index: number): string {
  return `stash@{${index}}`;
}

/**
 * Parse stash list output
 */
export function parseStashList(output: string): StashEntry[] {
  if (!output.trim()) return [];

  const entries: StashEntry[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const match = line.match(/^(stash@\{(\d+)\}):\s+(?:WIP on |On )?([^:]+):\s*(.*)$/);
    if (match) {
      const ref = match[1] ?? '';
      const indexStr = match[2] ?? '0';
      const branch = match[3] ?? '';
      const message = match[4]?.trim() || 'WIP';

      entries.push({
        index: parseInt(indexStr, 10),
        ref,
        branch: branch.trim(),
        message,
        timestamp: new Date(),
        filesChanged: 0,
      });
    }
  }

  return entries;
}

/**
 * Get stash timestamp
 */
async function getStashTimestamp(stashRef: string): Promise<Date> {
  try {
    const { stdout } = await execa('git', ['log', '-1', '--format=%ci', stashRef]);
    return new Date(stdout.trim());
  } catch {
    return new Date();
  }
}

/**
 * Get number of files in a stash
 */
async function getStashFileCount(stashRef: string): Promise<number> {
  try {
    const { stdout } = await execa('git', ['stash', 'show', '--name-only', stashRef]);
    return stdout.trim() ? stdout.trim().split('\n').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get uncommitted changes
 */
async function getUncommittedChanges(): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  try {
    // Get staged and unstaged changes
    const { stdout: status } = await execa('git', ['status', '--porcelain']);

    if (status.trim()) {
      for (const line of status.trim().split('\n')) {
        const indexStatus = line[0];
        const workStatus = line[1];
        const path = line.substring(3).trim();

        if (!path) continue;

        // Determine status
        let fileStatus: FileChange['status'] = 'modified';
        if (indexStatus === '?' || workStatus === '?') {
          fileStatus = 'untracked';
        } else if (indexStatus === 'A' || workStatus === 'A') {
          fileStatus = 'added';
        } else if (indexStatus === 'D' || workStatus === 'D') {
          fileStatus = 'deleted';
        } else if (indexStatus === 'R' || workStatus === 'R') {
          fileStatus = 'renamed';
        }

        const staged = indexStatus !== ' ' && indexStatus !== '?';

        changes.push({ path, status: fileStatus, staged });
      }
    }
  } catch {
    // Ignore errors
  }

  return changes;
}

/**
 * Get list of stashes with metadata
 */
async function getStashes(): Promise<StashEntry[]> {
  try {
    const { stdout } = await execa('git', ['stash', 'list']);
    const stashes = parseStashList(stdout);

    // Enrich with timestamps and file counts
    await Promise.all(
      stashes.map(async (stash) => {
        stash.timestamp = await getStashTimestamp(stash.ref);
        stash.filesChanged = await getStashFileCount(stash.ref);
      })
    );

    return stashes;
  } catch {
    return [];
  }
}

/**
 * Get current working state
 */
async function getWorkingState(): Promise<WorkingState> {
  const [changes, stashes] = await Promise.all([getUncommittedChanges(), getStashes()]);

  return {
    changes,
    stashes,
    hasChanges: changes.length > 0,
    hasStashes: stashes.length > 0,
  };
}

/**
 * Display uncommitted changes in a nice box
 */
function displayChanges(changes: FileChange[]): void {
  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged && c.status !== 'untracked');
  const untracked = changes.filter((c) => c.status === 'untracked');

  const statusIcons: Record<FileChange['status'], string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    untracked: '?',
  };

  ui.section(`Uncommitted Changes (${changes.length} files)`);

  if (staged.length > 0) {
    ui.success('Staged:');
    for (const file of staged.slice(0, 5)) {
      ui.log(`  ${statusIcons[file.status]}  ${file.path}`);
    }
    if (staged.length > 5) ui.muted(`  ... and ${staged.length - 5} more`);
  }

  if (unstaged.length > 0) {
    ui.warn('Modified:');
    for (const file of unstaged.slice(0, 5)) {
      ui.log(`  ${statusIcons[file.status]}  ${file.path}`);
    }
    if (unstaged.length > 5) ui.muted(`  ... and ${unstaged.length - 5} more`);
  }

  if (untracked.length > 0) {
    ui.muted('Untracked:');
    for (const file of untracked.slice(0, 3)) {
      ui.log(`  ${statusIcons[file.status]}  ${file.path}`);
    }
    if (untracked.length > 3) ui.muted(`  ... and ${untracked.length - 3} more`);
  }
}

/**
 * Display stashes in a nice table
 */
function displayStashes(stashes: StashEntry[]): void {
  ui.section(`Your Stashes (${stashes.length})`);

  const rows = stashes.map((s) => [
    String(s.index),
    s.message.length > 30 ? s.message.substring(0, 27) + '...' : s.message,
    s.branch,
    formatRelativeTime(s.timestamp),
    `${s.filesChanged} files`,
  ]);

  ui.table({
    headers: ['#', 'Message', 'Branch', 'Age', 'Files'],
    rows,
  });
}

/**
 * Get stash diff for preview
 */
async function getStashDiff(stashRef: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['stash', 'show', '-p', '--color=always', stashRef]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Get stash file stats
 */
async function getStashStats(stashRef: string): Promise<{ files: string[]; additions: number; deletions: number }> {
  try {
    const { stdout: nameOutput } = await execa('git', ['stash', 'show', '--name-only', stashRef]);
    const files = nameOutput.trim() ? nameOutput.trim().split('\n') : [];

    const { stdout: statOutput } = await execa('git', ['stash', 'show', '--numstat', stashRef]);
    let additions = 0;
    let deletions = 0;

    if (statOutput.trim()) {
      for (const line of statOutput.trim().split('\n')) {
        const match = line.match(/^(\d+|-)\s+(\d+|-)/);
        if (match && match[1] && match[2]) {
          additions += match[1] === '-' ? 0 : parseInt(match[1], 10);
          deletions += match[2] === '-' ? 0 : parseInt(match[2], 10);
        }
      }
    }

    return { files, additions, deletions };
  } catch {
    return { files: [], additions: 0, deletions: 0 };
  }
}

/**
 * Handle creating a new stash
 */
async function handleCreateStash(changes: FileChange[]): Promise<Result<void>> {
  const hasUntracked = changes.some((c) => c.status === 'untracked');

  // Ask what to stash
  const stashChoices = [
    { name: 'Stash all changes', value: 'all' },
    ...(hasUntracked ? [{ name: 'Stash all (include untracked)', value: 'untracked' }] : []),
    { name: 'Cancel', value: 'cancel' },
  ];

  const { stashType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'stashType',
      message: 'What would you like to stash?',
      choices: stashChoices,
    },
  ]);

  if (stashType === 'cancel') {
    return success(undefined);
  }

  // Get message
  const { message } = await inquirer.prompt([
    {
      type: 'input',
      name: 'message',
      message: 'Stash message (optional):',
      default: '',
    },
  ]);

  // Build command
  const args = ['stash', 'push'];
  if (message) args.push('-m', message);
  if (stashType === 'untracked') args.push('--include-untracked');

  const spinner = ui.spinner('Stashing changes...');
  spinner.start();

  try {
    await execa('git', args);
    spinner.succeed(`Stashed ${changes.length} files`);
    return success(undefined);
  } catch (error) {
    spinner.fail('Failed to stash');
    return failure(GitErrors.unknown('stash', error));
  }
}

/**
 * Handle stash action (apply, pop, show, drop)
 */
async function handleStashAction(stash: StashEntry): Promise<Result<'back' | 'done'>> {
  const stats = await getStashStats(stash.ref);

  ui.section(`Stash: ${stash.message}`);
  ui.keyValue([
    ['Branch', stash.branch],
    ['Created', formatRelativeTime(stash.timestamp)],
    ['Files', String(stats.files.length)],
    ['Changes', `+${stats.additions} / -${stats.deletions}`],
  ]);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Apply (keep stash)', value: 'apply' },
        { name: 'Pop (apply & remove)', value: 'pop' },
        { name: 'View diff', value: 'diff' },
        { name: 'Drop (delete)', value: 'drop' },
        new inquirer.Separator(),
        { name: '← Back', value: 'back' },
      ],
    },
  ]);

  if (action === 'back') {
    return success('back');
  }

  if (action === 'diff') {
    const diff = await getStashDiff(stash.ref);
    if (diff) {
      console.log('\n' + diff + '\n');
    } else {
      ui.warn('No diff available');
    }
    // After showing diff, return to action menu
    return handleStashAction(stash);
  }

  if (action === 'drop') {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure? This cannot be undone.',
        default: false,
      },
    ]);

    if (!confirm) {
      return handleStashAction(stash);
    }

    const spinner = ui.spinner('Dropping stash...');
    spinner.start();
    try {
      await execa('git', ['stash', 'drop', stash.ref]);
      spinner.succeed('Stash dropped');
      return success('done');
    } catch (error) {
      spinner.fail('Failed to drop stash');
      return failure(GitErrors.unknown('stash drop', error));
    }
  }

  // Apply or Pop
  const spinner = ui.spinner(action === 'apply' ? 'Applying stash...' : 'Popping stash...');
  spinner.start();

  try {
    await execa('git', ['stash', action, stash.ref]);
    spinner.succeed(action === 'apply' ? 'Stash applied (still saved)' : 'Stash popped');
    return success('done');
  } catch {
    spinner.fail('Conflicts detected');
    ui.warn('Resolve conflicts manually, then:');
    ui.list(['Stage resolved files: git add <files>', 'The stash is still available']);
    return failure(GitErrors.stashApplyConflict(`stash ${action}`));
  }
}

/**
 * Handle stash selection from list
 */
async function handleStashSelection(stashes: StashEntry[]): Promise<Result<void>> {
  const choices = [
    ...stashes.map((s) => ({
      name: `${s.message} (${s.branch}, ${formatRelativeTime(s.timestamp)})`,
      value: s.index,
      short: s.message,
    })),
    new inquirer.Separator(),
    { name: '✕ Cancel', value: -1 },
  ];

  const { selectedIndex } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedIndex',
      message: 'Select a stash:',
      choices,
      pageSize: 10,
    },
  ]);

  if (selectedIndex === -1) {
    return success(undefined);
  }

  const selectedStash = stashes.find((s) => s.index === selectedIndex);
  if (!selectedStash) {
    return success(undefined);
  }

  const result = await handleStashAction(selectedStash);
  if (isFailure(result)) {
    return result;
  }

  // If user went back, show selection again
  if (result.data === 'back') {
    return handleStashSelection(stashes);
  }

  return success(undefined);
}

/**
 * Main interactive stash flow
 */
async function interactiveStash(): Promise<Result<void>> {
  try {
    // Verify git repository
    await execa('git', ['rev-parse', '--git-dir']);
  } catch (error) {
    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('stash'));
    }
    return failure(GitErrors.unknown('stash', error));
  }

  const spinner = ui.spinner('Loading...');
  spinner.start();

  const state = await getWorkingState();

  spinner.stop();

  // No changes and no stashes
  if (!state.hasChanges && !state.hasStashes) {
    ui.info('No uncommitted changes and no stashes.');
    ui.muted('Make some changes, then run this command again.');
    return success(undefined);
  }

  // Display current state
  if (state.hasChanges) {
    displayChanges(state.changes);
  }

  if (state.hasStashes) {
    displayStashes(state.stashes);
  }

  // Build menu based on context
  type MenuChoice = 'stash' | 'select' | 'cancel';
  const menuChoices: Array<{ name: string; value: MenuChoice }> = [];

  if (state.hasChanges) {
    menuChoices.push({ name: 'Stash current changes', value: 'stash' });
  }

  if (state.hasStashes) {
    menuChoices.push({ name: 'Select a stash to apply/view/drop', value: 'select' });
  }

  menuChoices.push({ name: 'Cancel', value: 'cancel' });

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: menuChoices,
    },
  ]);

  if (action === 'cancel') {
    return success(undefined);
  }

  if (action === 'stash') {
    return handleCreateStash(state.changes);
  }

  if (action === 'select') {
    return handleStashSelection(state.stashes);
  }

  return success(undefined);
}

/**
 * Execute the unified stash command
 */
export async function executeStash(): Promise<Result<void>> {
  return interactiveStash();
}

/**
 * Create the unified git stash command
 */
export function createStashCommand(): Command {
  const command = new Command('stash');

  command
    .description('Interactively manage git stashes')
    .action(async () => {
      const result = await executeStash();

      if (isFailure(result)) {
        ui.error(result.error.message);
        if (result.error.suggestions && result.error.suggestions.length > 0) {
          ui.warn('Suggestions:');
          ui.list(result.error.suggestions);
        }
        process.exit(1);
      }
    });

  return command;
}
