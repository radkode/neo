import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execaResult } from '../../../utils/test-helpers.js';
import {
  createPrStatusCommand,
  executeGhPrStatus,
  NO_CHECKS_GRACE_MS,
  type GhPrStatusOutcome,
  type StatusDeps,
} from '@/commands/gh/pr/status/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { ghPrStatusOptionsSchema } from '@/types/schemas.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    plain: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), text: '' })),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

const headSha = 'e2dc721a4a41df00dc982487057710a6e8163df6';

const openPr = {
  autoMergeRequest: null,
  baseRefName: 'main',
  headRefName: 'jacek/feature',
  headRefOid: headSha,
  id: 'PR_kwDOExample88',
  isCrossRepository: false,
  isDraft: false,
  mergeCommit: null,
  mergeStateStatus: 'CLEAN' as string,
  mergeable: 'MERGEABLE' as string,
  mergedAt: null as string | null,
  number: 88,
  reviewDecision: 'APPROVED' as string | null,
  state: 'OPEN' as string,
  url: 'https://github.com/radkode/neo/pull/88',
};

type Check = { bucket: string; link: string; name: string; state: string; workflow?: string };

const pass = (name: string): Check => ({
  bucket: 'pass',
  link: `https://checks.test/${name}`,
  name,
  state: 'SUCCESS',
  workflow: 'CI',
});
const fail = (name: string): Check => ({ ...pass(name), bucket: 'fail', state: 'FAILURE' });
const pending = (name: string): Check => ({
  ...pass(name),
  bucket: 'pending',
  state: 'IN_PROGRESS',
});

interface Thread {
  isOutdated?: boolean;
  isResolved: boolean;
  line?: number | null;
  path?: string;
}

interface Poll {
  all?: Check[];
  pr?: Partial<typeof openPr>;
  required?: Check[];
}

/** Each poll is one full inspection; the last one repeats once the list runs out. */
function useScenario({
  polls = [{}],
  threads = [],
  threadsTotal,
}: { polls?: Poll[]; threads?: Thread[]; threadsTotal?: number } = {}): void {
  let viewCount = 0;
  const poll = (index: number): Poll => polls[Math.min(index, polls.length - 1)] ?? {};

  vi.mocked(execa).mockImplementation((async (command: string, args?: readonly string[]) => {
    const argv = [...(args ?? [])];
    // Checks and threads belong to the poll whose view ran last.
    const current = poll(viewCount - 1);

    if (command === 'gh' && argv[0] === '--version') return execaResult({ stdout: 'gh 2.96.0' });
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
      const value = { ...openPr, ...poll(viewCount).pr };
      viewCount += 1;
      return execaResult({ stdout: JSON.stringify(value) });
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'checks') {
      const required = argv.includes('--required');
      const list = required
        ? (current.required ?? [pass('test')])
        : (current.all ?? [pass('test')]);
      if (list.length === 0) {
        return execaResult({
          exitCode: 1,
          stderr: required
            ? 'no required checks reported on the jacek/feature branch'
            : 'no checks reported on the jacek/feature branch',
        });
      }
      return execaResult({ stdout: JSON.stringify(list) });
    }
    if (command === 'gh' && argv[0] === 'api' && argv[1] === 'graphql') {
      return execaResult({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  totalCount: threadsTotal ?? threads.length,
                  nodes: threads.map((thread, index) => ({
                    isOutdated: thread.isOutdated ?? false,
                    isResolved: thread.isResolved,
                    line: thread.line === undefined ? 10 + index : thread.line,
                    path: thread.path ?? 'src/index.ts',
                    comments: {
                      nodes: [
                        {
                          author: { login: 'reviewer' },
                          url: `https://github.com/radkode/neo/pull/88#discussion_r${index}`,
                        },
                      ],
                    },
                  })),
                },
              },
            },
          },
        }),
      });
    }

    throw new Error(`Unexpected command: ${command} ${argv.join(' ')}`);
  }) as unknown as Parameters<ReturnType<typeof vi.mocked<typeof execa>>['mockImplementation']>[0]);
}

function fakeClock(): StatusDeps & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

const defaults = ghPrStatusOptionsSchema.parse({});

async function statusOf(
  target: string | undefined,
  options: Partial<typeof defaults> = {},
  deps: StatusDeps = fakeClock()
): Promise<GhPrStatusOutcome> {
  const result = await executeGhPrStatus(target, { ...defaults, ...options }, deps);
  if (!result.success) throw result.error;
  return result.data;
}

/** Argument lists of every execa call, so tests can filter them without narrowing each one. */
function callArgs(): Array<{ command: string; args: string[] }> {
  return vi.mocked(execa).mock.calls.map(([command, args]) => ({
    command: String(command),
    args: Array.isArray(args) ? args.map(String) : [],
  }));
}

function viewCalls(): string[][] {
  return callArgs()
    .filter(({ command, args }) => command === 'gh' && args[0] === 'pr' && args[1] === 'view')
    .map(({ args }) => args);
}

describe('gh pr status', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    process.exitCode = undefined;
    setRuntimeContext(buildRuntimeContext());
  });

  it('registers its options with defaults', () => {
    const command = createPrStatusCommand();

    expect(command.name()).toBe('status');
    expect(command.registeredArguments[0]?.name()).toBe('pull-request');
    expect(command.options.map(({ flags }) => flags)).toEqual([
      '-w, --wait',
      '--interval <seconds>',
      '--timeout <minutes>',
    ]);
    expect(defaults).toMatchObject({ interval: 15, timeout: 30 });
    expect(ghPrStatusOptionsSchema.safeParse({ interval: '0' }).success).toBe(false);
  });

  describe('verdicts', () => {
    it('reports a green, approved, clean PR as ready', async () => {
      useScenario({ polls: [{ all: [pass('test'), pass('lint')], required: [pass('test')] }] });

      const { status, waited } = await statusOf('88');

      expect(waited).toBe(false);
      expect(status).toMatchObject({
        blockers: [],
        headRefOid: headSha,
        number: 88,
        verdict: 'ready',
        checks: { gating: 'required', passed: ['test'], failed: [], pending: [] },
      });
      expect(status.checks.items.map(({ name, required }) => [name, required])).toEqual([
        ['test', true],
        ['lint', false],
      ]);
    });

    it('lets only required checks decide when some are required', async () => {
      useScenario({
        polls: [{ all: [pass('test'), fail('optional-e2e')], required: [pass('test')] }],
      });

      expect((await statusOf('88')).status.verdict).toBe('ready');
    });

    it('falls back to all checks when none are required', async () => {
      useScenario({ polls: [{ all: [pass('test'), fail('lint')], required: [] }] });

      const { status } = await statusOf('88');

      expect(status.verdict).toBe('failing');
      expect(status.checks).toMatchObject({ gating: 'all', failed: ['lint'] });
      expect(status.blockers).toEqual(['checks failed: lint']);
    });

    it('reports a failing required check before anything else', async () => {
      useScenario({
        polls: [
          {
            all: [fail('test')],
            required: [fail('test')],
            pr: { reviewDecision: 'REVIEW_REQUIRED' },
          },
        ],
      });

      const { status } = await statusOf('88');

      expect(status.verdict).toBe('failing');
      expect(status.blockers).toEqual([
        'required review is missing',
        'required checks failed: test',
      ]);
    });

    it('reports a conflicting head', async () => {
      useScenario({ polls: [{ pr: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' } }] });

      expect((await statusOf('88')).status.verdict).toBe('conflicting');
    });

    it('reports running checks as pending', async () => {
      useScenario({ polls: [{ all: [pending('test')], required: [pending('test')] }] });

      const { status } = await statusOf('88');

      expect(status.verdict).toBe('pending');
      expect(status.checks.pending).toEqual(['test']);
    });

    it('reports green CI that still needs a review as blocked, with the reason', async () => {
      useScenario({
        polls: [{ pr: { reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' } }],
      });

      const { status } = await statusOf('88');

      expect(status.verdict).toBe('blocked');
      expect(status.blockers).toEqual([
        'required review is missing',
        'base branch policy blocks the merge',
      ]);
    });

    it('reports a draft as blocked', async () => {
      useScenario({ polls: [{ pr: { isDraft: true, mergeStateStatus: 'DRAFT' } }] });

      const { status } = await statusOf('88');

      expect(status.verdict).toBe('blocked');
      expect(status.blockers).toContain('pull request is a draft');
    });

    it('reports a merged PR without asking for required checks', async () => {
      useScenario({
        polls: [
          { pr: { state: 'MERGED', mergedAt: '2026-10-22T02:25:00Z', mergeable: 'UNKNOWN' } },
        ],
      });

      const { status } = await statusOf('88');

      expect(status).toMatchObject({
        verdict: 'merged',
        blockers: [],
        mergedAt: '2026-10-22T02:25:00Z',
      });
      const requiredCalls = callArgs().filter(
        ({ args }) => args[1] === 'checks' && args.includes('--required')
      );
      expect(requiredCalls).toHaveLength(0);
    });

    it('reports a closed PR as closed', async () => {
      useScenario({ polls: [{ pr: { state: 'CLOSED' } }] });

      const { status } = await statusOf('88');

      expect(status).toMatchObject({ verdict: 'closed', blockers: ['pull request is closed'] });
    });
  });

  describe('review threads', () => {
    it('lists only unresolved threads, outdated ones included', async () => {
      useScenario({
        threads: [
          { isResolved: true },
          { isResolved: false, path: 'src/a.ts', line: 3 },
          { isResolved: false, path: 'src/b.ts', line: null, isOutdated: true },
        ],
      });

      const { status } = await statusOf('88');

      expect(status.unresolvedThreads).toEqual({
        truncated: false,
        threads: [
          {
            author: 'reviewer',
            isOutdated: false,
            line: 3,
            path: 'src/a.ts',
            url: 'https://github.com/radkode/neo/pull/88#discussion_r1',
          },
          {
            author: 'reviewer',
            isOutdated: true,
            line: null,
            path: 'src/b.ts',
            url: 'https://github.com/radkode/neo/pull/88#discussion_r2',
          },
        ],
      });
    });

    it('flags a thread list that does not cover every thread', async () => {
      useScenario({ threads: [{ isResolved: false }], threadsTotal: 150 });

      expect((await statusOf('88')).status.unresolvedThreads.truncated).toBe(true);
    });

    it('queries the threads of the resolved repository and PR', async () => {
      useScenario();

      await statusOf('88');

      const graphql = callArgs().find(({ args }) => args[1] === 'graphql');
      expect(graphql?.args).toEqual(
        expect.arrayContaining([
          '--hostname',
          'github.com',
          'owner=radkode',
          'name=neo',
          'number=88',
        ])
      );
    });
  });

  describe('--wait', () => {
    it('returns at once when the PR has already settled', async () => {
      useScenario();
      const clock = fakeClock();

      const outcome = await statusOf('88', { wait: true }, clock);

      expect(outcome).toMatchObject({
        waited: true,
        timedOut: false,
        status: { verdict: 'ready' },
      });
      expect(clock.sleeps).toEqual([]);
    });

    it('polls the resolved PR until pending checks settle', async () => {
      useScenario({
        polls: [
          { all: [pending('test')], required: [pending('test')] },
          { all: [pending('test')], required: [pending('test')] },
          {},
        ],
      });
      const clock = fakeClock();
      const onWait = vi.fn();

      const outcome = await statusOf(undefined, { wait: true, interval: 20 }, { ...clock, onWait });

      expect(outcome.status.verdict).toBe('ready');
      expect(clock.sleeps).toEqual([20_000, 20_000]);
      expect(onWait).toHaveBeenCalledTimes(2);
      const [first, ...later] = viewCalls();
      expect(first?.slice(0, 3)).toEqual(['pr', 'view', '--json']);
      for (const args of later) {
        expect(args.slice(0, 5)).toEqual(['pr', 'view', '88', '--repo', 'github.com/radkode/neo']);
      }
    });

    it('stops on a failure instead of waiting it out', async () => {
      useScenario({
        polls: [
          { all: [pending('test')], required: [pending('test')] },
          { all: [fail('test')], required: [fail('test')] },
        ],
      });
      const clock = fakeClock();

      const outcome = await statusOf('88', { wait: true }, clock);

      expect(outcome.status.verdict).toBe('failing');
      expect(clock.sleeps).toHaveLength(1);
    });

    it('waits through the grace period for checks to register after a push', async () => {
      useScenario({
        polls: [
          { all: [], required: [] },
          { all: [], required: [] },
          { all: [pending('test')], required: [] },
          {},
        ],
      });
      const clock = fakeClock();

      const outcome = await statusOf('88', { wait: true, interval: 15 }, clock);

      expect(outcome.status.verdict).toBe('ready');
      expect(clock.sleeps).toEqual([15_000, 15_000, 15_000]);
    });

    it('accepts a PR without checks once the grace period passes', async () => {
      useScenario({ polls: [{ all: [], required: [] }] });
      const clock = fakeClock();

      const outcome = await statusOf('88', { wait: true, interval: 15 }, clock);

      expect(outcome).toMatchObject({ timedOut: false, status: { verdict: 'ready' } });
      expect(clock.sleeps.reduce((total, ms) => total + ms, 0)).toBe(NO_CHECKS_GRACE_MS);
    });

    it('gives up at the timeout and reports the last status', async () => {
      useScenario({ polls: [{ all: [pending('test')], required: [pending('test')] }] });
      const clock = fakeClock();

      const outcome = await statusOf('88', { wait: true, interval: 30, timeout: 1 }, clock);

      expect(outcome).toMatchObject({
        timedOut: true,
        waited: true,
        status: { verdict: 'pending' },
      });
      expect(clock.sleeps).toEqual([30_000, 30_000]);
    });
  });

  describe('failures', () => {
    it('requires the GitHub CLI', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('ENOENT'));

      const result = await executeGhPrStatus('88', defaults);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.message).toBe('GitHub CLI (gh) is not installed');
    });

    it('explains a missing GitHub login', async () => {
      vi.mocked(execa).mockImplementation((async (_command: string, args?: readonly string[]) => {
        if (args?.[0] === '--version') return execaResult({ stdout: 'gh 2.96.0' });
        throw Object.assign(new Error('failed'), {
          stderr: 'To get started with GitHub CLI, please run:  gh auth login',
        });
      }) as unknown as Parameters<
        ReturnType<typeof vi.mocked<typeof execa>>['mockImplementation']
      >[0]);

      const result = await executeGhPrStatus('88', defaults);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.message).toBe('Not authenticated with GitHub CLI for the target host');
    });
  });

  describe('command output', () => {
    const payload = () => JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]));

    beforeEach(() => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
    });

    it('exits 0 for any readable PR without --wait', async () => {
      useScenario({ polls: [{ all: [fail('test')], required: [fail('test')] }] });

      await createPrStatusCommand().parseAsync(['88'], { from: 'user' });

      expect(payload()).toMatchObject({
        ok: true,
        command: 'gh.pr.status',
        verdict: 'failing',
        headRefOid: headSha,
        waited: false,
        timedOut: false,
      });
      expect(process.exitCode).toBeUndefined();
    });

    it('exits 1 with --wait when the PR settles as not mergeable', async () => {
      useScenario({ polls: [{ all: [fail('test')], required: [fail('test')] }] });

      await createPrStatusCommand().parseAsync(['88', '--wait'], { from: 'user' });

      expect(payload()).toMatchObject({ ok: false, verdict: 'failing', waited: true });
      expect(process.exitCode).toBe(1);
    });

    it('exits 0 with --wait when the PR is ready', async () => {
      useScenario();

      await createPrStatusCommand().parseAsync(['88', '--wait'], { from: 'user' });

      expect(payload()).toMatchObject({ ok: true, verdict: 'ready', waited: true });
      expect(process.exitCode).toBeUndefined();
    });
  });
});
