import { Command } from '@commander-js/extra-typings';
import { setTimeout as delay } from 'node:timers/promises';
import { CommandError, failure, isFailure, success, type Result } from '@/core/errors/index.js';
import { ghPrStatusOptionsSchema, type GhPrStatusOptions } from '@/types/schemas.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';
import {
  errorText,
  inspectChecks,
  inspectPr,
  inspectUnresolvedReviewThreads,
  isGhAuthError,
  isGhInstalled,
  readinessIssues,
  repositoryFromPrUrl,
  summarizeChecks,
  type PrCheck,
  type RequiredChecksSummary,
  type UnresolvedReviewThreads,
} from '@/commands/gh/pr/inspection.js';

/**
 * Where the PR stands, most decisive first:
 * - merged / closed: nothing left to do
 * - failing: a gating check failed
 * - conflicting: the head conflicts with the base
 * - pending: a gating check or GitHub's mergeability computation is still running
 * - blocked: CI settled, but something else stops the merge (review, draft, branch policy)
 * - ready: GitHub would accept a merge now
 */
export type PrVerdict =
  'merged' | 'closed' | 'failing' | 'conflicting' | 'pending' | 'blocked' | 'ready';

export interface PrStatusCheck {
  bucket: string;
  link: string;
  name: string;
  required: boolean;
  state: string;
  workflow?: string | undefined;
}

export interface GhPrStatusResult {
  baseRefName: string;
  /** Reasons the PR cannot merge yet; empty when ready or merged. */
  blockers: string[];
  checks: RequiredChecksSummary & {
    /** Which checks decide the verdict: the required ones, or all when none are required. */
    gating: 'required' | 'all';
    items: PrStatusCheck[];
  };
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  mergeStateStatus: string;
  mergeable: string;
  mergedAt: string | null;
  number: number;
  reviewDecision: string | null;
  state: string;
  unresolvedThreads: UnresolvedReviewThreads;
  url: string;
  verdict: PrVerdict;
}

export interface GhPrStatusOutcome {
  status: GhPrStatusResult;
  /** True when --wait gave up before the PR settled. */
  timedOut: boolean;
  waited: boolean;
}

/** Verdicts --wait keeps polling through. */
const UNSETTLED: ReadonlySet<PrVerdict> = new Set(['pending']);
/** Verdicts that make --wait exit 0. */
const SUCCESSFUL: ReadonlySet<PrVerdict> = new Set(['ready', 'merged']);
/**
 * Right after a push, GitHub can take a moment to register a PR's checks. Under --wait, an
 * open PR that reports no checks at all is treated as pending for this long before Neo
 * accepts that the repository runs none.
 */
export const NO_CHECKS_GRACE_MS = 60_000;

export interface StatusDeps {
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  /** Called before each wait so text mode can show progress. */
  onWait?: (status: GhPrStatusResult, elapsedMs: number) => void;
}

const defaultDeps: StatusDeps = { now: Date.now, sleep: (ms) => delay(ms) };

function decideVerdict(
  pr: Parameters<typeof readinessIssues>[0],
  gating: RequiredChecksSummary,
  gatingKind: 'required' | 'all'
): { blockers: string[]; verdict: PrVerdict } {
  if (pr.state === 'MERGED') return { blockers: [], verdict: 'merged' };
  if (pr.state !== 'OPEN')
    return { blockers: [`pull request is ${pr.state.toLowerCase()}`], verdict: 'closed' };

  // Check blockers are worded here, since the gating checks are not always required ones.
  const issues = readinessIssues(pr, { failed: [], passed: [], pending: [] });
  const label = gatingKind === 'required' ? 'required checks' : 'checks';
  const blockers = [...issues.hard, ...issues.requirements];
  if (gating.pending.length > 0)
    blockers.push(`${label} are pending: ${gating.pending.join(', ')}`);
  if (gating.failed.length > 0) blockers.push(`${label} failed: ${gating.failed.join(', ')}`);
  if (gating.failed.length > 0) return { blockers, verdict: 'failing' };
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    return { blockers, verdict: 'conflicting' };
  }
  if (
    gating.pending.length > 0 ||
    pr.mergeable === 'UNKNOWN' ||
    pr.mergeStateStatus === 'UNKNOWN'
  ) {
    return { blockers, verdict: 'pending' };
  }
  return { blockers, verdict: blockers.length > 0 ? 'blocked' : 'ready' };
}

async function inspectStatus(
  target: string | undefined,
  repository?: string
): Promise<GhPrStatusResult> {
  const pr = await inspectPr(target, repository);
  const repo = repositoryFromPrUrl(pr.url);

  const [allChecks, requiredChecks, unresolvedThreads] = await Promise.all([
    inspectChecks(pr.number, repo.selector, { required: false }),
    pr.state === 'OPEN'
      ? inspectChecks(pr.number, repo.selector, { required: true })
      : Promise.resolve<PrCheck[]>([]),
    inspectUnresolvedReviewThreads(pr, repo),
  ]);

  const requiredNames = new Set(requiredChecks.map(({ name }) => name));
  const gating = requiredChecks.length > 0 ? 'required' : 'all';
  const summary = summarizeChecks(gating === 'required' ? requiredChecks : allChecks);
  const { blockers, verdict } = decideVerdict(pr, summary, gating);

  return {
    baseRefName: pr.baseRefName,
    blockers,
    checks: {
      ...summary,
      gating,
      items: allChecks.map((check) => ({ ...check, required: requiredNames.has(check.name) })),
    },
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    isDraft: pr.isDraft,
    mergeStateStatus: pr.mergeStateStatus,
    mergeable: pr.mergeable,
    mergedAt: pr.mergedAt,
    number: pr.number,
    reviewDecision: pr.reviewDecision,
    state: pr.state,
    unresolvedThreads,
    url: pr.url,
    verdict,
  };
}

function isSettling(status: GhPrStatusResult, elapsedMs: number): boolean {
  if (UNSETTLED.has(status.verdict)) return true;
  return (
    status.state === 'OPEN' && status.checks.items.length === 0 && elapsedMs < NO_CHECKS_GRACE_MS
  );
}

export function isSuccessfulVerdict(verdict: PrVerdict): boolean {
  return SUCCESSFUL.has(verdict);
}

export async function executeGhPrStatus(
  target: string | undefined,
  options: GhPrStatusOptions,
  deps: StatusDeps = defaultDeps
): Promise<Result<GhPrStatusOutcome>> {
  try {
    if (!(await isGhInstalled())) {
      return failure(
        new CommandError('GitHub CLI (gh) is not installed', 'gh-pr-status', {
          suggestions: ['Install GitHub CLI: https://cli.github.com/'],
        })
      );
    }

    let status = await inspectStatus(target);
    if (!options.wait) return success({ status, timedOut: false, waited: false });

    // Poll the resolved PR from here on, so a branch target cannot drift to another PR.
    const repository = repositoryFromPrUrl(status.url).selector;
    const started = deps.now();
    const intervalMs = options.interval * 1000;
    const timeoutMs = options.timeout * 60_000;

    while (isSettling(status, deps.now() - started)) {
      const elapsed = deps.now() - started;
      if (elapsed + intervalMs > timeoutMs) {
        return success({ status, timedOut: true, waited: true });
      }
      deps.onWait?.(status, elapsed);
      await deps.sleep(intervalMs);
      status = await inspectStatus(String(status.number), repository);
    }

    return success({ status, timedOut: false, waited: true });
  } catch (error) {
    if (error instanceof CommandError) return failure(error);
    const detail = errorText(error);
    if (isGhAuthError(detail)) {
      return failure(
        new CommandError('Not authenticated with GitHub CLI for the target host', 'gh-pr-status', {
          suggestions: ['Run: gh auth login'],
        })
      );
    }
    return failure(
      new CommandError(`Could not inspect the pull request: ${detail}`, 'gh-pr-status')
    );
  }
}

const VERDICT_LABELS: Record<PrVerdict, string> = {
  blocked: 'Blocked',
  closed: 'Closed without merging',
  conflicting: 'Conflicts with the base branch',
  failing: 'Checks failing',
  merged: 'Merged',
  pending: 'Checks pending',
  ready: 'Ready to merge',
};

function checkCounts(status: GhPrStatusResult): string {
  const { checks } = status;
  if (checks.items.length === 0) return 'no checks reported';
  return `${checks.passed.length} passed, ${checks.failed.length} failed, ${checks.pending.length} pending (${checks.gating === 'required' ? 'required checks' : 'all checks; none are required'})`;
}

function renderText(outcome: GhPrStatusOutcome): void {
  const { status } = outcome;
  const headline = `PR #${status.number}: ${VERDICT_LABELS[status.verdict]}`;
  if (isSuccessfulVerdict(status.verdict)) ui.success(headline);
  else if (status.verdict === 'pending') ui.info(headline);
  else ui.error(headline);
  if (outcome.timedOut) ui.warn('Stopped waiting: the timeout passed before the PR settled');

  ui.muted(`${status.headRefName} into ${status.baseRefName} at ${status.headRefOid.slice(0, 12)}`);
  ui.muted(status.url);
  ui.plain(`Checks: ${checkCounts(status)}`);
  for (const check of status.checks.items) {
    const bucket = check.bucket.toLowerCase();
    if (bucket === 'fail' || bucket === 'cancel' || bucket === 'pending') {
      ui.plain(
        `  ${bucket === 'pending' ? '…' : '✗'} ${check.name}${check.required ? ' (required)' : ''} ${check.link}`
      );
    }
  }
  ui.plain(`Review: ${status.reviewDecision ?? 'none required'}`);
  const { threads, truncated } = status.unresolvedThreads;
  if (threads.length > 0 || truncated) {
    ui.plain(`Unresolved review threads: ${threads.length}${truncated ? '+' : ''}`);
    for (const thread of threads) {
      ui.plain(
        `  ${thread.path}${thread.line === null ? '' : `:${thread.line}`}${thread.author ? ` @${thread.author}` : ''}${thread.isOutdated ? ' (outdated)' : ''} ${thread.url ?? ''}`.trimEnd()
      );
    }
  }
  if (status.blockers.length > 0) {
    ui.plain('Blockers:');
    ui.list(status.blockers);
  }
}

export function createPrStatusCommand(): Command {
  const command = new Command('status');

  command
    .description('Show whether a pull request can merge: checks, reviews, threads, mergeability')
    .argument('[pull-request]', 'pull request number, URL, or branch (default: current branch)')
    .option('-w, --wait', 'poll until checks settle; exit 0 only if the PR is ready or merged')
    .option('--interval <seconds>', 'seconds between polls with --wait', '15')
    .option('--timeout <minutes>', 'minutes to wait before giving up with --wait', '30')
    .addHelpText(
      'after',
      `
Verdicts: ready, pending, failing, conflicting, blocked, merged, closed.
Without --wait the command exits 0 whenever it can read the PR. With --wait it
exits 0 only for ready or merged, so it chains: status --wait && merge.

Examples:
  Show the current branch's PR:
    $ neo gh pr status

  Wait for CI, then merge the exact commit that was inspected:
    $ head=$(neo gh pr status 88 --wait --json | jq -r .headRefOid) &&
        neo gh pr merge 88 --strategy squash --head "$head"
`
    )
    .action(
      runAction(async (target: string | undefined, rawOptions: unknown) => {
        const options: GhPrStatusOptions = validate(
          ghPrStatusOptionsSchema,
          rawOptions,
          'gh pr status options'
        );
        const spinner = options.wait ? ui.spinner('Waiting for the pull request') : null;
        const result = await executeGhPrStatus(target, options, {
          ...defaultDeps,
          onWait: (status, elapsedMs) => {
            if (!spinner) return;
            spinner.text = `Waiting for PR #${status.number}: ${checkCounts(status)} (${Math.round(elapsedMs / 1000)}s elapsed)`;
            spinner.start();
          },
        });
        spinner?.stop();
        if (isFailure(result)) throw result.error;

        const { status, timedOut, waited } = result.data;
        const ok = !waited || (!timedOut && isSuccessfulVerdict(status.verdict));
        emitJson(
          { ok, command: 'gh.pr.status', ...status, timedOut, waited },
          { text: () => renderText(result.data) }
        );
        // The payload above already carries the verdict; only the exit code is left to set.
        if (!ok) process.exitCode = 1;
      })
    );

  return command;
}
