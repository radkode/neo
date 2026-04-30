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

vi.mock('@/commands/verify/index.js', () => ({
  executeVerify: vi.fn(),
}));

vi.mock('@/commands/changeset/index.js', () => ({
  executeChangeset: vi.fn(),
}));

vi.mock('@/commands/ai/pr/index.js', () => ({
  executeAiPr: vi.fn(),
}));

vi.mock('@/services/ai/index.js', () => ({
  isAICommitAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: vi.fn().mockRejectedValue(new Error('not found')), // .changeset dir absent by default
    readdir: vi.fn().mockResolvedValue([]),
  };
});

import { executeWorkShip } from '@/commands/work/ship/index.js';
import { executeVerify } from '@/commands/verify/index.js';
import { executeChangeset } from '@/commands/changeset/index.js';
import { executeAiPr } from '@/commands/ai/pr/index.js';

const execaMock = vi.mocked(execa);
const verifyMock = vi.mocked(executeVerify);
const changesetMock = vi.mocked(executeChangeset);
const aiPrMock = vi.mocked(executeAiPr);

/**
 * Canonical execa-call order in executeWorkShip:
 *
 *   1. rev-parse --is-inside-work-tree      (in-repo guard)
 *   2. rev-parse --show-toplevel            (getProjectRoot → cwd)
 *   3. branch --show-current                (getCurrentBranch)
 *   4. symbolic-ref refs/remotes/origin/HEAD (detectDefaultBranch — only when --base unset)
 *   5. status --porcelain                   (hasUncommittedChanges)
 *   6. fetch origin <base>
 *   7. rev-list --count origin/<base>..HEAD (countCommitsAhead)
 *   — verify (mocked) —
 *   — changeset (mocked / disabled) —
 *   8. rev-parse --abbrev-ref @{upstream}   (hasUpstream)
 *   9. push ... origin <branch>
 *  10. gh --version                          (ghInstalled)
 *  11. gh pr view --json url                  (existingPrUrl)
 *  — if no PR + AI unavailable —
 *  12. log origin/<base>..HEAD --pretty=...  (getCommitSubjects)
 *  13. gh pr create ...                      (creates PR)
 */

describe('executeWorkShip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiPrMock.mockResolvedValue({
      prUrl: 'https://github.com/x/y/pull/1',
      created: true,
    } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('throws when not in a git repository', async () => {
    const err = new Error('fatal: not a git repository') as Error & { stderr?: string };
    err.stderr = 'fatal: not a git repository';
    execaMock.mockRejectedValueOnce(err);

    await expect(executeWorkShip({})).rejects.toThrow(/git repository/i);
  });

  it('throws when on the base branch', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'main' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref

    await expect(executeWorkShip({})).rejects.toThrow(/base branch/);
  });

  it('throws when HEAD is detached', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // current branch (detached)

    await expect(executeWorkShip({})).rejects.toThrow(/Detached HEAD/);
  });

  it('throws when there are uncommitted changes', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: ' M src/foo.ts' } as never); // status

    await expect(executeWorkShip({})).rejects.toThrow(/uncommitted changes/);
  });

  it('throws when there are zero commits ahead of base', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '0' } as never); // rev-list --count

    await expect(executeWorkShip({})).rejects.toThrow(/Nothing to ship/);
  });

  it('throws when verify fails (default behavior)', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '3' } as never); // rev-list --count

    verifyMock.mockResolvedValueOnce({ ok: false, totalDurationMs: 1234 } as never);

    await expect(executeWorkShip({})).rejects.toThrow(/Verify failed/);
  });

  it('skips verify when --no-verify is passed', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '3' } as never); // rev-list --count
    execaMock.mockRejectedValueOnce(new Error('no upstream')); // hasUpstream
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // push -u
    execaMock.mockRejectedValueOnce(new Error('no gh')); // gh --version → not installed

    changesetMock.mockResolvedValue({ path: '.changeset/foo.md' } as never);

    const result = await executeWorkShip({
      verify: false,
      changeset: false,
    });

    expect(verifyMock).not.toHaveBeenCalled();
    expect(result.verified).toBe(false);
    expect(result.pushed).toBe(true);
    expect(result.commits).toBe(3);
  });

  it('returns the existing PR url instead of creating a new one', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '3' } as never); // rev-list --count
    execaMock.mockResolvedValueOnce({ stdout: 'origin/jacek/fix-foo' } as never); // hasUpstream
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // push --force-with-lease
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockResolvedValueOnce({
      stdout: 'https://github.com/x/y/pull/42',
    } as never); // gh pr view --json url

    const result = await executeWorkShip({ verify: false, changeset: false });

    expect(result.prUrl).toBe('https://github.com/x/y/pull/42');
    expect(result.prCreated).toBe(false);
  });

  it('creates a PR with inferred title/body when AI is unavailable', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '2' } as never); // rev-list --count
    execaMock.mockRejectedValueOnce(new Error('no upstream')); // hasUpstream
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // push -u
    execaMock.mockResolvedValueOnce({ stdout: 'gh 2.42.0' } as never); // gh --version
    execaMock.mockRejectedValueOnce(new Error('no PR yet')); // gh pr view → none
    execaMock.mockResolvedValueOnce({
      stdout: 'feat: add foo\nfix: bar',
    } as never); // git log
    execaMock.mockResolvedValueOnce({
      stdout: 'https://github.com/x/y/pull/7',
    } as never); // gh pr create

    const result = await executeWorkShip({ verify: false, changeset: false });

    expect(result.prCreated).toBe(true);
    expect(result.prUrl).toBe('https://github.com/x/y/pull/7');

    const createCall = execaMock.mock.calls.find(
      ([cmd, args]) =>
        cmd === 'gh' && Array.isArray(args) && args[0] === 'pr' && args[1] === 'create'
    );
    expect(createCall).toBeTruthy();
    expect(createCall?.[1]).toContain('--title');
    expect(createCall?.[1]).toContain('feat: add foo');
  });

  it('warns and skips PR creation when gh is unavailable', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'true' } as never); // rev-parse --is-inside-work-tree
    execaMock.mockResolvedValueOnce({ stdout: '/repo' } as never); // rev-parse --show-toplevel
    execaMock.mockResolvedValueOnce({ stdout: 'jacek/fix-foo' } as never); // current branch
    execaMock.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main' } as never); // symbolic-ref
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // status
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // fetch
    execaMock.mockResolvedValueOnce({ stdout: '1' } as never); // rev-list --count
    execaMock.mockRejectedValueOnce(new Error('no upstream')); // hasUpstream
    execaMock.mockResolvedValueOnce({ stdout: '' } as never); // push -u
    execaMock.mockRejectedValueOnce(new Error('not installed')); // gh --version

    const result = await executeWorkShip({ verify: false, changeset: false });

    expect(result.prCreated).toBe(false);
    expect(result.prUrl).toBeUndefined();
    expect(result.pushed).toBe(true);
  });
});
