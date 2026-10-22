import { execa } from 'execa';

/**
 * Works out which remote branches a `git push` will change, before it runs, so the
 * protected-branch guard can judge the push by where it lands rather than by the branch
 * that happens to be checked out.
 */

export interface PushDestination {
  action: 'update' | 'delete';
  /** Remote branch name, without `refs/heads/`. */
  branch: string;
  force: boolean;
  protected: boolean;
  /** Local ref the update comes from, as written (`feature`, `HEAD`); null for a deletion. */
  source: string | null;
}

export interface PushPlan {
  /** The remote's default branch per `<remote>/HEAD`, or null when that is not recorded. */
  defaultBranch: string | null;
  destinations: PushDestination[];
  protectedBranches: string[];
  remote: string;
  /** Why neo cannot tell every branch the push changes (e.g. `--mirror`); null when it can. */
  unresolved: string | null;
}

/**
 * How much authorization a push needs:
 * - none: it changes no protected branch
 * - standing: it fast-forwards a protected branch, which `neo.allowMainPush` may allow
 * - explicit: it force-pushes, deletes, or cannot be resolved, which needs --allow-main or a
 *   confirmation every time
 */
export type GuardLevel = 'none' | 'standing' | 'explicit';

export interface GuardDecision {
  /** What the push would do to protected branches, e.g. `Pushing to main`. */
  actions: string[];
  level: GuardLevel;
}

/** Flags that push refs neo does not enumerate, so the destinations stay unknown. */
const UNRESOLVED_FLAGS = new Set(['--all', '--branches', '--mirror', '--prune']);
/** Push flags whose value is the next argument rather than part of the flag. */
export const PUSH_FLAGS_WITH_VALUE = new Set([
  '-o',
  '--push-option',
  '--receive-pack',
  '--exec',
  '--repo',
]);

export function isForceFlag(arg: string): boolean {
  if (/^--force(-with-lease(=.*)?|-if-includes)?$/.test(arg)) return true;
  // Bundled short flags such as -fu.
  return /^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes('f');
}

function isDeleteFlag(arg: string): boolean {
  return arg === '--delete' || (/^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes('d'));
}

/** The remote branch a destination ref names, or null when it is not a branch (a tag, refs/for/…). */
function branchOf(ref: string): string | null {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/')) return null;
  return ref;
}

type Parsed =
  | { kind: 'destination'; destination: Omit<PushDestination, 'protected'> }
  | { kind: 'skip' }
  | { kind: 'unresolved'; reason: string };

function parseRefspec(
  spec: string,
  {
    deleteAll,
    forceAll,
    currentBranch,
  }: { deleteAll: boolean; forceAll: boolean; currentBranch: string }
): Parsed {
  const force = forceAll || spec.startsWith('+');
  const body = spec.replace(/^\+/, '');
  if (body.includes('*')) return { kind: 'unresolved', reason: `the wildcard refspec ${spec}` };

  if (deleteAll || body.startsWith(':')) {
    const branch = branchOf(deleteAll ? body : body.slice(1));
    return branch
      ? { kind: 'destination', destination: { action: 'delete', branch, force, source: null } }
      : { kind: 'skip' };
  }

  const colon = body.indexOf(':');
  const source = colon === -1 ? body : body.slice(0, colon);
  let target = colon === -1 ? null : body.slice(colon + 1);
  if (target === null) {
    if (source === 'HEAD' || source === '@') {
      if (!currentBranch) return { kind: 'unresolved', reason: 'HEAD while it is detached' };
      target = currentBranch;
    } else if (/^[0-9a-f]{7,40}$/i.test(source)) {
      return { kind: 'unresolved', reason: `the commit ${source} without a destination` };
    } else {
      target = source;
    }
  }

  const branch = branchOf(target);
  return branch
    ? { kind: 'destination', destination: { action: 'update', branch, force, source } }
    : { kind: 'skip' };
}

export async function remoteDefaultBranch(remote: string): Promise<string | null> {
  const head = await execa(
    'git',
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
    {
      reject: false,
      stdio: 'pipe',
    }
  );
  const resolved = head.exitCode === 0 ? head.stdout.trim() : '';
  const prefix = `${remote}/`;
  return resolved.startsWith(prefix) ? resolved.slice(prefix.length) || null : null;
}

/** Whether the remote maps pushed branches through `remote.<name>.push`, which neo does not model. */
async function hasPushMapping(remote: string): Promise<boolean> {
  const result = await execa('git', ['config', '--get-all', `remote.${remote}.push`], {
    reject: false,
    stdio: 'pipe',
  });
  return result.exitCode === 0 && result.stdout.trim() !== '';
}

/** True when this checkout opted in to fast-forward pushes of protected branches without a prompt. */
export async function allowsMainPush(): Promise<boolean> {
  const result = await execa('git', ['config', '--type=bool', '--get', 'neo.allowMainPush'], {
    reject: false,
    stdio: 'pipe',
  });
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

export async function planPush({
  currentBranch,
  passthrough,
  refspecs,
  remote,
}: {
  currentBranch: string;
  passthrough: string[];
  refspecs: string[];
  remote: string;
}): Promise<PushPlan> {
  const deleteAll = passthrough.some(isDeleteFlag);
  const forceAll = passthrough.some(isForceFlag);
  let unresolved =
    passthrough.find(
      (arg) => UNRESOLVED_FLAGS.has(arg) || arg === '--repo' || arg.startsWith('--repo=')
    ) ?? null;
  if (unresolved) unresolved = unresolved.split('=')[0] ?? unresolved;
  if (!unresolved && refspecs.length === 0) unresolved = 'no refspec, so push.default decides';

  const destinations: Omit<PushDestination, 'protected'>[] = [];
  let loneSource = false;
  for (const spec of unresolved ? [] : refspecs) {
    const parsed = parseRefspec(spec, { currentBranch, deleteAll, forceAll });
    if (parsed.kind === 'unresolved') {
      unresolved = parsed.reason;
      break;
    }
    if (parsed.kind === 'destination') {
      destinations.push(parsed.destination);
      if (!deleteAll && !spec.replace(/^\+/, '').includes(':')) loneSource = true;
    }
  }
  if (!unresolved && loneSource && (await hasPushMapping(remote))) {
    unresolved = `remote.${remote}.push, which can map branches elsewhere`;
  }

  const defaultBranch = await remoteDefaultBranch(remote);
  const protectedBranches = [
    ...new Set(['main', 'master', ...(defaultBranch ? [defaultBranch] : [])]),
  ];
  return {
    defaultBranch,
    destinations: destinations.map((destination) => ({
      ...destination,
      protected: protectedBranches.includes(destination.branch),
    })),
    protectedBranches,
    remote,
    unresolved,
  };
}

export function guardFor(plan: PushPlan): GuardDecision {
  if (plan.unresolved) {
    return { actions: [`Pushing with ${plan.unresolved}`], level: 'explicit' };
  }
  const hits = plan.destinations.filter((destination) => destination.protected);
  if (hits.length === 0) return { actions: [], level: 'none' };

  const actions = [
    ...new Set(
      hits.map(({ action, branch, force }) =>
        action === 'delete'
          ? `Deleting ${branch}`
          : force
            ? `Force-pushing ${branch}`
            : `Pushing to ${branch}`
      )
    ),
  ];
  const explicit = hits.some(({ action, force }) => action === 'delete' || force);
  return { actions, level: explicit ? 'explicit' : 'standing' };
}
