import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCKFILES: Array<{ file: string; pm: PackageManager }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'package-lock.json', pm: 'npm' },
];

const DEFAULT_SCRIPTS = ['build', 'test', 'lint', 'typecheck'] as const;
type Script = (typeof DEFAULT_SCRIPTS)[number];

interface VerifyOptions {
  pm?: string;
  only?: string;
  skip?: string;
}

interface ScriptResult {
  script: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  exitCode?: number;
}

interface VerifyResult {
  packageManager: PackageManager;
  results: ScriptResult[];
  ok: boolean;
  totalDurationMs: number;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const present = await Promise.all(
    LOCKFILES.map(async ({ file, pm }) => ((await pathExists(join(cwd, file))) ? pm : null))
  );
  const found = [...new Set(present.filter((x): x is PackageManager => x !== null))];

  if (found.length === 0) {
    throw new Error(
      'No lockfile found. Expected one of: pnpm-lock.yaml, yarn.lock, bun.lock, package-lock.json. Pass --pm <name> to override.'
    );
  }
  if (found.length > 1) {
    ui.warn(
      `Multiple lockfiles detected (${found.join(', ')}). Using ${found[0]}. Pass --pm to disambiguate.`
    );
  }
  return found[0]!;
}

async function readScripts(cwd: string): Promise<Record<string, string>> {
  const pkgPath = join(cwd, 'package.json');
  if (!(await pathExists(pkgPath))) {
    throw new Error('No package.json in current directory.');
  }
  const raw = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

function parseFilter(value: string | undefined): string[] | null {
  if (!value) return null;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickScripts(scripts: Record<string, string>, only: string[] | null, skip: string[] | null): Script[] {
  const base = only ?? DEFAULT_SCRIPTS;
  const skipSet = new Set(skip ?? []);
  return (base as readonly string[]).filter(
    (s): s is Script => s in scripts && !skipSet.has(s)
  );
}

function pmArgs(pm: PackageManager, script: string): string[] {
  if (pm === 'npm') return ['run', script];
  // pnpm, yarn, bun all accept `<pm> run <script>` but also the shorter form.
  return ['run', script];
}

export async function executeVerify(cwd: string, options: VerifyOptions): Promise<VerifyResult> {
  const only = parseFilter(options.only);
  const skip = parseFilter(options.skip);

  const pm: PackageManager = options.pm
    ? (options.pm as PackageManager)
    : await detectPackageManager(cwd);

  const scripts = await readScripts(cwd);
  const toRun = pickScripts(scripts, only, skip);

  if (toRun.length === 0) {
    throw new Error(
      `No matching scripts found in package.json. Looked for: ${(only ?? DEFAULT_SCRIPTS).join(', ')}.`
    );
  }

  const results: ScriptResult[] = [];
  const startedAt = Date.now();

  for (const script of toRun) {
    const scriptSpinner = ui.spinner(`${pm} run ${script}`);
    scriptSpinner.start();
    const t0 = Date.now();
    try {
      await execa(pm, pmArgs(pm, script), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const durationMs = Date.now() - t0;
      scriptSpinner.succeed(`${script} passed (${Math.round(durationMs / 100) / 10}s)`);
      results.push({ script, status: 'passed', durationMs });
    } catch (error) {
      const durationMs = Date.now() - t0;
      const exitCode =
        typeof (error as { exitCode?: number }).exitCode === 'number'
          ? (error as { exitCode: number }).exitCode
          : 1;
      scriptSpinner.fail(`${script} failed (${Math.round(durationMs / 100) / 10}s)`);
      // Surface captured stderr so the user can see what broke without
      // re-running manually. Keep it muted so it doesn't drown the summary.
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const stdout = (error as { stdout?: string }).stdout ?? '';
      const tail = (stderr || stdout).trim().split('\n').slice(-20).join('\n');
      if (tail) ui.muted(tail);
      results.push({ script, status: 'failed', durationMs, exitCode });
    }
  }

  const totalDurationMs = Date.now() - startedAt;
  const ok = results.every((r) => r.status !== 'failed');

  return { packageManager: pm, results, ok, totalDurationMs };
}

export function createVerifyCommand(): Command {
  const command = new Command('verify');

  command
    .description('Run build, test, lint, and typecheck scripts and summarize results')
    .option('--pm <name>', 'force a specific package manager (pnpm|npm|yarn|bun)')
    .option('--only <scripts>', 'comma-separated subset to run (e.g. build,test)')
    .option('--skip <scripts>', 'comma-separated scripts to skip')
    .addHelpText(
      'after',
      `
Examples:
  Run every verify step the repo defines:
    $ neo verify

  Just build and test:
    $ neo verify --only build,test

  Skip lint (useful while iterating):
    $ neo verify --skip lint

  Agent-friendly (structured pass/fail):
    $ neo verify --json
`
    )
    .action(
      runAction(async (options: VerifyOptions) => {
        const result = await executeVerify(process.cwd(), options);

        emitJson(
          {
            ok: result.ok,
            command: 'verify',
            packageManager: result.packageManager,
            results: result.results,
            totalDurationMs: result.totalDurationMs,
          },
          {
            text: () => {
              ui.newline();
              const passed = result.results.filter((r) => r.status === 'passed').length;
              const failed = result.results.filter((r) => r.status === 'failed').length;
              if (result.ok) {
                ui.success(`All ${passed} script(s) passed in ${Math.round(result.totalDurationMs / 100) / 10}s`);
              } else {
                ui.error(`${failed} of ${result.results.length} script(s) failed`);
              }
            },
          }
        );

        if (!result.ok) {
          // Structured payload was already emitted above; set exit code so
          // `neo verify && …` chains fail, without emitting a second JSON
          // error object to stdout.
          process.exitCode = 1;
        }
      })
    );

  return command;
}
