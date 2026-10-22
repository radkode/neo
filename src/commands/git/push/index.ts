import { Command, Option } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { confirm } from '@inquirer/prompts';
import { logger } from '@/utils/logger.js';
import { promptSelect, NonInteractiveError } from '@/utils/prompt.js';
import { ui } from '@/utils/ui.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { validate } from '@/utils/validation.js';
import { gitPushOptionsSchema, type GitPushOptions } from '@/types/schemas.js';
import { type Result, success, failure, isFailure } from '@/core/errors/index.js';
import {
  GitErrors,
  isNotGitRepository,
  isNoUpstreamError,
  isNonFastForwardError,
  isAuthenticationError,
  isConflictError,
  isPermissionDeniedError,
} from '@/utils/git-errors.js';
import {
  allowsMainPush,
  guardFor,
  isForceFlag,
  planPush,
  PUSH_FLAGS_WITH_VALUE,
  type GuardDecision,
  type PushPlan,
} from '@/commands/git/push/destinations.js';

/** Push options that make `--set-upstream` redundant or meaningless. */
const NO_AUTO_UPSTREAM = new Set([
  '-u',
  '--set-upstream',
  '-d',
  '--delete',
  '--mirror',
  '--all',
  '--branches',
  '--prune',
  '-n',
  '--dry-run',
]);

interface UpstreamChange {
  /** The upstream being replaced, e.g. `origin/main`, or null when the branch had none. */
  replaces: string | null;
}

/**
 * Decides whether neo should add `--set-upstream` when pushing the current branch to its
 * same-named remote branch: when the branch has no upstream yet, as `git push -u` would, or
 * when it still tracks the remote's default branch (inherited from `git checkout -b x
 * origin/main`). Any other upstream is left alone: a different remote is a fork workflow,
 * and another feature branch is a stack.
 */
async function upstreamChange(
  branchName: string,
  remoteName: string,
  targetBranch: string,
  passthrough: string[],
  defaultBranch: string | null
): Promise<UpstreamChange | null> {
  if (!branchName || targetBranch !== branchName) return null;
  if (passthrough.some((arg) => NO_AUTO_UPSTREAM.has(arg))) return null;

  const tracking = await execa(
    'git',
    [
      'for-each-ref',
      '--format=%(upstream:remotename)%00%(upstream:remoteref)',
      `refs/heads/${branchName}`,
    ],
    { reject: false, stdio: 'pipe' }
  );
  const [upstreamRemote = '', upstreamRef = ''] = tracking.stdout.trim().split('\0');
  if (!upstreamRef) return { replaces: null };

  const upstreamBranch = upstreamRef.replace(/^refs\/heads\//, '');
  if (upstreamBranch === targetBranch || upstreamRemote !== remoteName) return null;
  const isDefault = defaultBranch
    ? upstreamBranch === defaultBranch
    : upstreamBranch === 'main' || upstreamBranch === 'master';
  if (!isDefault) return null;
  return { replaces: `${upstreamRemote}/${upstreamBranch}` };
}

function setsUpstream(passthrough: string[]): boolean {
  return passthrough.includes('-u') || passthrough.includes('--set-upstream');
}

interface PushOptions {
  dryRun?: boolean | undefined;
  passthrough: string[];
  remote?: string | undefined;
  /** Refspecs after the remote; empty pushes the current branch to its same-named branch. */
  refspecs: string[];
  /** Authorize changing protected branches, including force-pushes and deletions. */
  allowMain?: boolean | undefined;
  /** Resolution strategy when push is rejected non-fast-forward. */
  onReject?: 'pull-rebase' | 'force' | 'cancel' | undefined;
}

function sentence(actions: string[]): string {
  return actions.join(' and ');
}

/**
 * Asks for authorization to change protected branches. Resolves to how it was granted, or
 * 'cancelled' when the user declined. Throws NonInteractiveError when it cannot ask.
 */
async function authorizeProtectedPush(
  guard: GuardDecision,
  options: PushOptions
): Promise<'explicit' | 'standing' | 'cancelled'> {
  const summary = sentence(guard.actions);
  if (options.allowMain) {
    ui.step(`${summary} (authorized by --allow-main)`);
    return 'explicit';
  }
  if (guard.level === 'standing' && (await allowsMainPush())) {
    ui.step(`${summary} (allowed by neo.allowMainPush)`);
    return 'standing';
  }

  ui.warn(`${summary}: this changes a protected branch directly`);
  ui.muted('This is generally not recommended as it bypasses code review processes');

  const rtCtx = getRuntimeContext();
  if (rtCtx.nonInteractive || rtCtx.yes) {
    // Protected-branch changes are destructive — require explicit --allow-main in
    // non-interactive mode rather than quietly proceeding.
    const standingHint =
      guard.level === 'standing'
        ? ' (or run `git config neo.allowMainPush true` in this repo)'
        : '';
    throw new NonInteractiveError(
      `${summary} requires explicit confirmation${standingHint}`,
      '--allow-main'
    );
  }

  const confirmed = await confirm({
    message: 'Are you sure you want to continue?',
    default: false,
  });
  if (!confirmed) {
    ui.success("Push cancelled. Here's how to push your changes safely:");
    ui.list([
      'Create a feature branch: git checkout -b feature/your-feature-name',
      'Push to your branch: git push -u origin feature/your-feature-name',
      'Create a pull request to merge into main',
    ]);
    ui.muted('This protects the main branch from accidental changes');
    return 'cancelled';
  }
  ui.step(`Proceeding: ${summary}`);
  return 'explicit';
}

async function commitsToPush(
  remote: string,
  branch: string,
  source: string
): Promise<string[] | null> {
  const result = await execa('git', ['log', '--oneline', `${remote}/${branch}..${source}`], {
    reject: false,
    stdio: 'pipe',
  });
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() ? result.stdout.trim().split('\n') : [];
}

/** Reports what the push would change without running it or asking for authorization. */
async function reportDryRun(
  plan: PushPlan,
  guard: GuardDecision,
  options: PushOptions
): Promise<Result<void>> {
  const destinations = await Promise.all(
    plan.destinations.map(async (destination) => ({
      ...destination,
      commits:
        destination.action === 'update' && destination.source
          ? await commitsToPush(plan.remote, destination.branch, destination.source)
          : null,
    }))
  );
  const authorization =
    guard.level === 'none' || options.allowMain
      ? null
      : guard.level === 'standing' && (await allowsMainPush())
        ? null
        : guard.level === 'standing'
          ? '--allow-main, a confirmation, or neo.allowMainPush'
          : '--allow-main or a confirmation';

  emitJson(
    {
      ok: true,
      command: 'git.push',
      dryRun: true,
      remote: plan.remote,
      destinations,
      unresolved: plan.unresolved,
      authorizationRequired: authorization,
    },
    {
      text: () => {
        ui.warn('Dry run mode - no changes will be pushed');
        if (plan.unresolved) ui.warn(`Neo cannot tell which branches ${plan.unresolved} changes`);
        for (const destination of destinations) {
          const target = `${plan.remote}/${destination.branch}`;
          const verb =
            destination.action === 'delete' ? 'delete' : destination.force ? 'force-push' : 'push';
          ui.info(
            `Would ${verb} ${target}${destination.source ? ` from ${destination.source}` : ''}${destination.protected ? ' (protected)' : ''}`
          );
          if (destination.commits === null && destination.action === 'update') {
            ui.muted(`  ${target} is not fetched here, so the commits to push are unknown`);
          } else if (destination.commits && destination.commits.length > 0) {
            ui.list(destination.commits);
          } else if (destination.commits) {
            ui.muted('  No new commits to push');
          }
        }
        if (authorization) ui.warn(`A real push would need ${authorization}`);
      },
    }
  );
  return success(undefined);
}

type Recovery = 'pull-rebase' | 'force';

/** What a successful push needs to report, whichever attempt succeeded. */
interface PushReport {
  change: UpstreamChange | null;
  plan: PushPlan;
  remote: string;
  soleRefspec: string;
}

/** Reports a push that went through. Every success path ends here, so --json always gets one envelope. */
function reportPushed(
  report: PushReport,
  options: PushOptions,
  recovery: Recovery | null
): Result<void> {
  const upstream = setsUpstream(options.passthrough)
    ? `${report.remote}/${report.soleRefspec}`
    : null;
  if (upstream) {
    ui.info(
      `Set upstream branch: ${upstream}${report.change?.replaces ? ` (was ${report.change.replaces})` : ''}`
    );
  }
  emitJson({
    ok: true,
    command: 'git.push',
    remote: report.remote,
    branch: report.soleRefspec || null,
    destinations: report.plan.destinations,
    recovery,
    upstream,
    replacedUpstream: report.change?.replaces ?? null,
  });
  return success(undefined);
}

/**
 * Execute the push command logic
 * Returns a Result indicating success or failure
 */
export async function executePush(options: PushOptions): Promise<Result<void>> {
  let branchName: string = '';
  const spinner = ui.spinner('Pushing to remote');
  let pushArgs: string[] = [];
  let guard: GuardDecision = { actions: [], level: 'none' };
  /** Whether --allow-main or a confirmation, not just neo.allowMainPush, authorized the push. */
  let explicitlyAuthorized = false;
  let report: PushReport | undefined;

  try {
    const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
    branchName = currentBranch.trim();

    logger.debug(`Current branch: ${branchName}`);

    const remoteName = options.remote || 'origin';
    const refspecs =
      options.refspecs.length > 0 ? options.refspecs : branchName ? [branchName] : [];

    logger.debug(`Remote: ${remoteName}`);
    logger.debug(`Refspecs: ${refspecs.join(' ')}`);
    logger.debug(`Dry run: ${options.dryRun || false}`);
    logger.debug(`Passthrough args: ${options.passthrough.join(' ')}`);

    const plan = await planPush({
      currentBranch: branchName,
      passthrough: options.passthrough,
      refspecs,
      remote: remoteName,
    });
    guard = guardFor(plan);

    if (options.dryRun) {
      return await reportDryRun(plan, guard, options);
    }

    if (guard.level !== 'none') {
      const authorization = await authorizeProtectedPush(guard, options);
      if (authorization === 'cancelled') return success(undefined);
      explicitlyAuthorized = authorization === 'explicit';
    }

    const soleRefspec = refspecs.length === 1 ? (refspecs[0] ?? '') : '';
    const change = await upstreamChange(
      branchName,
      remoteName,
      soleRefspec,
      options.passthrough,
      plan.defaultBranch
    );
    if (change) {
      options = { ...options, passthrough: ['--set-upstream', ...options.passthrough] };
    }
    report = { change, plan, remote: remoteName, soleRefspec };

    spinner.start();

    // Build push args: git push [passthrough options] remote refspecs...
    pushArgs = ['push', ...options.passthrough, remoteName, ...refspecs];

    logger.debug(`Executing: git ${pushArgs.join(' ')}`);

    const pushResult = await execa('git', pushArgs, {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    spinner.succeed('Successfully pushed to remote!');

    if (pushResult.stdout) {
      ui.muted(pushResult.stdout);
    }

    return reportPushed(report, options, null);
  } catch (error: unknown) {
    spinner.stop();

    // NonInteractiveError is a contract signal — let runAction handle it
    // (exit code 2, structured JSON) rather than masking as a generic git error.
    if (error instanceof NonInteractiveError) {
      throw error;
    }

    // Use shared git error detection
    if (isNotGitRepository(error)) {
      return failure(GitErrors.notARepository('push', error));
    }

    if (isNoUpstreamError(error)) {
      return failure(GitErrors.noUpstream('push', branchName, error));
    }

    if (isNonFastForwardError(error) && report) {
      // Not the outcome yet: neo is about to resolve it, and reports the result once.
      ui.warn('Push was rejected because the remote has new commits.');
      if (!options.onReject) ui.warn('Choose how to resolve the divergence:');

      const resolution: 'pull-rebase' | 'force' | 'cancel' = options.onReject
        ? options.onReject
        : await promptSelect({
            choices: [
              { label: 'Pull with rebase and retry push', value: 'pull-rebase' as const },
              { label: 'Force push (overwrite remote)', value: 'force' as const },
              { label: 'Cancel for now', value: 'cancel' as const },
            ],
            defaultValue: 'pull-rebase',
            message: 'Select a resolution strategy',
            flag: '--on-reject <pull-rebase|force|cancel>',
          });

      if (resolution === 'pull-rebase') {
        return handlePullRebase(branchName, pushArgs, options, report);
      }

      if (resolution === 'force') {
        // A standing neo.allowMainPush covers fast-forwards only; overwriting a protected
        // branch needs its own authorization.
        if (guard.level !== 'none' && !explicitlyAuthorized) {
          const forceGuard: GuardDecision = {
            actions: guard.actions.map((action) =>
              action.replace(/^Pushing to /, 'Force-pushing ')
            ),
            level: 'explicit',
          };
          if ((await authorizeProtectedPush(forceGuard, options)) === 'cancelled') {
            ui.info('Push cancelled. No changes were pushed.');
            return failure(GitErrors.nonFastForward('push', error));
          }
        }
        return handleForcePush(pushArgs, options, report);
      }

      ui.info('Push cancelled. No changes were pushed.');
      return failure(GitErrors.nonFastForward('push', error));
    }

    if (isPermissionDeniedError(error)) {
      return failure(GitErrors.permissionDenied('push', error));
    }

    if (isAuthenticationError(error)) {
      return failure(GitErrors.authenticationFailed('push', error));
    }

    return failure(GitErrors.unknown('push', error));
  }
}

/**
 * Handle pull with rebase and retry push
 */
async function handlePullRebase(
  branchName: string,
  pushArgs: string[],
  options: PushOptions,
  report: PushReport
): Promise<Result<void>> {
  // Rebase onto the branch the push targets, on the remote it targets.
  const updates = report.plan.destinations.filter(({ action }) => action === 'update');
  const target = updates.length === 1 ? (updates[0]?.branch ?? branchName) : branchName;
  const rebaseSpinner = ui.spinner(`Rebasing onto ${report.remote}/${target || 'HEAD'}`);
  try {
    rebaseSpinner.start();
    await execa('git', ['pull', '--rebase', report.remote, target || 'HEAD']);
    rebaseSpinner.succeed(`Rebased onto ${report.remote}/${target || 'HEAD'}`);
  } catch (rebaseError) {
    rebaseSpinner.stop();
    if (isConflictError(rebaseError)) {
      return failure(GitErrors.rebaseConflict('push', rebaseError));
    }
    return failure(GitErrors.unknown('push', rebaseError));
  }

  const retrySpinner = ui.spinner('Retrying push after rebase');
  try {
    retrySpinner.start();
    const retryResult = await execa('git', pushArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    retrySpinner.succeed("Pushed after rebasing onto the remote's new commits");
    if (retryResult.stdout) {
      ui.muted(retryResult.stdout);
    }
  } catch (retryError) {
    retrySpinner.stop();
    return failure(
      isNonFastForwardError(retryError)
        ? GitErrors.nonFastForward('push', retryError)
        : GitErrors.unknown('push', retryError)
    );
  }

  return reportPushed(report, options, 'pull-rebase');
}

/**
 * The arguments for the force fallback. A lease the caller passed is kept and never
 * replaced by --force, which would discard its expected-value check: a scoped lease keeps
 * its value, and bare --force-with-lease covers the other refs.
 */
export function forcePushArgs(pushArgs: string[]): string[] {
  const options = pushArgs.slice(1);
  if (
    options.some((arg) => arg === '--force-with-lease' || arg.startsWith('--force-with-lease='))
  ) {
    return options.includes('--force-with-lease')
      ? pushArgs
      : ['push', '--force-with-lease', ...options];
  }
  if (options.some(isForceFlag)) return pushArgs;
  return ['push', '--force', ...options];
}

/**
 * Handle force push
 */
async function handleForcePush(
  pushArgs: string[],
  options: PushOptions,
  report: PushReport
): Promise<Result<void>> {
  const forceArgs = forcePushArgs(pushArgs);
  const withLease = forceArgs.some((arg) => arg.startsWith('--force-with-lease'));
  const forceSpinner = ui.spinner(
    withLease ? 'Force pushing with lease' : 'Force pushing (overwriting remote)'
  );
  try {
    forceSpinner.start();
    const forceResult = await execa('git', forceArgs, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    forceSpinner.succeed(
      withLease
        ? 'Force-pushed with lease over the rejected update'
        : "Force-pushed over the remote's new commits"
    );

    if (forceResult.stdout) {
      ui.muted(forceResult.stdout);
    }
  } catch (forceError) {
    forceSpinner.stop();
    return failure(GitErrors.unknown('push', forceError));
  }

  return reportPushed(report, options, 'force');
}

export function createPushCommand(): Command {
  const command = new Command('push');

  command
    .description('Push changes to remote repository (passes unknown options to git)')
    .argument('[args...]', 'git push arguments (remote, branch, and options like -u)')
    .option('--dry-run', 'show what would be pushed without actually pushing')
    .option(
      '--allow-main',
      'allow changing a protected branch (the default branch, main, master), including force-pushes and deletions'
    )
    .addOption(new Option('--force-main', 'deprecated alias for --allow-main').hideHelp())
    .addOption(
      new Option(
        '--on-reject <strategy>',
        'resolution when push is rejected non-fast-forward (pull-rebase|force|cancel)'
      ).choices(['pull-rebase', 'force', 'cancel'])
    )
    .addHelpText(
      'after',
      `
Examples:
  Standard push:
    $ neo git push

  Preview what would be pushed, honoring the remote and refspecs:
    $ neo git push --dry-run origin feature:main

  Push to a protected branch on purpose:
    $ neo git push --allow-main

  Let this checkout fast-forward its default branch without a prompt:
    $ git config neo.allowMainPush true

  Agent push with auto-rebase on reject:
    $ neo git push --yes --on-reject pull-rebase --json
`
    )
    .allowUnknownOption()
    .action(
      runAction(async (args: string[], opts) => {
        // Parse args to extract remote, branch, and passthrough options
        // Options start with - or --, positional args are remote and branch
        const passthrough: string[] = [];
        const positionalArgs: string[] = [];

        for (let index = 0; index < args.length; index += 1) {
          const arg = args[index] ?? '';
          // Skip our known options
          if (arg === '--dry-run' || arg === '--allow-main' || arg === '--force-main') {
            continue;
          }

          if (arg.startsWith('-')) {
            // This is an option to pass through to git, with its value when it takes one
            passthrough.push(arg);
            const value = args[index + 1];
            if (PUSH_FLAGS_WITH_VALUE.has(arg) && value !== undefined) {
              passthrough.push(value);
              index += 1;
            }
          } else {
            // This is a positional argument (remote or refspec)
            positionalArgs.push(arg);
          }
        }

        // First positional is the remote; every one after it is a refspec
        const [remote, ...refspecs] = positionalArgs;

        const validatedOptions: GitPushOptions = validate(
          gitPushOptionsSchema,
          opts,
          'git push options'
        );
        const options: PushOptions = {
          dryRun: validatedOptions.dryRun,
          passthrough,
          remote,
          refspecs,
          allowMain: Boolean(validatedOptions.allowMain || validatedOptions.forceMain),
          onReject: validatedOptions.onReject,
        };

        logger.debug(`Options: ${JSON.stringify(options)}`);

        const result = await executePush(options);
        if (isFailure(result)) {
          throw result.error;
        }
      })
    );

  return command;
}
