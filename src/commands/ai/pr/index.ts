import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { NonInteractiveError, mayPrompt } from '@/utils/prompt.js';
import { generatePrDescription, type AIPrRequest } from '@/services/ai/index.js';

interface AiPrOptions {
  base?: string;
  create?: boolean;
  draft?: boolean;
}

interface AiPrResult {
  title: string;
  body: string;
  base: string;
  branch: string;
  commits: number;
  prUrl?: string;
  created: boolean;
}

async function detectDefaultBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return stdout.replace('refs/remotes/origin/', '').trim();
  } catch {
    for (const name of ['main', 'master']) {
      try {
        await execa('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`]);
        return name;
      } catch {
        continue;
      }
    }
    throw new Error(
      'Could not detect default branch. Pass --base <name> or run `git remote set-head origin --auto`.'
    );
  }
}

async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current']);
  return stdout.trim();
}

async function getCommits(base: string): Promise<string[]> {
  const { stdout } = await execa('git', [
    'log',
    `origin/${base}..HEAD`,
    '--pretty=format:%h %s%n%b',
    '--reverse',
  ]);
  return stdout.split('\n').filter((line) => line.trim().length > 0);
}

async function getDiffStat(base: string): Promise<string> {
  const { stdout } = await execa('git', ['diff', `origin/${base}...HEAD`, '--stat']);
  return stdout.trim();
}

async function getDiff(base: string): Promise<string> {
  const { stdout } = await execa('git', ['diff', `origin/${base}...HEAD`]);
  return stdout;
}

async function existingPrUrl(): Promise<string | null> {
  try {
    const { stdout } = await execa('gh', ['pr', 'view', '--json', 'url', '-q', '.url'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const url = stdout.trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

async function ghInstalled(): Promise<boolean> {
  try {
    await execa('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export async function executeAiPr(options: AiPrOptions): Promise<AiPrResult> {
  const branch = await getCurrentBranch();
  if (!branch) {
    throw new Error('Detached HEAD — check out a branch before running `neo ai pr`.');
  }

  const base = options.base ?? (await detectDefaultBranch());
  if (branch === base) {
    throw new Error(`Already on base branch "${base}" — nothing to describe.`);
  }

  const [commits, diffStat, diff] = await Promise.all([
    getCommits(base),
    getDiffStat(base),
    getDiff(base),
  ]);

  if (commits.length === 0) {
    throw new Error(
      `No commits on ${branch} that aren't already on origin/${base}. Commit and push first.`
    );
  }

  const request: AIPrRequest = {
    branchName: branch,
    baseBranch: base,
    commits,
    diffStat,
    diff,
  };

  const generateSpinner = ui.spinner('Generating PR description');
  generateSpinner.start();
  const result = await generatePrDescription(request);
  if (!result.success) {
    generateSpinner.fail('PR description generation failed');
    throw result.error;
  }
  generateSpinner.succeed('Generated PR description');

  const { title, body } = result.data;
  const commitCount = commits.filter((c) => /^[0-9a-f]{7,}\s/.test(c)).length;

  // Decide whether to create the PR. JSON mode is strictly emit-only so
  // agents can post-process `{title, body}` without surprise side-effects.
  const shouldCreate = options.create !== false;
  const created: AiPrResult = {
    title,
    body,
    base,
    branch,
    commits: commitCount,
    created: false,
  };

  if (!shouldCreate) return created;

  if (!(await ghInstalled())) {
    ui.warn('gh CLI not found — skipping PR creation. Install from https://cli.github.com.');
    return created;
  }

  const existing = await existingPrUrl();
  if (existing) {
    ui.warn(`PR already exists for this branch: ${existing}`);
    ui.muted('Use `gh pr edit` to update title/body.');
    return { ...created, prUrl: existing };
  }

  // Confirm before pushing the generated content to GitHub.
  if (mayPrompt('Create PR with this title + body?', '--yes')) {
    ui.newline();
    ui.section('Preview');
    ui.muted(`Title: ${title}`);
    ui.muted('Body:');
    ui.muted(body);
    ui.newline();

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Create PR?',
        default: true,
      },
    ]);
    if (!confirm) {
      ui.muted('Skipped PR creation.');
      return created;
    }
  }

  const createSpinner = ui.spinner('Creating PR');
  createSpinner.start();
  try {
    const args = ['pr', 'create', '--base', base, '--title', title, '--body', body];
    if (options.draft) args.push('--draft');
    const { stdout } = await execa('gh', args);
    const url = stdout.trim().split('\n').pop() ?? '';
    createSpinner.succeed(`Created PR: ${url}`);
    return { ...created, prUrl: url, created: true };
  } catch (error) {
    createSpinner.fail('Failed to create PR');
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) ui.muted(stderr.trim().split('\n').slice(-10).join('\n'));
    throw new Error('gh pr create failed. Run with --json to inspect the generated title/body.');
  }
}

export function createAiPrCommand(): Command {
  const command = new Command('pr');

  command
    .description('Generate a PR title + body from the current branch and (optionally) create it via gh')
    .option('--base <branch>', 'base branch to diff against (default: origin HEAD)')
    .option('--draft', 'open the PR as a draft')
    .option('--no-create', 'generate the description only — do not call gh pr create')
    .addHelpText(
      'after',
      `
Examples:
  Generate + preview + create (interactive):
    $ neo ai pr

  Generate only, no PR created (print title/body):
    $ neo ai pr --no-create

  Agent-friendly (emits { ok, title, body } on stdout, no PR side-effect):
    $ neo ai pr --json --no-create

  Skip confirmation, open as draft:
    $ neo ai pr --yes --draft
`
    )
    .action(
      runAction(async (options: AiPrOptions) => {
        // In JSON mode, creating a PR behind the user's back would be a
        // surprising side-effect — force --no-create unless they explicitly
        // opted in with --yes.
        const { getRuntimeContext } = await import('@/utils/runtime-context.js');
        const ctx = getRuntimeContext();
        const effectiveOptions: AiPrOptions = { ...options };
        if (ctx.format === 'json' && !ctx.yes && effectiveOptions.create !== false) {
          effectiveOptions.create = false;
        }
        if (ctx.nonInteractive && !ctx.yes && effectiveOptions.create !== false) {
          // --non-interactive alone shouldn't trigger a PR create; that needs --yes.
          throw new NonInteractiveError(
            'PR creation confirmation',
            '--yes (or --no-create to skip)'
          );
        }

        const result = await executeAiPr(effectiveOptions);
        emitJson(
          {
            ok: true,
            command: 'ai pr',
            branch: result.branch,
            base: result.base,
            commits: result.commits,
            title: result.title,
            body: result.body,
            created: result.created,
            prUrl: result.prUrl,
          },
          {
            text: () => {
              if (result.created && result.prUrl) {
                ui.success(`PR opened: ${result.prUrl}`);
              } else if (result.prUrl) {
                ui.muted(`Existing PR: ${result.prUrl}`);
              } else {
                ui.newline();
                ui.section('Generated PR');
                ui.muted(`Title: ${result.title}`);
                ui.muted('Body:');
                ui.muted(result.body);
              }
            },
          }
        );
      })
    );

  return command;
}
