import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const LOCKFILES: Array<{ file: string; pm: PackageManager }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'package-lock.json', pm: 'npm' },
];

const DEFAULT_SCRIPTS = ['build', 'test', 'lint', 'typecheck'] as const;
const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_CHARS = 8_000;

interface VerifyOptions {
  pm?: string;
  only?: string;
  skip?: string;
}

export interface ScriptResult {
  script: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
}

export interface VerifyResult {
  packageManager: PackageManager;
  results: ScriptResult[];
  ok: boolean;
  totalDurationMs: number;
}

interface PackageManifest {
  scripts: Record<string, string>;
  verifyScript?: unknown;
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

function parsePackageManager(value: string): PackageManager {
  const packageManager = PACKAGE_MANAGERS.find((candidate) => candidate === value);
  if (!packageManager) {
    throw new Error(
      `Unsupported package manager "${value}". Expected one of: ${PACKAGE_MANAGERS.join(', ')}.`
    );
  }
  return packageManager;
}

async function readPackageManifest(cwd: string): Promise<PackageManifest> {
  const pkgPath = join(cwd, 'package.json');
  if (!(await pathExists(pkgPath))) {
    throw new Error('No package.json in current directory.');
  }
  const raw = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as {
    scripts?: Record<string, string>;
    neo?: { verify?: unknown };
  };
  return {
    scripts: pkg.scripts ?? {},
    verifyScript: pkg.neo?.verify,
  };
}

function parseFilter(value: string | undefined): string[] | null {
  if (!value) return null;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function selectScripts(
  scripts: Record<string, string>,
  verifyScript: unknown,
  only: string[] | null,
  skip: string[] | null
): string[] {
  let base: readonly string[];
  if (only !== null) {
    const missing = only.find((script) => !Object.hasOwn(scripts, script));
    if (missing) {
      throw new Error(`Requested verification script "${missing}" is not defined in package.json.`);
    }
    base = only;
  } else if (verifyScript !== undefined) {
    if (typeof verifyScript !== 'string' || verifyScript.trim() === '') {
      throw new Error('package.json#neo.verify must be a non-empty script name.');
    }
    const configured = verifyScript.trim();
    if (!Object.hasOwn(scripts, configured)) {
      throw new Error(
        `Configured verification script "${configured}" is not defined in package.json.`
      );
    }
    base = [configured];
  } else {
    base = DEFAULT_SCRIPTS;
  }

  const optionLike = base.find((script) => script.startsWith('-'));
  if (optionLike) {
    throw new Error(`Verification script names cannot start with "-": ${optionLike}.`);
  }

  const skipSet = new Set(skip ?? []);
  return base.filter((script) => Object.hasOwn(scripts, script) && !skipSet.has(script));
}

function pmArgs(pm: PackageManager, script: string): string[] {
  if (pm === 'npm') return ['run', script];
  // pnpm, yarn, bun all accept `<pm> run <script>` but also the shorter form.
  return ['run', script];
}

function outputTail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
  return lines.slice(-OUTPUT_TAIL_CHARS);
}

export async function executeVerify(cwd: string, options: VerifyOptions): Promise<VerifyResult> {
  const only = parseFilter(options.only);
  const skip = parseFilter(options.skip);

  const pm = options.pm ? parsePackageManager(options.pm) : await detectPackageManager(cwd);

  const manifest = await readPackageManifest(cwd);
  const toRun = selectScripts(manifest.scripts, manifest.verifyScript, only, skip);

  if (toRun.length === 0) {
    const requested =
      only ??
      (typeof manifest.verifyScript === 'string'
        ? [manifest.verifyScript.trim()]
        : DEFAULT_SCRIPTS);
    throw new Error(
      `No matching scripts found in package.json. Looked for: ${requested.join(', ')}.`
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
      const stderrTail = outputTail((error as { stderr?: unknown }).stderr);
      const stdoutTail = outputTail((error as { stdout?: unknown }).stdout);
      const visibleTail = stderrTail ?? stdoutTail;
      if (visibleTail) ui.muted(visibleTail);
      results.push({
        script,
        status: 'failed',
        durationMs,
        exitCode,
        ...(stdoutTail !== undefined ? { stdoutTail } : {}),
        ...(stderrTail !== undefined ? { stderrTail } : {}),
      });
    }
  }

  const totalDurationMs = Date.now() - startedAt;
  const ok = results.every((r) => r.status !== 'failed');

  return { packageManager: pm, results, ok, totalDurationMs };
}

export function createVerifyCommand(): Command {
  const command = new Command('verify');

  command
    .description('Run repository verification scripts and summarize results')
    .option('--pm <name>', 'force a specific package manager (pnpm|npm|yarn|bun)')
    .option('--only <scripts>', 'comma-separated subset to run (e.g. build,test)')
    .option('--skip <scripts>', 'comma-separated scripts to skip')
    .addHelpText(
      'after',
      `
Examples:
  Run every verify step the repo defines:
    $ neo verify

  package.json can set neo.verify to one repository verification script.

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
                ui.success(
                  `All ${passed} script(s) passed in ${Math.round(result.totalDurationMs / 100) / 10}s`
                );
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
