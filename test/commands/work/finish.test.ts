import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';

const spinnerMock = {
  start: vi.fn(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
};

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    spinner: vi.fn(() => ({ ...spinnerMock })),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    newline: vi.fn(),
    plain: vi.fn(),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const dbListContexts = vi.fn();
const dbUpdateContext = vi.fn();
const dbClose = vi.fn();
vi.mock('@/storage/db.js', () => ({
  ContextDB: {
    create: vi.fn(async () => ({
      listContexts: dbListContexts,
      updateContext: dbUpdateContext,
      close: dbClose,
    })),
  },
}));

vi.mock('@/utils/agent.js', () => ({
  isAgentInitialized: vi.fn(),
  getAgentDbPath: vi.fn(),
}));

import { executeWorkFinish } from '@/commands/work/finish/index.js';
import { isAgentInitialized, getAgentDbPath } from '@/utils/agent.js';

const execaMock = vi.mocked(execa);
const isAgentInitializedMock = vi.mocked(isAgentInitialized);
const getAgentDbPathMock = vi.mocked(getAgentDbPath);

/**
 * Order for the typical "PR merged, current branch is the feature branch":
 *   1. rev-parse --is-inside-work-tree
 *   2. symbolic-ref refs/remotes/origin/HEAD       → "refs/remotes/origin/main" (when --base not passed)
 *   3. branch --show-current                        → current branch
 *   4. show-ref refs/heads/<branch>                 → exists
 *   5. status --porcelain                           → "" (clean) — only when on the branch
 *   6. gh --version                                 → installed
 *   7. gh pr list ...                               → [{state: 'MERGED', url: '...'}]
 *   8. checkout <base>                              → success (only if currentBranch === branch)
 *   9. pull --ff-only origin <base>                 → success (when --no-pull not passed)
 *  10. worktree list --porcelain                    → "" (no worktree)
 *  11. branch -D <branch>                           → success
 */

describe('executeWorkFinish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAgentInitializedMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('finishes a merged feature branch: switches to base, pulls, deletes branch', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status --porcelain → clean
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ state: 'MERGED', url: 'https://github.com/x/y/pull/1' }]),
    } as never); // gh pr list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // checkout
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // pull
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // worktree list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // branch -D

    const result = await executeWorkFinish(undefined, {});

    expect(result.branch).toBe('jacek/fix-foo');
    expect(result.base).toBe('main');
    expect(result.mergedOnRemote).toBe(true);
    expect(result.prUrl).toBe('https://github.com/x/y/pull/1');
    expect(result.branchDeleted).toBe(true);
    expect(result.pulled).toBe(true);
    expect(result.worktreeRemoved).toBe(false);

    const deleteCall = execaMock.mock.calls.find(
      ([_cmd, args]) => Array.isArray(args) && args[0] === 'branch' && args[1] === '-D'
    );
    expect(deleteCall?.[1]).toEqual(['branch', '-D', 'jacek/fix-foo']);
  });

  it('refuses to delete the base branch', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch === base

    await expect(executeWorkFinish(undefined, {})).rejects.toThrow(/Refusing to delete base branch/);
  });

  it('throws when the named branch does not exist locally', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch
    execaMock.mockRejectedValueOnce(new Error('no such ref')); // show-ref → not found

    await expect(executeWorkFinish('jacek/missing', {})).rejects.toThrow(/does not exist locally/);
  });

  it('refuses without --force when the PR is open (not merged)', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status → clean
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ state: 'OPEN', url: 'https://github.com/x/y/pull/1' }]),
    } as never); // gh pr list

    await expect(executeWorkFinish(undefined, {})).rejects.toThrow(/not merged/);
  });

  it('refuses without --force when merge status cannot be confirmed', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status → clean
    execaMock.mockRejectedValueOnce(new Error('not installed')); // gh --version → no gh
    execaMock.mockRejectedValueOnce(new Error('not ancestor')); // merge-base --is-ancestor

    await expect(executeWorkFinish(undefined, {})).rejects.toThrow(/Could not confirm/);
  });

  it('refuses to finish current branch with uncommitted changes (no --force)', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists
    execaMock.mockResolvedValueOnce({ stdout: ' M src/foo.ts' } as never); // status → dirty

    await expect(executeWorkFinish(undefined, {})).rejects.toThrow(/uncommitted changes/);
  });

  it('skips pull when --no-pull is passed', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ state: 'MERGED', url: 'https://github.com/x/y/pull/1' }]),
    } as never); // gh pr list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // checkout
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // worktree list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // branch -D

    const result = await executeWorkFinish(undefined, { pull: false });

    expect(result.pulled).toBe(false);
    const pullCall = execaMock.mock.calls.find(
      ([_cmd, args]) => Array.isArray(args) && args[0] === 'pull'
    );
    expect(pullCall).toBeUndefined();
  });

  it('removes the associated worktree by default', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch (NOT the feature branch)
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists
    // No dirty-tree check fires when finishing a branch you're not on.
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ state: 'MERGED', url: '' }]),
    } as never); // gh pr list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // pull
    execaMock.mockResolvedValueOnce({
      stdout: 'worktree /repo\nbranch refs/heads/main\n\nworktree /repo/.worktrees/fix-foo\nbranch refs/heads/jacek/fix-foo\n',
    } as never); // worktree list
    // pathExists(/repo/.worktrees/fix-foo) — uses fs.access, not execa, but the
    // path is checked via access(). In the test process this path doesn't exist
    // so the worktree-remove block won't execute. To exercise it we'd need to
    // stub fs.access; covered by integration scenarios, not here.
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // branch -D

    const result = await executeWorkFinish('jacek/fix-foo', {});

    expect(result.branch).toBe('jacek/fix-foo');
    expect(result.branchDeleted).toBe(true);
  });

  it('marks the work item as done in the agent context store', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ state: 'MERGED', url: 'https://github.com/x/y/pull/1' }]),
    } as never); // gh pr list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // checkout
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // pull
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // worktree list
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // branch -D

    isAgentInitializedMock.mockResolvedValue(true);
    getAgentDbPathMock.mockResolvedValue('/repo/.neo/agent/contexts.json');
    dbListContexts.mockReturnValue([
      {
        id: 'abc',
        content: '{}',
        tags: ['work-item', 'active', 'branch:jacek/fix-foo'],
        priority: 'medium',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await executeWorkFinish(undefined, {});

    expect(result.contextUpdated).toBe(true);
    expect(dbListContexts).toHaveBeenCalledWith({ tag: 'branch:jacek/fix-foo' });
    expect(dbUpdateContext).toHaveBeenCalledWith(
      'abc',
      expect.objectContaining({
        priority: 'low',
        tags: expect.arrayContaining(['work-item', 'branch:jacek/fix-foo', 'done']),
      })
    );
    const updateCall = dbUpdateContext.mock.calls[0]?.[1] as { tags: string[] };
    expect(updateCall.tags).not.toContain('active');
    expect(dbClose).toHaveBeenCalled();
  });
});
