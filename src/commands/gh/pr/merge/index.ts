import { Command } from '@commander-js/extra-typings';
import { confirm } from '@inquirer/prompts';
import { execa } from 'execa';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { CommandError, failure, isFailure, success, type Result } from '@/core/errors/index.js';
import { ghPrMergeOptionsSchema, type GhPrMergeOptions } from '@/types/schemas.js';
import { emitJson } from '@/utils/output.js';
import { NonInteractiveError, promptSelect } from '@/utils/prompt.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { runAction } from '@/utils/run-action.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';

const prInfoSchema = z.object({
  autoMergeRequest: z.object({ mergeMethod: z.string() }).nullable(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  id: z.string(),
  isCrossRepository: z.boolean(),
  isDraft: z.boolean(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  mergeStateStatus: z.string(),
  mergeable: z.string(),
  mergedAt: z.string().nullable(),
  number: z.number(),
  reviewDecision: z.string().nullable(),
  state: z.string(),
  url: z.string().url(),
});

const requiredChecksSchema = z.array(
  z.object({ bucket: z.string(), link: z.string(), name: z.string(), state: z.string() })
);

const relatedPrsSchema = z.array(
  z.object({
    headRepository: z.object({ nameWithOwner: z.string() }).nullable(),
    number: z.number(),
    url: z.string().url(),
  })
);
const mergeStrategySchema = z.enum(['merge', 'squash', 'rebase']);

const mergeQueueStateSchema = z.object({
  data: z.object({
    node: z.object({ isInMergeQueue: z.boolean(), isMergeQueueEnabled: z.boolean() }),
  }),
});

const repositorySettingsSchema = z.object({
  deleteBranchOnMerge: z.boolean(),
  sshUrl: z.string(),
});

type PrInfo = z.infer<typeof prInfoSchema>;
type RequiredCheck = z.infer<typeof requiredChecksSchema>[number];
type MergeStrategy = NonNullable<GhPrMergeOptions['strategy']>;

export interface RequiredChecksSummary {
  failed: string[];
  passed: string[];
  pending: string[];
}

export interface BranchCleanupResult {
  reason?: string;
  requested: boolean;
  status:
    | 'not_requested'
    | 'completed'
    | 'already_deleted'
    | 'deferred'
    | 'skipped'
    | 'refused'
    | 'failed';
}

export interface GhPrMergeResult {
  action: 'merged' | 'already_merged' | 'auto_merge_enabled' | 'queued' | 'submitted';
  auto: boolean;
  baseRefName: string;
  branchCleanup: BranchCleanupResult;
  headRefName: string;
  headRefOid: string;
  mergeCommit?: string;
  mergedAt?: string;
  number: number;
  readiness: {
    mergeable: string;
    mergeStateStatus: string;
    requiredChecks: RequiredChecksSummary;
    reviewDecision: string | null;
  };
  strategy?: MergeStrategy;
  url: string;
}

async function isGhInstalled(): Promise<boolean> {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = Reflect.get(error, 'stderr');
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

async function inspectPr(target?: string, repository?: string): Promise<PrInfo> {
  let last: PrInfo | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const args = ['pr', 'view'];
    if (target) args.push(target);
    if (repository) args.push('--repo', repository);
    args.push(
      '--json',
      [
        'autoMergeRequest',
        'baseRefName',
        'headRefName',
        'headRefOid',
        'id',
        'isCrossRepository',
        'isDraft',
        'mergeCommit',
        'mergeStateStatus',
        'mergeable',
        'mergedAt',
        'number',
        'reviewDecision',
        'state',
        'url',
      ].join(',')
    );
    const { stdout } = await execa('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    last = prInfoSchema.parse(JSON.parse(stdout));
    const unknown = last.mergeable === 'UNKNOWN' || last.mergeStateStatus === 'UNKNOWN';
    if (last.state !== 'OPEN' || !unknown) return last;
    if (attempt < 2) await delay(100);
  }

  return last as PrInfo;
}

async function inspectPostflight(number: number, repository: string): Promise<PrInfo> {
  let last: PrInfo | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await inspectPr(String(number), repository);
    if (last.state === 'MERGED' || last.autoMergeRequest !== null) return last;
    if (attempt < 2) await delay(100);
  }
  return last as PrInfo;
}

interface RepositoryTarget {
  apiHost: string;
  nameWithOwner: string;
  selector: string;
}

function repositoryFromPrUrl(url: string): RepositoryTarget {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[2] !== 'pull') {
    throw new Error(`Could not determine the repository from ${url}`);
  }
  const nameWithOwner = `${parts[0]}/${parts[1]}`;
  return {
    apiHost: parsed.host.toLowerCase(),
    nameWithOwner,
    selector: `${parsed.host}/${nameWithOwner}`,
  };
}

interface MergeQueueState {
  isInMergeQueue: boolean;
  isMergeQueueEnabled: boolean;
}

async function inspectMergeQueue(
  pr: PrInfo,
  repository: RepositoryTarget
): Promise<MergeQueueState> {
  const query =
    'query PullRequestMergeQueueState($id: ID!) { node(id: $id) { ... on PullRequest { isInMergeQueue isMergeQueueEnabled } } }';
  const result = await execa(
    'gh',
    [
      'api',
      'graphql',
      '--hostname',
      repository.apiHost,
      '-f',
      `query=${query}`,
      '-F',
      `id=${pr.id}`,
    ],
    { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `Could not inspect the merge queue for PR #${pr.number}.`
    );
  }
  if (!result.stdout.trim()) {
    throw new Error(`GitHub returned no merge queue state for PR #${pr.number}.`);
  }
  try {
    return mergeQueueStateSchema.parse(JSON.parse(result.stdout)).data.node;
  } catch (error) {
    throw new Error(
      `Could not parse the merge queue state for PR #${pr.number}: ${errorText(error)}`,
      { cause: error }
    );
  }
}

async function inspectRequiredChecks(number: number, repository: string): Promise<RequiredCheck[]> {
  const result = await execa(
    'gh',
    [
      'pr',
      'checks',
      String(number),
      '--repo',
      repository,
      '--required',
      '--json',
      'name,state,bucket,link',
    ],
    { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (result.stdout.trim()) return requiredChecksSchema.parse(JSON.parse(result.stdout));
  const stderr = result.stderr.toLowerCase();
  if (
    result.exitCode === 0 ||
    stderr.includes('no checks reported on') ||
    stderr.includes('no required checks reported')
  ) {
    return [];
  }
  throw new Error(`Could not inspect required checks: ${result.stderr.trim()}`);
}

type RepositorySettings = z.infer<typeof repositorySettingsSchema>;

async function inspectRepositorySettings(repository: string): Promise<RepositorySettings> {
  const result = await execa(
    'gh',
    ['repo', 'view', repository, '--json', 'deleteBranchOnMerge,sshUrl'],
    { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `Could not inspect branch cleanup settings for ${repository}.`
    );
  }
  return repositorySettingsSchema.parse(JSON.parse(result.stdout));
}

function summarizeChecks(checks: RequiredCheck[]): RequiredChecksSummary {
  const summary: RequiredChecksSummary = { failed: [], passed: [], pending: [] };
  for (const check of checks) {
    switch (check.bucket.toLowerCase()) {
      case 'pass':
      case 'skipping':
        summary.passed.push(check.name);
        break;
      case 'fail':
      case 'cancel':
        summary.failed.push(check.name);
        break;
      default:
        summary.pending.push(check.name);
    }
  }
  return summary;
}

function readinessIssues(
  pr: PrInfo,
  checks: RequiredChecksSummary
): { hard: string[]; requirements: string[] } {
  const hard = new Set<string>();
  const requirements = new Set<string>();

  if (pr.state !== 'OPEN') hard.add(`pull request state is ${pr.state.toLowerCase()}`);
  if (pr.isDraft || pr.mergeStateStatus === 'DRAFT') hard.add('pull request is a draft');
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    hard.add('head branch conflicts with the base branch');
  }
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN') {
    hard.add('GitHub could not determine mergeability');
  }

  if (pr.reviewDecision === 'REVIEW_REQUIRED') requirements.add('required review is missing');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') requirements.add('changes were requested');
  if (checks.pending.length > 0) {
    requirements.add(`required checks are pending: ${checks.pending.join(', ')}`);
  }
  if (checks.failed.length > 0) {
    requirements.add(`required checks failed: ${checks.failed.join(', ')}`);
  }
  if (pr.mergeStateStatus === 'BEHIND') requirements.add('head branch is behind the base branch');
  if (pr.mergeStateStatus === 'BLOCKED') requirements.add('base branch policy blocks the merge');

  return { hard: [...hard], requirements: [...requirements] };
}

async function resolveStrategy(options: GhPrMergeOptions): Promise<MergeStrategy> {
  if (options.strategy) return options.strategy;
  return promptSelect({
    message: 'Merge strategy:',
    choices: [
      { label: 'Squash and merge', value: 'squash' },
      { label: 'Create a merge commit', value: 'merge' },
      { label: 'Rebase and merge', value: 'rebase' },
    ],
    flag: '--strategy <merge|squash|rebase>',
  });
}

async function confirmMutation(message: string): Promise<boolean> {
  const context = getRuntimeContext();
  if (context.yes) return true;
  if (context.nonInteractive) throw new NonInteractiveError(message, '--yes');
  return confirm({ message, default: false });
}

function emptyChecks(): RequiredChecksSummary {
  return { failed: [], passed: [], pending: [] };
}

function pendingCleanup(pr: PrInfo, requested: boolean): BranchCleanupResult {
  if (!requested) return { requested: false, status: 'not_requested' };
  if (pr.isCrossRepository) {
    return {
      requested: true,
      status: 'skipped',
      reason: 'Neo does not delete branches from forked repositories.',
    };
  }
  if (pr.state !== 'MERGED') {
    return {
      requested: true,
      status: 'deferred',
      reason: 'The PR has not merged yet. Run this command again after it merges.',
    };
  }
  return { requested: true, status: 'deferred' };
}

interface RemoteRepository {
  host: string;
  hostname: string;
  nameWithOwner: string;
  port: string;
  transport: 'http' | 'ssh' | 'other';
}

function parseRemoteRepository(url: string): RemoteRepository | null {
  let host: string;
  let hostname: string;
  let path: string;
  let port: string;
  let transport: RemoteRepository['transport'];

  try {
    if (url.includes('://')) {
      const parsed = new URL(url);
      host = parsed.host;
      hostname = parsed.hostname;
      path = parsed.pathname;
      port = parsed.port;
      transport =
        parsed.protocol === 'http:' || parsed.protocol === 'https:'
          ? 'http'
          : parsed.protocol === 'ssh:'
            ? 'ssh'
            : 'other';
    } else {
      const match = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(url);
      if (!match?.[1] || !match[2]) return null;
      host = match[1];
      hostname = match[1];
      path = match[2];
      port = '';
      transport = 'ssh';
    }
  } catch {
    return null;
  }

  const nameWithOwner = path.replace(/^\/+/, '').replace(/\.git$/, '');
  if (nameWithOwner.split('/').length !== 2) return null;
  return {
    host: host.toLowerCase(),
    hostname: hostname.toLowerCase(),
    nameWithOwner,
    port,
    transport,
  };
}

function remoteMatchesRepository(
  remote: RemoteRepository,
  repository: RepositoryTarget,
  repositorySsh: RemoteRepository | null
): boolean {
  if (remote.nameWithOwner.toLowerCase() !== repository.nameWithOwner.toLowerCase()) return false;
  if (remote.transport === 'http') return remote.host === repository.apiHost;
  if (remote.transport === 'ssh') {
    if (!repositorySsh || repositorySsh.transport !== 'ssh') return false;
    return (
      remote.hostname === repositorySsh.hostname &&
      (remote.port || '22') === (repositorySsh.port || '22')
    );
  }
  return remote.host === repository.apiHost;
}

interface PushDestination {
  label: string;
  url: string;
}

async function resolvePushDestination(
  repository: RepositoryTarget,
  sshUrl: string
): Promise<PushDestination | null> {
  const result = await execa('git', ['remote', '-v'], {
    reject: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Could not list git remotes.');

  const repositorySsh = parseRemoteRepository(sshUrl);
  const matches = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(push\)$/.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    const parsed = parseRemoteRepository(match[2]);
    if (parsed && remoteMatchesRepository(parsed, repository, repositorySsh)) {
      matches.set(match[2], match[1]);
    }
  }

  if (matches.size === 1) {
    const [url, name] = [...matches.entries()][0] ?? [];
    if (url && name) return { label: `${name} push URL`, url };
  }
  return null;
}

function sanitizeDestinationError(text: string, destination: PushDestination): string {
  return text.split(destination.url).join(destination.label);
}

async function inspectRemoteHead(
  destination: PushDestination,
  branch: string
): Promise<string | null> {
  const result = await execa(
    'git',
    ['ls-remote', '--heads', destination.url, `refs/heads/${branch}`],
    {
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  ).catch((error: unknown) => {
    throw new Error(sanitizeDestinationError(errorText(error), destination));
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || `Could not inspect ${destination.label}/${branch}.`;
    throw new Error(sanitizeDestinationError(message, destination));
  }
  return result.stdout.trim().split(/\s+/)[0] || null;
}

async function inspectRelatedPrs(
  repository: RepositoryTarget,
  role: '--head' | '--base',
  branch: string
): Promise<z.infer<typeof relatedPrsSchema>> {
  const result = await execa(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      repository.selector,
      '--state',
      'open',
      role,
      branch,
      '--limit',
      '100',
      '--json',
      'headRepository,number,url',
    ],
    { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Could not inspect open PRs using ${branch}.`);
  }
  const prs = relatedPrsSchema.parse(JSON.parse(result.stdout));
  if (role === '--base') return prs;
  return prs.filter(
    (candidate) =>
      candidate.headRepository?.nameWithOwner.toLowerCase() ===
      repository.nameWithOwner.toLowerCase()
  );
}

async function cleanRemoteBranch(
  pr: PrInfo,
  repository: RepositoryTarget
): Promise<BranchCleanupResult> {
  const pending = pendingCleanup(pr, true);
  if (pending.status !== 'deferred' || pr.state !== 'MERGED') return pending;

  try {
    const settings = await inspectRepositorySettings(repository.selector);
    const destination = await resolvePushDestination(repository, settings.sshUrl);
    if (!destination) {
      return {
        requested: true,
        status: 'failed',
        reason: `No unambiguous push remote matches ${repository.selector}.`,
      };
    }

    const currentHead = await inspectRemoteHead(destination, pr.headRefName);
    if (currentHead === null) return { requested: true, status: 'already_deleted' };
    if (currentHead !== pr.headRefOid) {
      return {
        requested: true,
        status: 'refused',
        reason: `Remote branch advanced from ${pr.headRefOid} to ${currentHead}.`,
      };
    }

    const [headPrs, basePrs] = await Promise.all([
      inspectRelatedPrs(repository, '--head', pr.headRefName),
      inspectRelatedPrs(repository, '--base', pr.headRefName),
    ]);
    const related = headPrs[0] ?? basePrs[0];
    if (related) {
      return {
        requested: true,
        status: 'refused',
        reason: `Remote branch is still used by open PR #${related.number}: ${related.url}`,
      };
    }

    const branchRef = `refs/heads/${pr.headRefName}`;
    const cleanup = await execa(
      'git',
      [
        'push',
        `--force-with-lease=${branchRef}:${pr.headRefOid}`,
        destination.url,
        `:${branchRef}`,
      ],
      { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
    ).catch((error: unknown) => {
      throw new Error(sanitizeDestinationError(errorText(error), destination));
    });
    if (cleanup.exitCode !== 0) {
      return {
        requested: true,
        status: 'failed',
        reason: cleanup.stderr.trim()
          ? sanitizeDestinationError(cleanup.stderr.trim(), destination)
          : 'Remote cleanup failed.',
      };
    }

    const remainingHead = await inspectRemoteHead(destination, pr.headRefName);
    if (remainingHead === null) return { requested: true, status: 'completed' };
    return {
      requested: true,
      status: 'failed',
      reason: `Remote branch still points to ${remainingHead} after cleanup.`,
    };
  } catch (error) {
    return { requested: true, status: 'failed', reason: errorText(error) };
  }
}

function resultWithCleanupOutcome(result: GhPrMergeResult): Result<GhPrMergeResult> {
  const cleanup = result.branchCleanup;
  if (cleanup.status !== 'failed' && cleanup.status !== 'refused') return success(result);

  return failure(
    new CommandError(
      `PR #${result.number} is merged, but remote branch cleanup ${cleanup.status}: ${cleanup.reason ?? 'no reason reported'}`,
      'gh-pr-merge',
      { context: { result } }
    )
  );
}

function buildResult(
  pr: PrInfo,
  action: GhPrMergeResult['action'],
  checks: RequiredChecksSummary,
  branchCleanup: BranchCleanupResult,
  options: GhPrMergeOptions,
  strategy?: MergeStrategy,
  readinessPr: PrInfo = pr
): GhPrMergeResult {
  const result: GhPrMergeResult = {
    action,
    auto: Boolean(options.auto),
    baseRefName: pr.baseRefName,
    branchCleanup,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    number: pr.number,
    readiness: {
      mergeable: readinessPr.mergeable,
      mergeStateStatus: readinessPr.mergeStateStatus,
      requiredChecks: checks,
      reviewDecision: readinessPr.reviewDecision,
    },
    url: pr.url,
  };
  if (strategy) result.strategy = strategy;
  if (pr.mergeCommit?.oid) result.mergeCommit = pr.mergeCommit.oid;
  if (pr.mergedAt) result.mergedAt = pr.mergedAt;
  return result;
}

async function cleanAlreadyMergedPr(
  pr: PrInfo,
  repository: RepositoryTarget,
  options: GhPrMergeOptions
): Promise<Result<GhPrMergeResult>> {
  if (!options.deleteRemoteBranch) {
    return success(
      buildResult(
        pr,
        'already_merged',
        emptyChecks(),
        { requested: false, status: 'not_requested' },
        options
      )
    );
  }
  const pending = pendingCleanup(pr, true);
  if (pending.status === 'skipped') {
    return success(buildResult(pr, 'already_merged', emptyChecks(), pending, options));
  }
  if (!(await confirmMutation(`Delete remote branch ${pr.headRefName} for PR #${pr.number}?`))) {
    return failure(new CommandError('Remote branch cleanup canceled', 'gh-pr-merge'));
  }

  return resultWithCleanupOutcome(
    buildResult(
      pr,
      'already_merged',
      emptyChecks(),
      await cleanRemoteBranch(pr, repository),
      options
    )
  );
}

export async function executeGhPrMerge(
  target: string | undefined,
  options: GhPrMergeOptions
): Promise<Result<GhPrMergeResult>> {
  try {
    if (!(await isGhInstalled())) {
      return failure(
        new CommandError('GitHub CLI (gh) is not installed', 'gh-pr-merge', {
          suggestions: ['Install GitHub CLI: https://cli.github.com/'],
        })
      );
    }

    const before = await inspectPr(target);
    const repository = repositoryFromPrUrl(before.url);
    if (before.state === 'MERGED') return cleanAlreadyMergedPr(before, repository, options);

    const [requiredChecks, queueBefore] = await Promise.all([
      inspectRequiredChecks(before.number, repository.selector),
      inspectMergeQueue(before, repository),
    ]);
    const checks = summarizeChecks(requiredChecks);
    if (queueBefore?.isInMergeQueue) {
      return success(
        buildResult(
          before,
          'queued',
          checks,
          pendingCleanup(before, Boolean(options.deleteRemoteBranch)),
          options
        )
      );
    }

    const queueEnabled = queueBefore.isMergeQueueEnabled;
    const issues = readinessIssues(before, checks);
    if (issues.hard.length > 0) {
      return failure(
        new CommandError(
          `PR #${before.number} cannot be merged: ${issues.hard.join('; ')}`,
          'gh-pr-merge'
        )
      );
    }
    if (issues.requirements.length > 0 && !options.auto && !queueEnabled) {
      return failure(
        new CommandError(
          `PR #${before.number} is not ready: ${issues.requirements.join('; ')}`,
          'gh-pr-merge',
          { suggestions: ['Use --auto to wait for merge requirements.'] }
        )
      );
    }

    if (before.autoMergeRequest) {
      const currentStrategyResult = mergeStrategySchema.safeParse(
        before.autoMergeRequest.mergeMethod.toLowerCase()
      );
      if (!currentStrategyResult.success) {
        return failure(
          new CommandError('GitHub reported an unsupported auto-merge strategy', 'gh-pr-merge')
        );
      }
      const currentStrategy = currentStrategyResult.data;
      if (
        !options.auto ||
        (options.strategy !== undefined && currentStrategy !== options.strategy)
      ) {
        return failure(
          new CommandError(
            `Auto-merge is already enabled via ${currentStrategy}; Neo will not change it implicitly`,
            'gh-pr-merge'
          )
        );
      }
      return success(
        buildResult(
          before,
          'auto_merge_enabled',
          checks,
          pendingCleanup(before, Boolean(options.deleteRemoteBranch)),
          options,
          currentStrategy
        )
      );
    }

    if (!before.isCrossRepository) {
      const [basePrs, headPrs] = await Promise.all([
        inspectRelatedPrs(repository, '--base', before.headRefName),
        inspectRelatedPrs(repository, '--head', before.headRefName),
      ]);
      const dependentPr = basePrs[0] ?? headPrs.find(({ number }) => number !== before.number);
      if (dependentPr && options.deleteRemoteBranch) {
        return failure(
          new CommandError(
            `Remote branch ${before.headRefName} is still used by open PR #${dependentPr.number}; Neo will not merge while cleanup is requested`,
            'gh-pr-merge'
          )
        );
      }
      if (
        dependentPr &&
        (await inspectRepositorySettings(repository.selector)).deleteBranchOnMerge
      ) {
        return failure(
          new CommandError(
            `PR #${before.number} cannot be merged safely because ${before.headRefName} is still used by open PR #${dependentPr.number} and the repository deletes merged branches automatically`,
            'gh-pr-merge'
          )
        );
      }
    }

    if (queueEnabled && options.strategy) {
      return failure(
        new CommandError(
          `The merge queue controls the strategy for ${before.baseRefName}; retry without --strategy`,
          'gh-pr-merge'
        )
      );
    }

    const strategy = queueEnabled ? undefined : await resolveStrategy(options);

    if (
      !(await confirmMutation(
        `${queueEnabled ? 'Submit' : options.auto ? 'Enable auto-merge for' : 'Merge'} PR #${before.number} (${before.headRefName} into ${before.baseRefName})${strategy ? ` via ${strategy}` : ' to the merge queue'}${options.deleteRemoteBranch ? ' and request remote cleanup after merge' : ''}?`
      ))
    ) {
      return failure(new CommandError('PR merge canceled', 'gh-pr-merge'));
    }

    const mergeArgs = ['pr', 'merge', String(before.number), '--repo', repository.selector];
    if (strategy) mergeArgs.push(`--${strategy}`);
    mergeArgs.push('--match-head-commit', before.headRefOid);
    if (options.auto && !queueEnabled) mergeArgs.push('--auto');

    const mergeRequest = await execa('gh', mergeArgs, {
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let after: PrInfo;
    try {
      after = await inspectPostflight(before.number, repository.selector);
    } catch {
      return failure(
        new CommandError(
          'GitHub accepted the merge command, but Neo could not confirm the outcome',
          'gh-pr-merge',
          {
            context: {
              ghExitCode: mergeRequest.exitCode,
              ghError: mergeRequest.stderr.trim(),
              number: before.number,
              url: before.url,
            },
          }
        )
      );
    }

    const headMatches = after.headRefOid === before.headRefOid;
    const merged = after.state === 'MERGED' && headMatches;
    const autoMergeEnabled =
      after.autoMergeRequest !== null &&
      headMatches &&
      (strategy === undefined ||
        after.autoMergeRequest.mergeMethod.toLowerCase() === strategy.toLowerCase());
    const queueAfter =
      merged || autoMergeEnabled ? null : await inspectMergeQueue(after, repository);
    const queued = queueAfter?.isInMergeQueue === true && headMatches;
    const submitted = mergeRequest.exitCode === 0 && queueEnabled && headMatches;
    const accepted = merged || autoMergeEnabled || queued || submitted;
    if (!accepted) {
      const detail = mergeRequest.stderr.trim();
      return failure(
        new CommandError(
          mergeRequest.exitCode === 0
            ? `GitHub accepted the merge command, but Neo could not confirm a merge, auto-merge, or queue entry for PR #${before.number}`
            : `Failed to merge PR #${before.number}: ${detail || 'GitHub did not accept the merge'}`,
          'gh-pr-merge',
          {
            context: { exitCode: mergeRequest.exitCode, number: before.number, url: before.url },
          }
        )
      );
    }

    const action: GhPrMergeResult['action'] = merged
      ? 'merged'
      : autoMergeEnabled
        ? 'auto_merge_enabled'
        : queued
          ? 'queued'
          : 'submitted';
    const confirmed = {
      ...after,
      headRefName: before.headRefName,
      headRefOid: before.headRefOid,
    };
    const cleanup = options.deleteRemoteBranch
      ? await cleanRemoteBranch(confirmed, repository)
      : pendingCleanup(confirmed, false);
    const confirmedStrategy =
      action === 'merged' && mergeRequest.exitCode !== 0 ? undefined : strategy;
    return resultWithCleanupOutcome(
      buildResult(confirmed, action, checks, cleanup, options, confirmedStrategy, before)
    );
  } catch (error) {
    if (error instanceof NonInteractiveError) throw error;
    if (error instanceof CommandError) return failure(error);
    const detail = errorText(error);
    if (/authentication|not logged|auth login|http 401/i.test(detail)) {
      return failure(
        new CommandError('Not authenticated with GitHub CLI for the target host', 'gh-pr-merge', {
          suggestions: ['Run: gh auth login'],
        })
      );
    }
    return failure(new CommandError(`Could not merge the pull request: ${detail}`, 'gh-pr-merge'));
  }
}

export function createPrMergeCommand(): Command {
  const command = new Command('merge');

  command
    .description('Merge a pull request with readiness guardrails')
    .argument('[pull-request]', 'pull request number, URL, or branch (default: current branch)')
    .option('--strategy <method>', 'merge method: merge, squash, or rebase')
    .option('--auto', 'merge after GitHub requirements pass')
    .option(
      '-d, --delete-remote-branch',
      'delete the remote head branch after merge (local cleanup stays with neo work finish)'
    )
    .addHelpText(
      'after',
      `
Examples:
  Merge a ready PR:
    $ neo gh pr merge 88 --strategy squash

  Arm auto-merge and emit JSON:
    $ neo gh pr merge 88 --strategy squash --auto --yes --json

  Request remote branch cleanup after a confirmed merge:
    $ neo gh pr merge 88 --strategy squash --delete-remote-branch
`
    )
    .action(
      runAction(async (target: string | undefined, rawOptions: unknown) => {
        const options: GhPrMergeOptions = validate(
          ghPrMergeOptionsSchema,
          rawOptions,
          'gh pr merge options'
        );
        const result = await executeGhPrMerge(target, options);
        if (isFailure(result)) throw result.error;

        emitJson(
          { ok: true, command: 'gh.pr.merge', ...result.data },
          {
            text: () => {
              const verbs: Record<GhPrMergeResult['action'], string> = {
                already_merged: 'Already merged',
                auto_merge_enabled: 'Auto-merge enabled for',
                merged: 'Merged',
                queued: 'Queued',
                submitted: 'Submitted',
              };
              const verb = verbs[result.data.action];
              ui.success(`${verb} PR #${result.data.number}`);
              ui.muted(`${result.data.headRefName} into ${result.data.baseRefName}`);
              if (result.data.branchCleanup.status === 'completed') {
                ui.success(`Deleted remote branch ${result.data.headRefName}`);
              } else if (result.data.branchCleanup.status === 'already_deleted') {
                ui.muted(`Remote branch ${result.data.headRefName} was already deleted`);
              } else if (
                result.data.branchCleanup.requested &&
                result.data.branchCleanup.status !== 'not_requested'
              ) {
                ui.warn(
                  `Remote cleanup ${result.data.branchCleanup.status}: ${result.data.branchCleanup.reason ?? 'no reason reported'}`
                );
              }
            },
          }
        );
      })
    );

  return command;
}
