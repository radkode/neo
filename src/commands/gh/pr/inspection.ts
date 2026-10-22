import { execa } from 'execa';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

/**
 * Read-only pull request inspection shared by `neo gh pr status` and `neo gh pr merge`.
 * Everything here shells out to `gh` and never mutates the pull request.
 */

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

const checksSchema = z.array(
  z.object({
    bucket: z.string(),
    link: z.string(),
    name: z.string(),
    state: z.string(),
    workflow: z.string().optional(),
  })
);

const reviewThreadsSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          totalCount: z.number(),
          nodes: z.array(
            z.object({
              isOutdated: z.boolean(),
              isResolved: z.boolean(),
              line: z.number().nullable(),
              path: z.string(),
              comments: z.object({
                nodes: z.array(
                  z.object({
                    author: z.object({ login: z.string() }).nullable(),
                    url: z.string(),
                  })
                ),
              }),
            })
          ),
        }),
      }),
    }),
  }),
});

export type PrInfo = z.infer<typeof prInfoSchema>;
export type PrCheck = z.infer<typeof checksSchema>[number];

export interface RequiredChecksSummary {
  failed: string[];
  passed: string[];
  pending: string[];
}

export interface RepositoryTarget {
  apiHost: string;
  nameWithOwner: string;
  selector: string;
}

export interface UnresolvedReviewThread {
  author: string | null;
  isOutdated: boolean;
  line: number | null;
  path: string;
  url: string | null;
}

export interface UnresolvedReviewThreads {
  /** Unresolved threads among the first 100 GitHub returned. */
  threads: UnresolvedReviewThread[];
  /** True when the PR has more threads than one page covers, so the list may be incomplete. */
  truncated: boolean;
}

const REVIEW_THREAD_PAGE = 100;

export async function isGhInstalled(): Promise<boolean> {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = Reflect.get(error, 'stderr');
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/** True when gh failed because it has no usable credentials for the host. */
export function isGhAuthError(detail: string): boolean {
  return /authentication|not logged|auth login|http 401/i.test(detail);
}

export async function inspectPr(target?: string, repository?: string): Promise<PrInfo> {
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

export function repositoryFromPrUrl(url: string): RepositoryTarget {
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

/**
 * Lists the PR's checks. `required` limits the list to checks branch protection requires.
 * A PR with no checks reported returns an empty list rather than failing.
 */
export async function inspectChecks(
  number: number,
  repository: string,
  { required }: { required: boolean }
): Promise<PrCheck[]> {
  const args = ['pr', 'checks', String(number), '--repo', repository];
  if (required) args.push('--required');
  args.push('--json', required ? 'name,state,bucket,link' : 'name,state,bucket,link,workflow');
  const result = await execa('gh', args, { reject: false, stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.stdout.trim()) return checksSchema.parse(JSON.parse(result.stdout));
  const stderr = result.stderr.toLowerCase();
  if (
    result.exitCode === 0 ||
    stderr.includes('no checks reported on') ||
    stderr.includes('no required checks reported')
  ) {
    return [];
  }
  throw new Error(
    `Could not inspect ${required ? 'required ' : ''}checks: ${result.stderr.trim()}`
  );
}

export function summarizeChecks(checks: PrCheck[]): RequiredChecksSummary {
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

export function readinessIssues(
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

export async function inspectUnresolvedReviewThreads(
  pr: PrInfo,
  repository: RepositoryTarget
): Promise<UnresolvedReviewThreads> {
  const [owner, name] = repository.nameWithOwner.split('/');
  const query = `query PullRequestReviewThreads($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: ${REVIEW_THREAD_PAGE}) { totalCount nodes { isResolved isOutdated path line comments(first: 1) { nodes { author { login } url } } } } } } }`;
  const result = await execa(
    'gh',
    [
      'api',
      'graphql',
      '--hostname',
      repository.apiHost,
      '-f',
      `query=${query}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${pr.number}`,
    ],
    { reject: false, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `Could not inspect review threads for PR #${pr.number}.`
    );
  }

  let reviewThreads: z.infer<
    typeof reviewThreadsSchema
  >['data']['repository']['pullRequest']['reviewThreads'];
  try {
    reviewThreads = reviewThreadsSchema.parse(JSON.parse(result.stdout)).data.repository.pullRequest
      .reviewThreads;
  } catch (error) {
    throw new Error(
      `Could not parse the review threads for PR #${pr.number}: ${errorText(error)}`,
      { cause: error }
    );
  }

  return {
    threads: reviewThreads.nodes
      .filter((thread) => !thread.isResolved)
      .map((thread) => {
        const first = thread.comments.nodes[0];
        return {
          author: first?.author?.login ?? null,
          isOutdated: thread.isOutdated,
          line: thread.line,
          path: thread.path,
          url: first?.url ?? null,
        };
      }),
    truncated: reviewThreads.totalCount > reviewThreads.nodes.length,
  };
}
