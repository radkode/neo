import { confirm } from '@inquirer/prompts';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execaResult } from '../../../utils/test-helpers.js';
import { createPrCommand } from '@/commands/gh/pr/index.js';
import {
  createPrMergeCommand,
  executeGhPrMerge,
  type GhPrMergeResult,
} from '@/commands/gh/pr/merge/index.js';
import { NonInteractiveError, promptSelect } from '@/utils/prompt.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { ghPrMergeOptionsSchema } from '@/types/schemas.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));

vi.mock('@/utils/prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/prompt.js')>();
  return { ...actual, promptSelect: vi.fn() };
});

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    newline: vi.fn(),
    plain: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

const headSha = 'e2dc721a4a41df00dc982487057710a6e8163df6';
const mergeSha = 'b13c7dd828a7c23df85659f076bcc12824192ef0';

const openPr = {
  autoMergeRequest: null as { mergeMethod: string } | null,
  baseRefName: 'main',
  headRefName: 'jacek/feature',
  headRefOid: headSha,
  headRepository: { nameWithOwner: 'radkode/neo' },
  id: 'PR_kwDOExample88',
  isCrossRepository: false,
  isDraft: false,
  mergeCommit: null as { oid: string } | null,
  mergeStateStatus: 'CLEAN' as string,
  mergeable: 'MERGEABLE' as string,
  mergedAt: null as string | null,
  number: 88,
  reviewDecision: 'APPROVED' as string | null,
  state: 'OPEN' as string,
  url: 'https://github.com/radkode/neo/pull/88',
};

const mergedPr = {
  ...openPr,
  mergeCommit: { oid: mergeSha },
  mergeStateStatus: 'UNKNOWN',
  mergeable: 'UNKNOWN',
  mergedAt: '2026-08-31T04:00:00Z',
  state: 'MERGED',
};

interface Scenario {
  after?: typeof openPr | typeof mergedPr;
  before?: typeof openPr | typeof mergedPr;
  checks?: Array<{ bucket: string; link: string; name: string; state: string }>;
  checksExitCode?: number;
  checksStderr?: string;
  checksStdout?: string;
  cleanupPushExitCode?: number;
  cleanupPushStderr?: string;
  deleteBranchOnMerge?: boolean;
  mergeExitCode?: number;
  mergeStderr?: string;
  queueExitCode?: number;
  queueResults?: Array<{ exitCode?: number; stderr?: string; stdout?: string }>;
  queueStderr?: string;
  queueStates?: Array<{ isInMergeQueue: boolean; isMergeQueueEnabled: boolean } | null>;
  queueStdout?: string;
  relatedBasePrs?: Array<{
    headRepository?: { nameWithOwner: string } | null;
    number: number;
    url: string;
  }>;
  relatedHeadPrs?: Array<{
    headRepository?: { nameWithOwner: string } | null;
    number: number;
    url: string;
  }>;
  remoteHeads?: Array<string | null>;
  remoteList?: string;
  repositorySshUrl?: string;
  viewErrorAt?: number;
  views?: Array<typeof openPr | typeof mergedPr>;
}

function useScenario({
  after = mergedPr,
  before = openPr,
  checks = [{ bucket: 'pass', link: 'https://checks.test/1', name: 'test', state: 'SUCCESS' }],
  checksExitCode,
  checksStderr = '',
  checksStdout,
  cleanupPushExitCode = 0,
  cleanupPushStderr = '',
  deleteBranchOnMerge = false,
  mergeExitCode = 0,
  mergeStderr = '',
  queueExitCode = 0,
  queueResults,
  queueStderr = '',
  queueStates = [{ isInMergeQueue: false, isMergeQueueEnabled: false }],
  queueStdout,
  relatedBasePrs = [],
  relatedHeadPrs = [],
  remoteHeads = [headSha, null],
  remoteList = 'origin\tgit@github.com:radkode/neo.git (push)',
  repositorySshUrl = 'git@github.com:radkode/neo.git',
  viewErrorAt,
  views,
}: Scenario = {}): void {
  const execaMock = vi.mocked(execa);
  let viewCount = 0;
  let queueCount = 0;
  let remoteHeadCount = 0;

  execaMock.mockImplementation((async (command: string, args?: readonly string[]) => {
    const argv = [...(args ?? [])];

    if (command === 'gh' && argv[0] === '--version') {
      return execaResult({ stdout: 'gh version 2.96.0' });
    }
    if (command === 'gh' && argv[0] === 'auth' && argv[1] === 'status') {
      return execaResult({ stdout: 'Logged in' });
    }
    if (command === 'gh' && argv[0] === 'api' && argv[1] === 'graphql') {
      const queueResult = queueResults?.[Math.min(queueCount, queueResults.length - 1)];
      const state = queueStates[Math.min(queueCount, queueStates.length - 1)] ?? null;
      queueCount += 1;
      return execaResult({
        exitCode: queueResult?.exitCode ?? queueExitCode,
        stderr: queueResult?.stderr ?? queueStderr,
        stdout: queueResult?.stdout ?? queueStdout ?? JSON.stringify({ data: { node: state } }),
      });
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
      if (viewCount === viewErrorAt) throw new Error('postflight unavailable');
      const viewValues = views ?? [before, after];
      const value = viewValues[Math.min(viewCount, viewValues.length - 1)] ?? after;
      viewCount += 1;
      return execaResult({ stdout: JSON.stringify(value) });
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'checks') {
      return execaResult({
        exitCode:
          checksExitCode ??
          (checks.some(({ bucket }) => bucket !== 'pass' && bucket !== 'skipping') ? 8 : 0),
        stderr: checksStderr,
        stdout: checksStdout ?? JSON.stringify(checks),
      });
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'list') {
      const related = argv.includes('--head') ? relatedHeadPrs : relatedBasePrs;
      return execaResult({
        stdout: JSON.stringify(
          related.map((pr) => ({ headRepository: openPr.headRepository, ...pr }))
        ),
      });
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'merge') {
      return execaResult({ exitCode: mergeExitCode, stderr: mergeStderr });
    }
    if (command === 'gh' && argv[0] === 'repo' && argv[1] === 'view') {
      return execaResult({
        stdout: JSON.stringify({ deleteBranchOnMerge, sshUrl: repositorySshUrl }),
      });
    }
    if (command === 'git' && argv[0] === 'remote' && argv[1] === '-v') {
      return execaResult({ stdout: remoteList });
    }
    if (command === 'git' && argv[0] === 'ls-remote') {
      const oid = remoteHeads[remoteHeadCount] ?? null;
      remoteHeadCount += 1;
      return execaResult({
        stdout: oid ? `${oid}\trefs/heads/${openPr.headRefName}` : '',
      });
    }
    if (command === 'git' && argv[0] === 'push') {
      return execaResult({ exitCode: cleanupPushExitCode, stderr: cleanupPushStderr });
    }

    throw new Error(`Unexpected command: ${command} ${argv.join(' ')}`);
  }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);
}

function confirmedCleanupFailure(
  result: Awaited<ReturnType<typeof executeGhPrMerge>>
): GhPrMergeResult {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected cleanup failure');
  return result.error.context?.['result'] as GhPrMergeResult;
}

function gitPushCall(): [string, readonly string[], unknown] | undefined {
  return vi
    .mocked(execa)
    .mock.calls.find(
      ([command, args]) => command === 'git' && Array.isArray(args) && args[0] === 'push'
    ) as [string, readonly string[], unknown] | undefined;
}

function mergeCall(): [string, readonly string[], unknown] | undefined {
  return vi
    .mocked(execa)
    .mock.calls.find(
      ([command, args]) =>
        command === 'gh' && Array.isArray(args) && args[0] === 'pr' && args[1] === 'merge'
    ) as [string, readonly string[], unknown] | undefined;
}

describe('gh pr merge command', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true, yes: true }));
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  it('registers merge under gh pr with the guarded public options', () => {
    const command = createPrMergeCommand();
    const prCommand = createPrCommand();

    expect(command.name()).toBe('merge');
    expect(command.registeredArguments[0]?.name()).toBe('pull-request');
    expect(command.options.map(({ flags }) => flags)).toEqual([
      '--strategy <method>',
      '--auto',
      '-d, --delete-remote-branch',
    ]);
    expect(prCommand.commands.map((child) => child.name())).toEqual(['create', 'merge']);
  });

  it('validates the merge strategy', () => {
    expect(ghPrMergeOptionsSchema.parse({ strategy: 'squash' }).strategy).toBe('squash');
    expect(ghPrMergeOptionsSchema.safeParse({ strategy: 'octopus' }).success).toBe(false);
  });

  it('merges a ready PR with the inspected head SHA pinned', async () => {
    useScenario();

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data).toMatchObject({
      action: 'merged',
      readiness: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' },
    });
    expect(mergeCall()?.[1]).toEqual([
      'pr',
      'merge',
      '88',
      '--repo',
      'github.com/radkode/neo',
      '--squash',
      '--match-head-commit',
      headSha,
    ]);
    expect(mergeCall()?.[2]).toEqual({ reject: false, stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('keeps checks, merge, and postflight inspection scoped to the resolved GHES repository', async () => {
    const url = 'https://github.example.test/radkode/neo/pull/88';
    useScenario({ before: { ...openPr, url }, after: { ...mergedPr, url } });

    const result = await executeGhPrMerge(url, { strategy: 'squash' });

    expect(result.success).toBe(true);
    const scopedCalls = vi
      .mocked(execa)
      .mock.calls.filter(
        ([command, args]) =>
          command === 'gh' &&
          Array.isArray(args) &&
          (args[1] === 'checks' || args[1] === 'merge' || (args[1] === 'view' && args[2] === '88'))
      );
    expect(scopedCalls).toHaveLength(3);
    for (const [, args] of scopedCalls) {
      expect(args).toEqual(expect.arrayContaining(['--repo', 'github.example.test/radkode/neo']));
    }
  });

  it('retries transient unknown mergeability before deciding readiness', async () => {
    useScenario({
      views: [{ ...openPr, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, openPr, mergedPr],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.readiness).toMatchObject({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    });
  });

  it('allows GitHub to report that no required checks are configured', async () => {
    useScenario({
      checks: [],
      checksExitCode: 1,
      checksStderr: "no checks reported on the 'jacek/feature' branch",
      checksStdout: '',
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.readiness.requiredChecks).toEqual({
      failed: [],
      passed: [],
      pending: [],
    });
  });

  it('fails closed when required checks cannot be inspected', async () => {
    useScenario({
      checks: [],
      checksExitCode: 1,
      checksStderr: 'authentication failed',
      checksStdout: '',
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('Not authenticated');
    expect(mergeCall()).toBeUndefined();
  });

  it.each([
    {
      label: 'a failed query',
      scenario: { queueExitCode: 1, queueStderr: 'merge queue query failed' },
      message: 'merge queue query failed',
    },
    {
      label: 'a malformed response',
      scenario: { queueStdout: JSON.stringify({ data: { node: null } }) },
      message: 'Could not parse the merge queue state',
    },
  ])('fails closed when merge queue inspection returns $label', async ({ scenario, message }) => {
    useScenario(scenario);

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain(message);
    expect(mergeCall()).toBeUndefined();
  });

  it('submits queue-backed PRs without inventing a merge strategy', async () => {
    useScenario({
      after: openPr,
      queueStates: [
        { isInMergeQueue: false, isMergeQueueEnabled: true },
        { isInMergeQueue: true, isMergeQueueEnabled: true },
      ],
    });

    const result = await executeGhPrMerge('88', {});

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data).toMatchObject({ action: 'queued' });
    expect((result as { data: GhPrMergeResult }).data.strategy).toBeUndefined();
    expect(promptSelect).not.toHaveBeenCalled();
    expect(mergeCall()?.[1]).toEqual([
      'pr',
      'merge',
      '88',
      '--repo',
      'github.com/radkode/neo',
      '--match-head-commit',
      headSha,
    ]);
  });

  it('treats an existing merge queue entry as idempotent', async () => {
    useScenario({ queueStates: [{ isInMergeQueue: true, isMergeQueueEnabled: true }] });

    const result = await executeGhPrMerge('88', {});

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.action).toBe('queued');
    expect(mergeCall()).toBeUndefined();
    expect(promptSelect).not.toHaveBeenCalled();
  });

  it('rejects an explicit strategy when the merge queue controls it', async () => {
    useScenario({
      queueStates: [{ isInMergeQueue: false, isMergeQueueEnabled: true }],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('retry without --strategy');
    expect(mergeCall()).toBeUndefined();
  });

  it('refuses requested cleanup before merging a stacked branch', async () => {
    useScenario({
      relatedBasePrs: [{ number: 89, url: 'https://github.com/radkode/neo/pull/89' }],
    });

    const result = await executeGhPrMerge('88', {
      deleteRemoteBranch: true,
      strategy: 'squash',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('used by open PR #89');
    expect(mergeCall()).toBeUndefined();
  });

  it('refuses a stacked merge when the repository automatically deletes branches', async () => {
    useScenario({
      deleteBranchOnMerge: true,
      relatedBasePrs: [{ number: 89, url: 'https://github.com/radkode/neo/pull/89' }],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('deletes merged branches');
    expect(mergeCall()).toBeUndefined();
  });

  it('also protects another open PR that shares the head branch', async () => {
    useScenario({
      deleteBranchOnMerge: true,
      relatedHeadPrs: [
        { number: 88, url: openPr.url },
        { number: 90, url: 'https://github.com/radkode/neo/pull/90' },
      ],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('open PR #90');
    expect(mergeCall()).toBeUndefined();
  });

  it('ignores a same-named head branch from a fork when checking dependencies', async () => {
    useScenario({
      deleteBranchOnMerge: true,
      relatedHeadPrs: [
        { number: 88, url: openPr.url },
        {
          headRepository: { nameWithOwner: 'someone/neo' },
          number: 90,
          url: 'https://github.com/radkode/neo/pull/90',
        },
      ],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    expect(mergeCall()).toBeDefined();
  });

  it('keeps an existing matching auto-merge request idempotent', async () => {
    useScenario({
      before: { ...openPr, autoMergeRequest: { mergeMethod: 'SQUASH' } },
      deleteBranchOnMerge: true,
      relatedBasePrs: [{ number: 89, url: 'https://github.com/radkode/neo/pull/89' }],
    });

    const result = await executeGhPrMerge('88', { auto: true, strategy: 'squash' });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.action).toBe('auto_merge_enabled');
    expect(mergeCall()).toBeUndefined();
  });

  it('refuses unmet requirements unless auto-merge is explicit', async () => {
    useScenario({
      before: {
        ...openPr,
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
      },
      checks: [{ bucket: 'pending', link: '', name: 'test', state: 'IN_PROGRESS' }],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not ready');
      expect(result.error.suggestions).toContain('Use --auto to wait for merge requirements.');
    }
    expect(mergeCall()).toBeUndefined();
  });

  it('arms auto-merge when requirements are still pending', async () => {
    useScenario({
      before: {
        ...openPr,
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
      },
      after: {
        ...openPr,
        autoMergeRequest: { mergeMethod: 'SQUASH' },
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
      },
      checks: [{ bucket: 'pending', link: '', name: 'test', state: 'IN_PROGRESS' }],
    });

    const result = await executeGhPrMerge('88', {
      auto: true,
      deleteRemoteBranch: true,
      strategy: 'squash',
    });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data).toMatchObject({
      action: 'auto_merge_enabled',
      branchCleanup: { requested: true, status: 'deferred' },
    });
    expect(mergeCall()?.[1]).toContain('--auto');
  });

  it('refuses merge conflicts even with auto-merge', async () => {
    useScenario({
      before: { ...openPr, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' },
    });

    const result = await executeGhPrMerge('88', { auto: true, strategy: 'squash' });

    expect(result.success).toBe(false);
    expect(mergeCall()).toBeUndefined();
  });

  it('requires an explicit strategy in non-interactive mode', async () => {
    useScenario();
    vi.mocked(promptSelect).mockRejectedValueOnce(
      new NonInteractiveError('Merge strategy:', '--strategy <merge|squash|rebase>')
    );

    await expect(executeGhPrMerge('88', {})).rejects.toMatchObject({
      flag: '--strategy <merge|squash|rebase>',
      name: 'NonInteractiveError',
    });
    expect(promptSelect).toHaveBeenCalledWith(
      expect.objectContaining({ flag: '--strategy <merge|squash|rebase>' })
    );
  });

  it('requires explicit confirmation in non-interactive mode', async () => {
    useScenario();
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true, yes: false }));

    await expect(executeGhPrMerge('88', { strategy: 'squash' })).rejects.toMatchObject({
      flag: '--yes',
      name: 'NonInteractiveError',
    });
    expect(mergeCall()).toBeUndefined();
  });

  it('prompts for a strategy and final confirmation interactively', async () => {
    useScenario();
    setRuntimeContext(buildRuntimeContext({ nonInteractive: false, yes: false }));
    vi.mocked(promptSelect).mockResolvedValueOnce('rebase');
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const result = await executeGhPrMerge('88', {});

    expect(result.success).toBe(true);
    expect(promptSelect).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ default: false, message: expect.stringContaining('PR #88') })
    );
    expect(mergeCall()?.[1]).toContain('--rebase');
  });

  it('treats an already merged PR as idempotent without requiring a strategy', async () => {
    useScenario({ before: mergedPr });

    const result = await executeGhPrMerge('88', {});

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.action).toBe('already_merged');
    expect(mergeCall()).toBeUndefined();
  });

  it('requests remote-only cleanup for an already merged PR', async () => {
    useScenario({ before: mergedPr });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.branchCleanup).toEqual({
      requested: true,
      status: 'completed',
    });
    expect(gitPushCall()).toEqual([
      'git',
      [
        'push',
        `--force-with-lease=refs/heads/${openPr.headRefName}:${headSha}`,
        'git@github.com:radkode/neo.git',
        `:refs/heads/${openPr.headRefName}`,
      ],
      { reject: false, stdio: ['ignore', 'pipe', 'pipe'] },
    ]);
    expect(mergeCall()).toBeUndefined();
  });

  it('reports cleanup failure without losing the confirmed merge result', async () => {
    useScenario({
      before: mergedPr,
      cleanupPushExitCode: 1,
      cleanupPushStderr: 'failed to delete remote branch',
    });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup).toMatchObject({
      requested: true,
      status: 'failed',
    });
  });

  it('refuses ambiguous cleanup destinations instead of pushing to mirrors', async () => {
    useScenario({
      before: mergedPr,
      remoteList: [
        'origin\tgit@github.com:radkode/neo.git (push)',
        'origin\thttps://github.com/radkode/neo.git (push)',
      ].join('\n'),
    });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup.status).toBe('failed');
    expect(gitPushCall()).toBeUndefined();
  });

  it('does not match a different HTTPS port for remote cleanup', async () => {
    const url = 'https://github.example.test:8443/radkode/neo/pull/88';
    useScenario({
      before: { ...mergedPr, url },
      remoteList: 'origin\thttps://github.example.test:9443/radkode/neo.git (push)',
    });

    const result = await executeGhPrMerge(url, { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup.status).toBe('failed');
    expect(gitPushCall()).toBeUndefined();
  });

  it('uses GitHub repository metadata to match GHES SSH cleanup', async () => {
    const url = 'https://github.example.test:8443/radkode/neo/pull/88';
    useScenario({
      before: { ...mergedPr, url },
      remoteList: 'origin\tgit@github.example.test:radkode/neo.git (push)',
      repositorySshUrl: 'git@github.example.test:radkode/neo.git',
    });

    const result = await executeGhPrMerge(url, { deleteRemoteBranch: true });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.branchCleanup.status).toBe('completed');
    expect(gitPushCall()?.[1]).toContain('git@github.example.test:radkode/neo.git');
  });

  it('does not infer that an arbitrary SSH port belongs to GitHub', async () => {
    const url = 'https://github.example.test/radkode/neo/pull/88';
    useScenario({
      before: { ...mergedPr, url },
      remoteList: 'origin\tssh://git@github.example.test:2222/radkode/neo.git (push)',
      repositorySshUrl: 'git@github.example.test:radkode/neo.git',
    });

    const result = await executeGhPrMerge(url, { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup.status).toBe('failed');
    expect(gitPushCall()).toBeUndefined();
  });

  it('treats an absent remote branch as already cleaned up', async () => {
    useScenario({ before: mergedPr, remoteHeads: [null] });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.branchCleanup).toEqual({
      requested: true,
      status: 'already_deleted',
    });
    expect(gitPushCall()).toBeUndefined();
  });

  it('refuses cleanup when the remote branch advanced after the merge', async () => {
    const advancedSha = '4a8e843282d790e957a157b39381af3f82fe7811';
    useScenario({ before: mergedPr, remoteHeads: [advancedSha] });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup).toMatchObject({
      requested: true,
      status: 'refused',
      reason: expect.stringContaining(advancedSha),
    });
    expect(gitPushCall()).toBeUndefined();
  });

  it('does not accept a merge when the head advances before postflight', async () => {
    const advancedSha = '4a8e843282d790e957a157b39381af3f82fe7811';
    useScenario({
      after: { ...mergedPr, headRefOid: advancedSha },
      remoteHeads: [advancedSha],
    });

    const result = await executeGhPrMerge('88', {
      deleteRemoteBranch: true,
      strategy: 'squash',
    });

    expect(result.success).toBe(false);
    expect(gitPushCall()).toBeUndefined();
  });

  it('refuses cleanup while an open PR still uses the branch', async () => {
    useScenario({
      before: mergedPr,
      relatedBasePrs: [{ number: 89, url: 'https://github.com/radkode/neo/pull/89' }],
    });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(confirmedCleanupFailure(result).branchCleanup).toMatchObject({
      requested: true,
      status: 'refused',
      reason: expect.stringContaining('PR #89'),
    });
    expect(gitPushCall()).toBeUndefined();
  });

  it('does not try to delete a fork branch', async () => {
    useScenario({ before: { ...mergedPr, isCrossRepository: true } });

    const result = await executeGhPrMerge('88', { deleteRemoteBranch: true });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.branchCleanup).toMatchObject({
      requested: true,
      status: 'skipped',
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(mergeCall()).toBeUndefined();
    expect(gitPushCall()).toBeUndefined();
  });

  it('does not apply base-repository dependency guards to a fork branch', async () => {
    useScenario({
      before: { ...openPr, isCrossRepository: true },
      after: { ...mergedPr, isCrossRepository: true },
      deleteBranchOnMerge: true,
      relatedBasePrs: [{ number: 89, url: 'https://github.com/radkode/neo/pull/89' }],
    });

    const result = await executeGhPrMerge('88', {
      deleteRemoteBranch: true,
      strategy: 'squash',
    });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data.branchCleanup.status).toBe('skipped');
    expect(mergeCall()).toBeDefined();
    expect(gitPushCall()).toBeUndefined();
  });

  it('confirms the postflight state even when gh reports a failure', async () => {
    useScenario({ mergeExitCode: 1, mergeStderr: 'connection closed after merge' });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    expect((result as { data: GhPrMergeResult }).data).toMatchObject({ action: 'merged' });
    expect((result as { data: GhPrMergeResult }).data.strategy).toBeUndefined();
  });

  it('does not re-query merge queue state after postflight confirms the merge', async () => {
    useScenario({
      queueResults: [{}, { exitCode: 1, stderr: 'transient queue query failure' }],
    });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(true);
    const queueCalls = vi
      .mocked(execa)
      .mock.calls.filter(
        ([command, args]) =>
          command === 'gh' && Array.isArray(args) && args[0] === 'api' && args[1] === 'graphql'
      );
    expect(queueCalls).toHaveLength(1);
  });

  it('does not accept a differently configured auto-merge request', async () => {
    useScenario({
      after: { ...openPr, autoMergeRequest: { mergeMethod: 'REBASE' } },
    });

    const result = await executeGhPrMerge('88', { auto: true, strategy: 'squash' });

    expect(result.success).toBe(false);
  });

  it('reports a merge failure when the PR remains open after submission', async () => {
    useScenario({ after: openPr, mergeExitCode: 1, mergeStderr: 'merge rejected' });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('merge rejected');
  });

  it('does not claim success when GitHub returns zero but the PR remains unchanged', async () => {
    useScenario({ after: openPr });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('could not confirm');
  });

  it('does not claim success when postflight inspection is unavailable', async () => {
    useScenario({ viewErrorAt: 1 });

    const result = await executeGhPrMerge('88', { strategy: 'squash' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('could not confirm');
  });

  it('emits one stable JSON result from the command action', async () => {
    useScenario();
    setRuntimeContext(buildRuntimeContext({ json: true, nonInteractive: true, yes: true }));

    await createPrMergeCommand().parseAsync(['88', '--strategy', 'squash'], { from: 'user' });

    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(stdoutWriteSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      action: 'merged',
      command: 'gh.pr.merge',
      number: 88,
      ok: true,
      strategy: 'squash',
      url: openPr.url,
    });
  });

  it('exits nonzero while preserving a confirmed merge when requested cleanup fails', async () => {
    useScenario({
      before: mergedPr,
      cleanupPushExitCode: 1,
      cleanupPushStderr: 'failed to delete remote branch',
    });
    setRuntimeContext(buildRuntimeContext({ json: true, nonInteractive: true, yes: true }));

    class ExitSignal extends Error {
      constructor(readonly exitCode: string | number | null | undefined) {
        super(`process.exit(${String(exitCode)})`);
      }
    }

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });

    try {
      await expect(
        createPrMergeCommand().parseAsync(['88', '--delete-remote-branch'], { from: 'user' })
      ).rejects.toMatchObject({ exitCode: 1 });

      expect(exitSpy.mock.calls).toEqual([[1]]);
      expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toMatchObject({
        error: {
          context: {
            result: {
              action: 'already_merged',
              branchCleanup: { requested: true, status: 'failed' },
              number: 88,
            },
          },
        },
      });
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('serializes nested JSON prompt failures through the root CLI', async () => {
    useScenario();
    vi.stubEnv('NEO_YES', '');

    class ExitSignal extends Error {
      constructor(readonly exitCode: string | number | null | undefined) {
        super(`process.exit(${String(exitCode)})`);
      }
    }

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });

    try {
      const { createCLI } = await import('@/cli');
      const program = await createCLI();

      await expect(
        program.parseAsync(['gh', 'pr', 'merge', '88', '--strategy', 'squash', '--json'], {
          from: 'user',
        })
      ).rejects.toMatchObject({ exitCode: 2 });

      expect(exitSpy.mock.calls).toEqual([[2]]);
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toMatchObject({
        error: {
          code: 'NEO_NON_INTERACTIVE',
          flag: '--yes',
          prompt: expect.stringContaining('PR #88'),
        },
      });
      expect(mergeCall()).toBeUndefined();
    } finally {
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('maps missing gh and missing authentication to actionable failures', async () => {
    const execaMock = vi.mocked(execa);
    execaMock.mockRejectedValueOnce(new Error('ENOENT'));

    const missingGh = await executeGhPrMerge('88', { strategy: 'squash' });
    expect(missingGh.success).toBe(false);

    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'gh version 2.96.0' }));
    execaMock.mockRejectedValueOnce(new Error('not logged in'));

    const missingAuth = await executeGhPrMerge('88', { strategy: 'squash' });
    expect(missingAuth.success).toBe(false);
  });
});
