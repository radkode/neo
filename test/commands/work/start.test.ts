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

const dbAddContext = vi.fn();
const dbClose = vi.fn();
vi.mock('@/storage/db.js', () => ({
  ContextDB: {
    create: vi.fn(async () => ({ addContext: dbAddContext, close: dbClose })),
  },
}));

vi.mock('@/utils/agent.js', () => ({
  isAgentInitialized: vi.fn(),
  getAgentDbPath: vi.fn(),
  getProjectRoot: vi.fn(),
}));

import { executeWorkStart } from '@/commands/work/start/index.js';
import { isAgentInitialized, getAgentDbPath, getProjectRoot } from '@/utils/agent.js';

const execaMock = vi.mocked(execa);
const isAgentInitializedMock = vi.mocked(isAgentInitialized);
const getAgentDbPathMock = vi.mocked(getAgentDbPath);
const getProjectRootMock = vi.mocked(getProjectRoot);

/**
 * Build the canonical execa response sequence for the "happy path" of a
 * non-worktree, non-existing-branch start.
 *
 * Order (when `readsUserName` is true — the auto-prefix path):
 *   1. rev-parse --is-inside-work-tree
 *   2. branch --show-current
 *   3. config --get user.name
 *   4. show-ref refs/heads/<resolved> (rejected = does not exist)
 *   5. symbolic-ref refs/remotes/origin/HEAD
 *   6. fetch origin main
 *   7. checkout -b <branch> origin/main
 *
 * When `readsUserName` is false (--no-prefix, explicit --prefix, or a name that
 * already contains a slash), step 3 is skipped — `resolveBranchName`
 * short-circuits before ever consulting git config.
 */
function mockHappyPath(opts: {
  previousBranch: string;
  userName?: string | null;
  readsUserName?: boolean;
}) {
  const readsUserName = opts.readsUserName ?? true;
  execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
  execaMock.mockResolvedValueOnce({ stdout: opts.previousBranch } as never); // branch --show-current
  if (readsUserName) {
    if (opts.userName === null) {
      execaMock.mockRejectedValueOnce(new Error('no user.name'));
    } else {
      execaMock.mockResolvedValueOnce({ stdout: opts.userName ?? 'Jacek Radko' } as never);
    }
  }
  execaMock.mockRejectedValueOnce(new Error('no such ref')); // branchExistsLocally
  execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
  execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
  execaMock.mockResolvedValueOnce({ stdout: '' } as never); // checkout -b
}

describe('executeWorkStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAgentInitializedMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('derives prefix from git user.name and creates the branch off origin/<default>', async () => {
    mockHappyPath({ previousBranch: 'main', userName: 'Jacek Radko' });

    const result = await executeWorkStart('fix-foo', {});

    expect(result.branch).toBe('jacek/fix-foo');
    expect(result.base).toBe('origin/main');
    expect(result.previousBranch).toBe('main');
    expect(result.contextRecorded).toBe(false);

    const checkoutCall = execaMock.mock.calls.find(
      ([_cmd, args]) => Array.isArray(args) && args[0] === 'checkout' && args[1] === '-b'
    );
    expect(checkoutCall?.[1]).toEqual(['checkout', '-b', 'jacek/fix-foo', 'origin/main']);
  });

  it('respects --no-prefix (encoded as prefix: false)', async () => {
    mockHappyPath({ previousBranch: 'main', readsUserName: false });

    const result = await executeWorkStart('release-2026-05-01', { prefix: false });

    expect(result.branch).toBe('release-2026-05-01');
  });

  it('uses an explicit --prefix value over the derived one', async () => {
    mockHappyPath({ previousBranch: 'main', readsUserName: false });

    const result = await executeWorkStart('CLRK-123', { prefix: 'team' });

    expect(result.branch).toBe('team/CLRK-123');
  });

  it('passes through a name that already contains a slash without re-prefixing', async () => {
    mockHappyPath({ previousBranch: 'main', readsUserName: false });

    const result = await executeWorkStart('hotfix/login', {});

    expect(result.branch).toBe('hotfix/login');
  });

  it('throws when not in a git repository', async () => {
    const err = new Error('fatal: not a git repository') as Error & { stderr?: string };
    err.stderr = 'fatal: not a git repository';
    execaMock.mockRejectedValueOnce(err);

    await expect(executeWorkStart('fix-foo', {})).rejects.toThrow(/git repository/i);
  });

  it('throws when the resolved branch already exists locally', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'Jacek Radko' } as never); // user.name
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // show-ref → exists

    await expect(executeWorkStart('fix-foo', {})).rejects.toThrow(/already exists locally/);
  });

  it('throws when no prefix can be derived and none is provided', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // branch --show-current
    execaMock.mockRejectedValueOnce(new Error('no user.name')); // user.name read fails

    await expect(executeWorkStart('fix-foo', {})).rejects.toThrow(/--prefix|--no-prefix/);
  });

  it('creates a worktree at .worktrees/<lastSegment> when --worktree is set', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'Jacek Radko' } as never); // user.name
    execaMock.mockRejectedValueOnce(new Error('no such ref')); // branchExistsLocally
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // worktree add
    getProjectRootMock.mockResolvedValue('/repo');

    const result = await executeWorkStart('fix-foo', { worktree: true });

    expect(result.worktreePath).toBe('/repo/.worktrees/fix-foo');
    const worktreeAddCall = execaMock.mock.calls.find(
      ([_cmd, args]) => Array.isArray(args) && args[0] === 'worktree' && args[1] === 'add'
    );
    expect(worktreeAddCall?.[1]).toEqual([
      'worktree',
      'add',
      '-b',
      'jacek/fix-foo',
      '/repo/.worktrees/fix-foo',
      'origin/main',
    ]);
  });

  it('records the work item in the agent context store when initialized', async () => {
    mockHappyPath({ previousBranch: 'main' });
    isAgentInitializedMock.mockResolvedValue(true);
    getAgentDbPathMock.mockResolvedValue('/repo/.neo/agent/contexts.json');

    const result = await executeWorkStart('fix-foo', {});

    expect(result.contextRecorded).toBe(true);
    expect(dbAddContext).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 'medium',
        tags: expect.arrayContaining(['work-item', 'active', 'branch:jacek/fix-foo']),
      })
    );
    const payload = dbAddContext.mock.calls[0]?.[0] as { content: string };
    expect(JSON.parse(payload.content)).toMatchObject({
      kind: 'work-item',
      branch: 'jacek/fix-foo',
      base: 'origin/main',
    });
    expect(dbClose).toHaveBeenCalled();
  });

  it('returns contextRecorded=false (silently) when the agent store throws', async () => {
    mockHappyPath({ previousBranch: 'main' });
    isAgentInitializedMock.mockResolvedValue(true);
    getAgentDbPathMock.mockResolvedValue('/repo/.neo/agent/contexts.json');
    dbAddContext.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const result = await executeWorkStart('fix-foo', {});

    expect(result.contextRecorded).toBe(false);
    expect(dbClose).toHaveBeenCalled();
  });
});
