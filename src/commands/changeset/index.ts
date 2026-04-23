import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { NonInteractiveError, promptSelect } from '@/utils/prompt.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';

type BumpType = 'major' | 'minor' | 'patch' | 'empty';

const BUMP_VALUES: readonly BumpType[] = ['major', 'minor', 'patch', 'empty'] as const;

interface ChangesetOptions {
  bump?: string;
  summary?: string;
  package?: string;
}

interface ChangesetResult {
  path: string;
  bump: BumpType;
  packages: string[];
  summary: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Discover publishable package names. For single-package repos, returns the
 * root package name. For pnpm/npm/yarn workspaces, walks the declared globs
 * and collects every `package.json#name` that isn't marked `private: true`.
 *
 * We stay intentionally shallow — one level of expansion for the common
 * `packages/*` layout — rather than pulling in a full glob library for a
 * workflow command that the vast majority of users will run in single-package
 * repos.
 */
async function discoverPackages(cwd: string): Promise<string[]> {
  const rootPkg = await readJson<{
    name?: string;
    private?: boolean;
    workspaces?: string[] | { packages?: string[] };
  }>(join(cwd, 'package.json'));

  const workspacePatterns: string[] = [];

  if (Array.isArray(rootPkg.workspaces)) {
    workspacePatterns.push(...rootPkg.workspaces);
  } else if (rootPkg.workspaces?.packages) {
    workspacePatterns.push(...rootPkg.workspaces.packages);
  }

  const pnpmWorkspacePath = join(cwd, 'pnpm-workspace.yaml');
  if (await pathExists(pnpmWorkspacePath)) {
    const yaml = await readFile(pnpmWorkspacePath, 'utf-8');
    // Minimal YAML read — we only need the `packages:` list entries. Avoids
    // a yaml-parser dep for a single-purpose read.
    const lines = yaml.split('\n');
    let inPackages = false;
    for (const line of lines) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const match = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
        if (match?.[1]) workspacePatterns.push(match[1]);
        else if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) break;
      }
    }
  }

  if (workspacePatterns.length === 0) {
    if (rootPkg.name && !rootPkg.private) return [rootPkg.name];
    if (rootPkg.name) return [rootPkg.name];
    throw new Error('Root package.json is missing a "name" field.');
  }

  const names = new Set<string>();
  for (const pattern of workspacePatterns) {
    // Only support `<dir>/*` or bare directory patterns — covers ~all monorepos
    // we'd realistically encounter without dragging in a glob library.
    const trimmed = pattern.replace(/\/\*$/, '');
    const base = join(cwd, trimmed);
    if (!(await pathExists(base))) continue;
    const isGlob = pattern.endsWith('/*');
    const candidates = isGlob
      ? (await readdir(base, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => join(base, d.name))
      : [base];
    for (const dir of candidates) {
      const pkgPath = join(dir, 'package.json');
      if (!(await pathExists(pkgPath))) continue;
      try {
        const pkg = await readJson<{ name?: string; private?: boolean }>(pkgPath);
        if (pkg.name && !pkg.private) names.add(pkg.name);
      } catch {
        continue;
      }
    }
  }

  if (names.size === 0) {
    throw new Error('No publishable packages found in workspaces.');
  }
  return [...names];
}

const ADJECTIVES = [
  'brisk', 'bright', 'bold', 'busy', 'calm', 'clever', 'curious', 'eager',
  'fierce', 'gentle', 'happy', 'jolly', 'keen', 'lucky', 'mellow', 'nimble',
  'quiet', 'quick', 'rapid', 'silent', 'snappy', 'spry', 'swift', 'tidy',
  'vivid', 'warm', 'witty', 'zesty',
];
const ANIMALS = [
  'ants', 'bees', 'cats', 'crows', 'deer', 'dogs', 'eels', 'foxes',
  'frogs', 'geckos', 'goats', 'hares', 'hawks', 'jays', 'lions', 'lynx',
  'moles', 'moths', 'newts', 'owls', 'pandas', 'pigs', 'quails', 'rabbits',
  'seals', 'tigers', 'wolves', 'yaks',
];
const VERBS = [
  'bake', 'bounce', 'cheer', 'dance', 'dream', 'glow', 'hike', 'jump',
  'laugh', 'march', 'paint', 'race', 'sing', 'skate', 'smile', 'sparkle',
  'swim', 'think', 'wander', 'wave',
];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

function generateChangesetName(): string {
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${pick(VERBS)}`;
}

function parseBump(raw: string | undefined): BumpType | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if ((BUMP_VALUES as readonly string[]).includes(normalized)) {
    return normalized as BumpType;
  }
  throw new Error(
    `Invalid --bump "${raw}". Expected one of: ${BUMP_VALUES.join(', ')}.`
  );
}

async function ensureUniquePath(cwd: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = generateChangesetName();
    const path = join(cwd, '.changeset', `${name}.md`);
    if (!(await pathExists(path))) return path;
  }
  // Fall back to a timestamp — collision after 8 tries is a weird universe.
  return join(cwd, '.changeset', `neo-${Date.now()}.md`);
}

function formatChangesetBody(
  bump: BumpType,
  packages: string[],
  summary: string
): string {
  if (bump === 'empty') {
    return '---\n---\n';
  }
  const lines = packages.map((name) => `'${name}': ${bump}`);
  return `---\n${lines.join('\n')}\n---\n\n${summary.trim()}\n`;
}

export async function executeChangeset(
  cwd: string,
  options: ChangesetOptions
): Promise<ChangesetResult> {
  const configPath = join(cwd, '.changeset', 'config.json');
  if (!(await pathExists(configPath))) {
    throw new Error(
      'No .changeset/config.json found. Run `pnpm dlx @changesets/cli init` first.'
    );
  }

  const ctx = getRuntimeContext();
  const bumpArg = parseBump(options.bump);

  const bump: BumpType = bumpArg ??
    (await promptSelect<BumpType>({
      message: 'What kind of change is this?',
      flag: '--bump',
      choices: [
        { label: 'patch — bugfix, no behavior change for consumers', value: 'patch' },
        { label: 'minor — backwards-compatible feature', value: 'minor' },
        { label: 'major — breaking change', value: 'major' },
        { label: 'empty — no package version bump (tooling/docs only)', value: 'empty' },
      ],
      defaultValue: 'patch',
    }));

  let packages: string[] = [];
  if (bump !== 'empty') {
    const discovered = await discoverPackages(cwd);

    if (options.package) {
      const requested = options.package.split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = requested.filter((name) => !discovered.includes(name));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown package(s): ${unknown.join(', ')}. Known: ${discovered.join(', ')}.`
        );
      }
      packages = requested;
    } else if (discovered.length === 1) {
      packages = discovered;
    } else {
      // Monorepo with no explicit --package → must prompt interactively.
      if (ctx.yes || ctx.nonInteractive) {
        throw new NonInteractiveError(
          'Select package(s) to bump',
          '--package <name>[,<name>...]'
        );
      }
      const { selected } = await inquirer.prompt<{ selected: string[] }>([
        {
          type: 'checkbox',
          name: 'selected',
          message: 'Which packages are affected?',
          choices: discovered.map((name) => ({ name, value: name })),
          validate: (choices: readonly string[]) =>
            choices.length > 0 ? true : 'Pick at least one package.',
        },
      ]);
      packages = selected;
    }
  }

  let summary = options.summary?.trim() ?? '';
  if (bump !== 'empty' && !summary) {
    if (ctx.yes || ctx.nonInteractive) {
      throw new NonInteractiveError('Changeset summary', '--summary "<text>"');
    }
    const answer = await inquirer.prompt<{ summary: string }>([
      {
        type: 'input',
        name: 'summary',
        message: 'One-line summary (shown in the changelog):',
        validate: (input: string) => (input.trim() ? true : 'Summary cannot be empty.'),
      },
    ]);
    summary = answer.summary.trim();
  }

  const path = await ensureUniquePath(cwd);
  const body = formatChangesetBody(bump, packages, summary);

  await writeFile(path, body, 'utf-8');

  return { path, bump, packages, summary };
}

export function createChangesetCommand(): Command {
  const command = new Command('changeset');

  command
    .description('Create a changeset file (bump type + summary) under .changeset/')
    .option('--bump <level>', 'bump level: major, minor, patch, or empty')
    .option('--summary <text>', 'one-line summary for the changelog')
    .option('--package <names>', 'comma-separated package names (monorepos)')
    .addHelpText(
      'after',
      `
Examples:
  Interactive (prompts for bump + summary):
    $ neo changeset

  Non-interactive minor bump with summary:
    $ neo changeset --yes --bump minor --summary "Add neo sync command"

  Empty changeset (CLAUDE.md rule for tooling/docs-only changes):
    $ neo changeset --yes --bump empty

  Agent-friendly:
    $ neo changeset --yes --json --bump patch --summary "Fix parse edge case"
`
    )
    .action(
      runAction(async (options: ChangesetOptions) => {
        const result = await executeChangeset(process.cwd(), options);
        emitJson(
          {
            ok: true,
            command: 'changeset',
            path: result.path,
            bump: result.bump,
            packages: result.packages,
            summary: result.summary,
          },
          {
            text: () => {
              ui.success(`Wrote ${result.path}`);
              if (result.bump === 'empty') {
                ui.muted('Empty changeset — no package version bump.');
              } else {
                ui.muted(
                  `${result.bump} bump for ${result.packages.join(', ')}`
                );
              }
            },
          }
        );
      })
    );

  return command;
}
